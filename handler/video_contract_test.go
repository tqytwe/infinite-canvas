package handler

import (
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
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
	if parsed.UpstreamVideoID != "video_abc" {
		t.Fatalf("video id = %q, want video_abc", parsed.UpstreamVideoID)
	}
	if parsed.UpstreamTaskID != "task_xyz" {
		t.Fatalf("task id = %q, want task_xyz", parsed.UpstreamTaskID)
	}
}

func TestTransientDocumentedVideoTaskNotFound(t *testing.T) {
	task := model.VideoTask{Model: "seedance2.5", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if !isTransientVideoTaskNotFound(task, "task_not_exist") {
		t.Fatal("fresh task_not_exist should be retried")
	}
	old := time.Now().Add(-21 * time.Minute).UTC().Format(time.RFC3339Nano)
	task.CreatedAt = old
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
