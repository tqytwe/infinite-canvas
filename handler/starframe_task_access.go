package handler

import (
	"io"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func validVideoTaskAccess(r *http.Request, task model.VideoTask) bool {
	return (r.URL.Query().Get("model") == "" || r.URL.Query().Get("model") == task.Model) &&
		(r.Header.Get("X-Model-Channel-ID") == "" || r.Header.Get("X-Model-Channel-ID") == task.ChannelID) &&
		(r.Header.Get(userModelChannelHeader) == "" || r.Header.Get(userModelChannelHeader) == task.UserChannelID)
}

func serveStarframeVideoContent(w http.ResponseWriter, r *http.Request, id string) bool {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return true
	}
	task, found, err := service.GetUserVideoTask(user.ID, id)
	if err != nil {
		Fail(w, "视频任务读取失败")
		return true
	}
	if !found {
		if strings.HasPrefix(id, "sfv_") {
			Fail(w, "视频任务不存在")
			return true
		}
		return false
	}
	if !task.SubmissionClaim {
		return false
	}
	if !validVideoTaskAccess(r, task) || !service.IsCompletedVideoTaskStatus(task.Status) || !strings.HasPrefix(task.UpstreamTaskID, "sfv_") || !starframeTaskIDPattern.MatchString(task.UpstreamTaskID) {
		Fail(w, "视频任务归属不匹配或尚未完成")
		return true
	}
	channel, _, err := selectAIRequestChannel(user, task.Model, task.ChannelID, task.UserChannelID, false)
	if err != nil || !strings.EqualFold(channel.Protocol, service.ModelChannelProtocolStarframe) {
		Fail(w, "原视频渠道不可用")
		return true
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, service.BuildModelChannelURL(channel, "/videos/"+task.UpstreamTaskID+"/content"), nil)
	if err != nil {
		Fail(w, "视频下载失败")
		return true
	}
	service.SetModelChannelAuthHeader(request, channel)
	for _, key := range []string{"Range", "If-Range"} {
		request.Header.Set(key, r.Header.Get(key))
	}
	client := *service.HTTPClientForChannel(channel)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		Fail(w, "视频下载失败")
		return true
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		Fail(w, "视频内容暂不可用")
		return true
	}
	for _, key := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if value := response.Header.Get(key); value != "" {
			w.Header().Set(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
	return true
}
