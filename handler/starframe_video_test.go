package handler

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestStarframeVideoJSONContract(t *testing.T) {
	channel := model.ModelChannel{Protocol: "starframe", BaseURL: "https://api.jisudeng.com"}
	body := []byte(`{"model":"ch0101-sd-2.0-1080p","prompt":"scene","mode":"references","client_task_id":"order-1","duration":5,"resolution":"720p"}`)
	got, contentType, err := normalizeVideoCreateBody(body, "application/json", "ch0101-sd-2.0-1080p", channel, "/videos")
	if err != nil || contentType != "application/json" {
		t.Fatalf("normalize: %s %v", contentType, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(got, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "ch0101-sd-2.0-1080p" || payload["duration"] != float64(5) || payload["resolution"] != "720p" {
		t.Fatalf("fields changed: %#v", payload)
	}
	for _, invalid := range []string{
		`{"model":"alias","prompt":"scene"}`,
		`{"model":"alias","prompt":"scene","mode":"references","client_task_id":"bad id"}`,
		`{"model":"alias","prompt":"scene","mode":"frames","client_task_id":"order-1","frames":{"first_frame":"https://media.example/1.png"}}`,
		`{"model":"alias","prompt":"scene","mode":"references","client_task_id":"order-1","references":{"images":["https://media.example/1.png"]}}`,
		`{"model":"alias","prompt":"scene","mode":"references","client_task_id":"order-1","references":{"image":"data:image/png;base64,AA"}}`,
		`{"model":"alias","prompt":"scene","mode":"references","client_task_id":"order-1","references":{"image":"http://100.64.0.1/image.png"}}`,
	} {
		if _, _, err := normalizeVideoCreateBody([]byte(invalid), "application/json", "alias", channel, "/videos"); err == nil {
			t.Errorf("invalid body accepted: %s", invalid)
		}
	}
	if _, _, err := normalizeVideoCreateBody(body, "multipart/form-data; boundary=test", "alias", channel, "/videos"); err == nil {
		t.Error("multipart accepted")
	}
}

func TestStarframeVideoProtectedResult(t *testing.T) {
	channel := model.ModelChannel{Protocol: "starframe"}
	got := transformAIProtocolVideoPayload([]byte(`{"id":"sfv_123","status":"completed","metadata":{"url":"/v1/videos/sfv_123/content"}}`), nil, channel, "ch0101-sd-2.0-720p", true)
	var payload map[string]any
	if err := json.Unmarshal(got, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["video_url"] != "/v1/videos/sfv_123/content" {
		t.Fatalf("protected path lost: %s", got)
	}
	failed := transformAIProtocolVideoPayload([]byte(`{"id":"sfv_123","status":"failed","metadata":{"fail_reason":"unsupported duration"}}`), nil, channel, "alias", true)
	if !strings.Contains(string(failed), `"message":"unsupported duration"`) {
		t.Fatalf("failure reason lost: %s", failed)
	}
}

func TestStarframeStrictTaskParserNeverInfersReadinessFromURLs(t *testing.T) {
	for _, status := range []string{"queued", "in_progress", "unknown", "failed", "done", "success", "COMPLETED"} {
		payload := []byte(`{"id":"sfv_123","status":"` + status + `","metadata":{"url":"https://media.example/not-ready.mp4","fail_reason":"https://media.example/failure"},"references":{"image":"https://media.example/input.png"}}`)
		transformed := transformStarframeVideoResponse(payload)
		parsed := parseVideoTaskPayload(transformed, "alias", "starframe")
		if parsed.Status == "completed" || parsed.VideoURL != "" {
			t.Fatalf("%s became ready: %#v", status, parsed)
		}
		if status == "failed" && parsed.Error != "https://media.example/failure" {
			t.Fatalf("failure reason lost: %#v", parsed)
		}
	}
}

func TestStarframeWrappedPayloadUsesStrictNormalization(t *testing.T) {
	completed := transformStarframeVideoResponse([]byte(`{"code":0,"data":{"id":"sfv_123","status":"completed","metadata":{"url":"https://evil.example/redirect"}}}`))
	parsed := parseVideoTaskPayload(completed, "alias", "starframe")
	if parsed.VideoURL != "/v1/videos/sfv_123/content" || parsed.UpstreamTaskID != "sfv_123" {
		t.Fatalf("wrapped identity or content path lost: %#v", parsed)
	}
	failed := transformStarframeVideoResponse([]byte(`{"code":0,"data":{"id":"sfv_123","status":"failed","metadata":{"fail_reason":"unsupported duration"}}}`))
	parsed = parseVideoTaskPayload(failed, "alias", "starframe")
	if parsed.Status != "failed" || parsed.Error != "unsupported duration" {
		t.Fatalf("wrapped failure lost: %#v", parsed)
	}
}
