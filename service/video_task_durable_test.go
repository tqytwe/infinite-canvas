package service

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestVideoTaskPersistenceRegression(t *testing.T) {
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"video_tasks", "credit_logs", "users"} {
		if err := db.Exec("DELETE FROM " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	t.Run("durable concurrent claim", testStarframeClaimConcurrentDurable)
	t.Run("ordinary provider retries preserve owned identity", func(t *testing.T) {
		input := VideoTaskCreateInput{ClientTaskID: "client_video_task_ordinary", UserID: "owner", Model: "ordinary", Status: "failed"}
		if _, err := CreateVideoTask(input); err != nil {
			t.Fatal(err)
		}
		input.Status = "queued"
		input.UpstreamTaskID = "retry-upstream"
		got, err := CreateVideoTask(input)
		if err != nil || got.UpstreamTaskID != "retry-upstream" {
			t.Fatalf("ordinary retry broken: %+v %v", got, err)
		}
		stored, found, err := GetUserVideoTask(input.UserID, input.ClientTaskID)
		if err != nil || !found || stored.UpstreamTaskID != "retry-upstream" || stored.Status != "queued" {
			t.Fatalf("ordinary retry not persisted: %+v %v", stored, err)
		}
	})
	t.Run("cannot overwrite another user", func(t *testing.T) {
		_, err := CreateVideoTask(VideoTaskCreateInput{ClientTaskID: "client_video_task_owner", UserID: "owner", Model: "video", Status: "queued"})
		if err != nil {
			t.Fatal(err)
		}
		_, err = CreateVideoTask(VideoTaskCreateInput{ClientTaskID: "client_video_task_owner", UserID: "attacker", Model: "video", Status: "queued"})
		if err == nil {
			t.Fatal("cross-user task overwrite accepted")
		}
	})
	t.Run("late processing cannot erase completed content", func(t *testing.T) {
		task := model.VideoTask{ID: "client_video_task_monotonic", UserID: "owner", SubmissionClaim: true, Status: "processing"}
		if _, err := repository.SaveVideoTask(task); err != nil {
			t.Fatal(err)
		}
		if err := UpdateVideoTaskFromPoll(task, VideoTaskPollUpdate{Status: "completed", VideoURL: "/v1/videos/sfv_original/content", ResponseBody: `{"status":"completed"}`}); err != nil {
			t.Fatal(err)
		}
		if err := UpdateVideoTaskFromPoll(task, VideoTaskPollUpdate{Status: "processing", ResponseBody: `{"status":"in_progress"}`}); err != nil {
			t.Fatal(err)
		}
		got, _, err := GetUserVideoTask("owner", task.ID)
		if err != nil || got.Status != "completed" || got.VideoURL == "" {
			t.Fatalf("terminal task regressed: %+v %v", got, err)
		}
	})
	t.Run("successful poll clears stale failure", func(t *testing.T) {
		task := model.VideoTask{ID: "client_video_task_recover", UserID: "owner", Status: "failed", Error: "timeout", ErrorDetail: "old", CompletedAt: "old"}
		if _, err := repository.SaveVideoTask(task); err != nil {
			t.Fatal(err)
		}
		if err := UpdateVideoTaskFromPoll(task, VideoTaskPollUpdate{Status: "processing", ResponseBody: `{"status":"in_progress"}`}); err != nil {
			t.Fatal(err)
		}
		got, _, err := GetUserVideoTask("owner", task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != "processing" || got.Error != "" || got.CompletedAt != "" {
			t.Fatalf("stale failure survived: %+v", got)
		}
	})
}

func testStarframeClaimConcurrentDurable(t *testing.T) {
	// Repository is initialized once by the regression test in this package.
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.User{ID: "claim-owner", Username: "claim-owner", Credits: 100}).Error; err != nil {
		t.Fatal(err)
	}
	input := VideoTaskCreateInput{ClientTaskID: "client_video_task_claim", UserID: "claim-owner", Model: "video", ChannelID: "channel", RequestBody: `{"prompt":"test"}`, Credits: 1}
	var wg sync.WaitGroup
	var claimed atomic.Int32
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, won, e := ClaimStarframeVideoTask(input)
			if e != nil {
				t.Error(e)
			}
			if won {
				claimed.Add(1)
			}
		}()
	}
	wg.Wait()
	if claimed.Load() != 1 {
		t.Fatalf("claims=%d", claimed.Load())
	}
	user, _, err := repository.GetUserByID(input.UserID)
	if err != nil || user.Credits != 99 {
		t.Fatalf("credits=%v err=%v", user.Credits, err)
	}
	if err := DeleteUserVideoTask(input.UserID, input.ClientTaskID); err != nil {
		t.Fatal(err)
	}
	_, won, err := ClaimStarframeVideoTask(input)
	if err != nil || won {
		t.Fatalf("deleted task resubmitted: %v %v", won, err)
	}
	input.UserID = "attacker"
	if _, _, err = ClaimStarframeVideoTask(input); err == nil {
		t.Fatal("cross-user claim accepted")
	}
}

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "canvas-video-tests-")
	if err != nil {
		panic(err)
	}
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(dir, "video.db") + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)"
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}
