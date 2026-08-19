package handler

import (
	"testing"

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
