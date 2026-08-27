package handler

import (
	"net/url"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestSeedanceUsesOpenAIVideoPathOutsideArkPlan(t *testing.T) {
	normal := model.ModelChannel{BaseURL: "https://api.example.com"}
	if got := resolveAIProxyPath(normal, "seedance2.5", "/videos"); got != "/videos" {
		t.Fatalf("normal Seedance path = %q, want /videos", got)
	}
	if got := resolveAIProxyPath(normal, "seedance2.5", "/videos/video_123"); got != "/videos/video_123" {
		t.Fatalf("normal Seedance poll path = %q, want /videos/video_123", got)
	}
}

func TestSeedanceKeepsArkPlanTaskPath(t *testing.T) {
	ark := model.ModelChannel{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3"}
	if got := resolveAIProxyPath(ark, "seedance2.5", "/videos"); got != "/contents/generations/tasks" {
		t.Fatalf("Ark Seedance path = %q, want /contents/generations/tasks", got)
	}
	if got := resolveAIProxyPath(ark, "seedance2.5", "/videos/task-123"); got != "/contents/generations/tasks/task-123" {
		t.Fatalf("Ark Seedance poll path = %q, want /contents/generations/tasks/task-123", got)
	}
}

func TestVideoPayloadUsesVideoIDForDocumentedPolling(t *testing.T) {
	parsed := parseVideoTaskPayload([]byte(`{"id":"video_abc","task_id":"task_xyz","status":"queued"}`), "seedance2.5")
	if parsed.UpstreamTaskID != "video_abc" {
		t.Fatalf("poll id = %q, want video_abc", parsed.UpstreamTaskID)
	}
}

func TestVideoTaskPollUsesManagedSessionOnlyForManagedChannel(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })

	tests := []struct {
		name    string
		enabled bool
		task    model.VideoTask
		want    bool
	}{
		{name: "ordinary remote task", enabled: true, task: model.VideoTask{ChannelID: "remote-video"}, want: false},
		{name: "user local task", enabled: true, task: model.VideoTask{ChannelID: "platform-managed:video:7", UserChannelID: "local-video"}, want: false},
		{name: "managed video task", enabled: true, task: model.VideoTask{ChannelID: "platform-managed:video:7"}, want: true},
		{name: "managed channel while platform auth is disabled", enabled: false, task: model.VideoTask{ChannelID: "platform-managed:video:7"}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config.Cfg = config.Config{}
			if tt.enabled {
				config.Cfg = config.Config{PlatformAPIBaseURL: "https://api.example.test", PlatformExchangeSecret: "exchange-secret"}
			}
			if got := shouldPollVideoTaskFromPlatform(tt.task); got != tt.want {
				t.Fatalf("should poll from platform = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestVideoTaskPollURLCarriesOriginatingModel(t *testing.T) {
	target, err := buildVideoTaskPollURL(model.ModelChannel{BaseURL: "https://api.example.com/v1"}, "seedance2.5", "task_123")
	if err != nil {
		t.Fatalf("build poll URL: %v", err)
	}
	parsed, err := url.Parse(target)
	if err != nil {
		t.Fatalf("parse poll URL: %v", err)
	}
	if parsed.Path != "/v1/videos/task_123" {
		t.Fatalf("poll path = %q, want /v1/videos/task_123", parsed.Path)
	}
	if got := parsed.Query().Get("model"); got != "seedance2.5" {
		t.Fatalf("poll model = %q, want seedance2.5", got)
	}
}

func TestVideoTaskPollURLPreservesKIEStatusRoute(t *testing.T) {
	channel := model.ModelChannel{BaseURL: "https://api.kie.ai", Name: "KIE 视频"}
	target, err := buildVideoTaskPollURL(channel, "veo-3.1", "task_123")
	if err != nil {
		t.Fatalf("build KIE poll URL: %v", err)
	}
	parsed, err := url.Parse(target)
	if err != nil {
		t.Fatalf("parse KIE poll URL: %v", err)
	}
	if parsed.Path != "/v1/jobs/recordInfo" {
		t.Fatalf("KIE poll path = %q, want /v1/jobs/recordInfo", parsed.Path)
	}
	if got := parsed.Query().Get("taskId"); got != "task_123" {
		t.Fatalf("KIE task id = %q, want task_123", got)
	}
	if got := parsed.Query().Get("model"); got != "veo-3.1" {
		t.Fatalf("KIE poll model = %q, want veo-3.1", got)
	}
}

func TestTransientDocumentedVideoTaskNotFound(t *testing.T) {
	for _, modelName := range []string{"manxue2.5", "minimax_h3", "seedance2.5", "sd2.5", "veo-3.1", "veo-3.1-fast", "veo-3.1-i2v"} {
		task := model.VideoTask{Model: modelName, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		if !isTransientVideoTaskNotFound(task, "task_not_exist") {
			t.Fatalf("fresh task_not_exist for %s should be retried", modelName)
		}
	}
	task := model.VideoTask{Model: "seedance2.5", CreatedAt: time.Now().Add(-21 * time.Minute).UTC().Format(time.RFC3339Nano)}
	if isTransientVideoTaskNotFound(task, "task_not_exist") {
		t.Fatal("stale task_not_exist should fail")
	}
}

func TestRetryableVideoPollErrorOnlyRetriesActualRateLimits(t *testing.T) {
	if !isRetryableVideoPollError(429, "rate limit exceeded") {
		t.Fatal("rate limit should retry")
	}
	if isRetryableVideoPollError(429, "insufficient credits (status=429)") {
		t.Fatal("insufficient credits must fail")
	}
	if isRetryableVideoPollError(429, "video generation timed out") {
		t.Fatal("upstream timeout must fail")
	}
}

func TestVideoStatusAliasesBecomeTerminalFailures(t *testing.T) {
	for _, status := range []string{"timeout", "timed_out", "timed-out", "expired", "rejected", "blocked", "moderated", "incomplete", "aborted"} {
		if got := service.NormalizeVideoTaskStatus(status); got != "failed" {
			t.Fatalf("status %q = %q, want failed", status, got)
		}
	}
}
