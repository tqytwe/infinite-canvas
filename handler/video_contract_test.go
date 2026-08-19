package handler

import (
	"testing"
	"time"

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
