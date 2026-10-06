package handler

import (
	"encoding/json"
	"fmt"
	"mime"
	"net"
	"net/url"
	"regexp"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

var starframeTaskIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}$`)

func prepareStarframeVideoRequest(input aiProtocolRequest) (aiProtocolRequest, bool, error) {
	if !strings.EqualFold(strings.TrimSpace(input.channel.Protocol), service.ModelChannelProtocolStarframe) {
		return input, false, nil
	}
	if input.mode != aiProtocolVideoRequest && input.endpoint != "/videos" {
		return input, true, nil
	}
	contentType, _, err := mime.ParseMediaType(input.contentType)
	if err != nil || contentType != "application/json" {
		return input, true, fmt.Errorf("StarFrame 视频接口仅支持 JSON 请求")
	}
	var body map[string]any
	if err := json.Unmarshal(input.body, &body); err != nil {
		return input, true, fmt.Errorf("StarFrame 请求 JSON 无效")
	}
	for _, field := range []string{"model", "prompt", "mode", "client_task_id"} {
		value, ok := body[field].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return input, true, fmt.Errorf("StarFrame 缺少 %s", field)
		}
	}
	if !starframeTaskIDPattern.MatchString(body["client_task_id"].(string)) {
		return input, true, fmt.Errorf("StarFrame client_task_id 格式无效")
	}
	if duration, exists := body["duration"]; exists {
		if n, ok := duration.(float64); !ok || n <= 0 {
			return input, true, fmt.Errorf("StarFrame duration 必须是正数")
		}
	}
	switch body["mode"] {
	case "references":
		if _, exists := body["frames"]; exists {
			return input, true, fmt.Errorf("参考素材与首尾帧不能混用")
		}
		if refs, exists := body["references"]; exists {
			values, ok := refs.(map[string]any)
			if !ok {
				return input, true, fmt.Errorf("StarFrame references 必须是对象")
			}
			for _, kind := range []string{"image", "video", "audio"} {
				single, hasSingle := values[kind]
				plural, hasPlural := values[kind+"s"]
				if hasSingle && hasPlural {
					return input, true, fmt.Errorf("StarFrame %s 单复数字段互斥", kind)
				}
				if hasSingle && !validStarframeReference(single) {
					return input, true, fmt.Errorf("StarFrame 参考素材需要公网 URL")
				}
				if hasPlural {
					urls, ok := plural.([]any)
					if !ok || len(urls) < 2 {
						return input, true, fmt.Errorf("StarFrame %ss 至少需要两条 URL", kind)
					}
					for _, value := range urls {
						if !validStarframeReference(value) {
							return input, true, fmt.Errorf("StarFrame 参考素材需要公网 URL")
						}
					}
				}
			}
		}
	case "frames":
		if _, exists := body["references"]; exists {
			return input, true, fmt.Errorf("参考素材与首尾帧不能混用")
		}
		frames, ok := body["frames"].(map[string]any)
		if !ok || !validStarframeReference(frames["first_frame"]) || !validStarframeReference(frames["last_frame"]) {
			return input, true, fmt.Errorf("StarFrame 首尾帧模式需要两个公网图片 URL")
		}
	default:
		return input, true, fmt.Errorf("StarFrame mode 必须是 references 或 frames")
	}
	input.contentType = "application/json"
	return input, true, nil
}

func validStarframeReference(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	parsed, err := url.Parse(text)
	if err != nil || parsed.User != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return false
		}
		return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast()
	}
	return true
}

func transformStarframeVideoResponse(payload []byte) []byte {
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil {
		return payload
	}
	if code, ok := body["code"].(float64); ok && code == 0 {
		if data, ok := body["data"].(map[string]any); ok {
			body = data
		}
	}
	metadata, _ := body["metadata"].(map[string]any)
	if body["status"] == "completed" {
		id, _ := body["id"].(string)
		if !starframeTaskIDPattern.MatchString(id) {
			body["status"] = "failed"
			body["error"] = map[string]any{"message": "StarFrame 返回了无效任务 ID"}
		} else {
			contentPath := "/v1/videos/" + url.PathEscape(id) + "/content"
			body["video_url"] = contentPath
			if metadata == nil {
				metadata = map[string]any{}
			}
			metadata["url"] = contentPath
			body["metadata"] = metadata
		}
	}
	if body["status"] == "failed" && metadata != nil {
		if reason, ok := metadata["fail_reason"].(string); ok && reason != "" {
			body["error"] = map[string]any{"message": reason}
		}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return payload
	}
	return encoded
}

func parseStarframeVideoTaskPayload(data map[string]any, payload []byte) parsedVideoTaskPayload {
	id, _ := data["id"].(string)
	result := parsedVideoTaskPayload{
		UpstreamTaskID: id,
		Status:         "processing",
		Progress:       readIntPath(data, "progress"),
		Seconds:        firstNonEmpty(readStringPath(data, "seconds"), readStringPath(data, "duration")),
		Size:           firstNonEmpty(readStringPath(data, "size"), readSizeFromDimensions(data)),
		Error:          firstNonEmpty(readStringPath(data, "error.message"), readStringPath(data, "error")),
	}
	switch status := readStringPath(data, "status"); status {
	case "queued", "completed", "failed":
		result.Status = status
	}
	if !starframeTaskIDPattern.MatchString(id) {
		result.UpstreamTaskID = ""
		result.Status = "failed"
		result.Error = "StarFrame 返回了无效任务 ID"
	} else if result.Status == "completed" {
		result.VideoURL = "/v1/videos/" + id + "/content"
		result.Progress = 100
	}
	if result.Status == "failed" && result.Error == "" {
		result.Error = firstNonEmpty(readStringPath(data, "metadata.fail_reason"), "视频任务生成失败")
	}
	if result.Error != "" {
		result.ErrorDetail = string(payload)
	}
	return result
}
