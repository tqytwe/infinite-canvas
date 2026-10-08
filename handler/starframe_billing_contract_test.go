package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func assertStarframeInvalidBillingParametersNeverClaimChargeOrPost(t *testing.T, user model.AuthUser, posts *atomic.Int32) {
	t.Helper()
	cases := []struct {
		name, field string
		value       any
	}{
		{"missing duration", "duration", nil}, {"zero", "duration", 0},
		{"negative", "duration", -1}, {"fraction", "duration", 1.5},
		{"too long", "duration", 20}, {"string duration", "duration", "5"},
		{"missing resolution", "resolution", nil}, {"empty resolution", "resolution", ""},
		{"unsupported resolution", "resolution", "4k"}, {"numeric resolution", "resolution", 720},
	}
	for _, reference := range []string{"https://media.example/image.png#fragment", "https://media.internal/image.png", "http://singlelabel/image.png", "http://123.456/image.png", "https://media.example:0/image.png", "https://media.example:65536/image.png", "http://192.0.2.1/image.png", "http://198.18.0.1/image.png", "http://203.0.113.1/image.png", "https://[2001::1]/image.png", "https://[2620:4f:8000::1]/image.png", "https://[3fff::1]/image.png"} {
		cases = append(cases, struct {
			name, field string
			value       any
		}{"invalid reference " + reference, "references", map[string]any{"image": reference}})
	}
	for _, extra := range []string{`"duration":5`, `"references":{"image":"https://media.example/a.png","image":"https://media.example/b.png"}`, `"extra":` + strings.Repeat("[", 129) + "0" + strings.Repeat("]", 129)} {
		cases = append(cases, struct {
			name, field string
			value       any
		}{"ambiguous JSON " + extra[:12], "raw_extra", extra})
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := fmt.Sprintf("client_video_task_invalid_%d", i)
			body := map[string]any{"model": "video", "prompt": "scene", "mode": "references", "client_task_id": id, "duration": 5, "resolution": "720p"}
			if tc.field == "raw_extra" {
				// Added below after serialization to preserve duplicate keys.
			} else if tc.value == nil {
				delete(body, tc.field)
			} else {
				body[tc.field] = tc.value
			}
			payload, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			if tc.field == "raw_extra" {
				payload = append(payload[:len(payload)-1], []byte(","+tc.value.(string)+"}")...)
			}
			r := httptest.NewRequest(http.MethodPost, "/api/ai/videos", bytes.NewReader(payload))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Model-Channel-ID", "original")
			r.Header.Set("X-Client-Video-Task-ID", id)
			w := httptest.NewRecorder()
			AIVideos(w, r.WithContext(service.WithUser(context.Background(), user)))
			if bytes.Contains(w.Body.Bytes(), []byte(`"code":0`)) {
				t.Errorf("invalid request accepted: %s", w.Body.String())
			}
			got, _, err := repository.GetUserByID(user.ID)
			if err != nil || got.Credits != 100 {
				t.Errorf("invalid request charged: credits=%v err=%v", got.Credits, err)
			}
			if _, found, err := service.GetUserVideoTask(user.ID, id); err != nil || found {
				t.Errorf("invalid request claimed: found=%v err=%v", found, err)
			}
			if posts.Load() != 0 {
				t.Errorf("invalid request reached upstream: posts=%d", posts.Load())
			}
		})
	}
}
