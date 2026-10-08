package handler

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestStarframeHTTPDurableSubmission(t *testing.T) {
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(t.TempDir(), "http.db") + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)"
	config.Cfg.AILogDir = t.TempDir()
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	var posts atomic.Int32
	var gets atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			payload, _ := io.ReadAll(r.Body)
			if bytes.Contains(payload, []byte("client_video_task_timeout")) {
				conn, _, e := w.(http.Hijacker).Hijack()
				if e == nil {
					conn.Close()
				}
				return
			}
			fmt.Fprint(w, `{"id":"sfv_original","status":"queued"}`)
			return
		}
		gets.Add(1)
		if r.URL.Path == "/v1/videos/sfv_original/content" {
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Range", "bytes 0-3/4")
			w.WriteHeader(206)
			fmt.Fprint(w, "test")
			return
		}
		fmt.Fprint(w, `{"id":"sfv_original","status":"in_progress"}`)
	}))
	defer upstream.Close()
	settings := model.Settings{}
	settings.Private.Channels = []model.ModelChannel{{ID: "original", Protocol: "starframe", BaseURL: upstream.URL, APIKey: "test-only", Models: []string{"video"}, Weight: 1, Enabled: true}}
	settings.Public.ModelChannel.ModelCosts = []model.ModelCost{{Model: "video", Credits: 1}}
	if _, err = repository.SaveSettings(settings, "now"); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.User{ID: "owner", Username: "owner", Credits: 100}).Error; err != nil {
		t.Fatal(err)
	}
	user := model.AuthUser{ID: "owner", Role: model.UserRoleAdmin}
	request := func(id string) *http.Request {
		body := fmt.Sprintf(`{"model":"video","prompt":"scene","mode":"references","client_task_id":%q,"duration":5,"resolution":"720p"}`, id)
		r := httptest.NewRequest("POST", "/api/ai/videos", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Model-Channel-ID", "original")
		r.Header.Set("X-Client-Video-Task-ID", id)
		return r.WithContext(service.WithUser(context.Background(), user))
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			AIVideos(w, request("client_video_task_http"))
			if !bytes.Contains(w.Body.Bytes(), []byte(`"code":0`)) {
				t.Errorf("request failed: %s", w.Body.String())
			}
		}()
	}
	wg.Wait()
	if posts.Load() != 1 {
		t.Fatalf("POST count=%d", posts.Load())
	}
	got, _, err := repository.GetUserByID("owner")
	if err != nil || got.Credits != 95 {
		t.Fatalf("credits=%v err=%v", got.Credits, err)
	}
	if err = service.DeleteUserVideoTask("owner", "client_video_task_http"); err != nil {
		t.Fatal(err)
	}
	AIVideos(httptest.NewRecorder(), request("client_video_task_http"))
	if posts.Load() != 1 {
		t.Fatal("deleted task resubmitted")
	}
	task, _, err := service.GetUserVideoTask("owner", "sfv_original")
	if err != nil {
		t.Fatal(err)
	}
	task.Status = "failed"
	task.Error = "old failure"
	task.CompletedAt = "old"
	if _, err = repository.SaveVideoTask(task); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/api/ai/videos/sfv_original?model=video", nil).WithContext(service.WithUser(context.Background(), user))
	w := httptest.NewRecorder()
	AIVideo(w, r, "sfv_original")
	recovered, _, err := service.GetUserVideoTask("owner", "sfv_original")
	if err != nil || recovered.Status != "processing" || recovered.Error != "" || !recovered.Hidden {
		t.Fatalf("recovery failed: %+v %v", recovered, err)
	}
	settings.Private.Channels[0].Protocol = "openai"
	if _, err = repository.SaveSettings(settings, "changed"); err != nil {
		t.Fatal(err)
	}
	AIVideos(httptest.NewRecorder(), request("client_video_task_http"))
	if posts.Load() != 1 {
		t.Fatal("protocol change bypassed submission ledger")
	}
	beforeGets := gets.Load()
	AIVideo(httptest.NewRecorder(), r, "sfv_original")
	if gets.Load() != beforeGets {
		t.Fatal("protocol change queried another protocol")
	}
	settings.Private.Channels[0].Protocol = "starframe"
	if _, err = repository.SaveSettings(settings, "restored"); err != nil {
		t.Fatal(err)
	}
	task.Status = "completed"
	if _, err = repository.SaveVideoTask(task); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		owner, model, channel string
		allowed               bool
	}{{"owner", "video", "original", true}, {"attacker", "video", "original", false}, {"owner", "other", "original", false}, {"owner", "video", "changed", false}} {
		r := httptest.NewRequest("GET", "/api/ai/videos/sfv_original/content?model="+tc.model, nil)
		r.Header.Set("X-Model-Channel-ID", tc.channel)
		r.Header.Set("Range", "bytes=0-3")
		r = r.WithContext(service.WithUser(r.Context(), model.AuthUser{ID: tc.owner, Role: model.UserRoleAdmin}))
		w := httptest.NewRecorder()
		AIVideoContent(w, r, "sfv_original")
		if (w.Code == 206) != tc.allowed {
			t.Fatalf("content authorization %+v status=%d body=%s", tc, w.Code, w.Body.String())
		}
	}
	// A response lost after upstream acceptance cannot authorize another POST.
	before := posts.Load()
	AIVideos(httptest.NewRecorder(), request("client_video_task_timeout"))
	AIVideos(httptest.NewRecorder(), request("client_video_task_timeout"))
	if posts.Load() != before+1 {
		t.Fatal("ambiguous HTTP outcome resubmitted")
	}
	// Failure to save the accepted upstream ID retains the permanent claim.
	if err = db.Exec(`CREATE TRIGGER fail_video_result BEFORE UPDATE ON video_tasks WHEN NEW.id='client_video_task_save_failure' BEGIN SELECT RAISE(ABORT,'test result write failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	before = posts.Load()
	AIVideos(httptest.NewRecorder(), request("client_video_task_save_failure"))
	AIVideos(httptest.NewRecorder(), request("client_video_task_save_failure"))
	if posts.Load() != before+1 {
		t.Fatal("failed result persistence resubmitted")
	}
	if err = db.Exec("DROP TRIGGER fail_video_result").Error; err != nil {
		t.Fatal(err)
	}
	// The transaction rolls back its debit when insertion of the claim fails.
	balance, _, _ := repository.GetUserByID("owner")
	if err = db.Exec(`CREATE TRIGGER fail_video_claim BEFORE INSERT ON video_tasks WHEN NEW.id='client_video_task_claim_failure' BEGIN SELECT RAISE(ABORT,'test claim failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	before = posts.Load()
	AIVideos(httptest.NewRecorder(), request("client_video_task_claim_failure"))
	after, _, _ := repository.GetUserByID("owner")
	if posts.Load() != before || balance.Credits != after.Credits {
		t.Fatal("failed claim charged or submitted")
	}
	if err = db.Exec("DROP TRIGGER fail_video_claim").Error; err != nil {
		t.Fatal(err)
	}

}
