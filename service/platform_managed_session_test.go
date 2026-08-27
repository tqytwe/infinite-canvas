package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func withPlatformSessionTestConfig(t *testing.T, apiURL string) {
	t.Helper()
	previousConfig := config.Cfg
	previousClient := platformAuthHTTPClient
	config.Cfg = config.Config{
		PlatformAPIBaseURL:     apiURL,
		PlatformExchangeSecret: "exchange-secret",
		JWTSecret:              "canvas-jwt-secret",
	}
	platformAuthHTTPClient = &http.Client{Timeout: time.Second}
	t.Cleanup(func() {
		config.Cfg = previousConfig
		platformAuthHTTPClient = previousClient
	})
}

func testPlatformSessionPayload() string {
	expiresAt := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	return `{"code":0,"data":{"expires_at":"` + expiresAt + `","sessions":{"chat":{"user_id":7,"api_key":"chat-key","api_key_id":11,"purpose":"chat"},"image":{"user_id":7,"api_key":"image-key","api_key_id":12,"purpose":"image"},"video":{"user_id":7,"api_key":"video-key","api_key_id":13,"purpose":"video"}}}}`
}

func TestPlatformSessionExchangeUsesScopedSessions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nextchat/session" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("X-NextChat-Secret") != "exchange-secret" {
			t.Fatal("missing exchange secret")
		}
		var request map[string]string
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request["launch_token"] != "one-time-token" {
			t.Fatalf("launch token = %q", request["launch_token"])
		}
		_, _ = w.Write([]byte(testPlatformSessionPayload()))
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	session, err := platformExchangeManagedSession(context.Background(), "one-time-token")
	if err != nil {
		t.Fatalf("exchange error = %v", err)
	}
	if got := session.Sessions["image"].APIKey; got != "image-key" {
		t.Fatalf("image key = %q", got)
	}
	if got := session.Sessions["video"].APIKeyID; got != 13 {
		t.Fatalf("video key id = %d", got)
	}
}

func TestPlatformSessionExchangeAllowsLegacyChatOnlyButDoesNotInventMediaKeys(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		expiresAt := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
		_, _ = w.Write([]byte(`{"code":0,"data":{"user_id":7,"api_key":"chat-key","api_key_id":11,"purpose":"chat","expires_at":"` + expiresAt + `"}}`))
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	session, err := platformExchangeManagedSession(context.Background(), "legacy-token")
	if err != nil {
		t.Fatalf("exchange error = %v", err)
	}
	if _, exists := session.Sessions["image"]; exists {
		t.Fatal("legacy chat session must not become an image session")
	}
	if _, exists := session.Sessions["video"]; exists {
		t.Fatal("legacy chat session must not become a video session")
	}
}

func TestPlatformSessionExchangeRejectsExpiredAndRepeatedTokens(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		if requests == 1 {
			expiresAt := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
			_, _ = w.Write([]byte(`{"code":0,"data":{"user_id":7,"api_key":"chat-key","api_key_id":11,"purpose":"chat","expires_at":"` + expiresAt + `"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":1,"msg":"consumed"}`))
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	if _, err := platformExchangeManagedSession(context.Background(), "expired-token"); err == nil || !strings.Contains(err.Error(), "已过期") {
		t.Fatalf("expired error = %v", err)
	}
	if _, err := platformExchangeManagedSession(context.Background(), "replayed-token"); err == nil || !strings.Contains(err.Error(), "无效") {
		t.Fatalf("replayed error = %v", err)
	}
}

func TestPlatformSessionCipherAndBootstrapRedactionNeverExposeAPIKeys(t *testing.T) {
	withPlatformSessionTestConfig(t, "https://api.example.test")
	session := PlatformManagedSession{
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		Sessions: map[string]PlatformManagedSessionKey{
			"chat": {UserID: 7, APIKey: "secret-chat-key", APIKeyID: 11, Purpose: "chat"},
		},
	}
	ciphertext, err := encryptPlatformSession(session)
	if err != nil {
		t.Fatalf("encrypt = %v", err)
	}
	if strings.Contains(ciphertext, "secret-chat-key") {
		t.Fatal("ciphertext contains raw API key")
	}
	decrypted, err := decryptPlatformSession(ciphertext)
	if err != nil || decrypted.Sessions["chat"].APIKey != "secret-chat-key" {
		t.Fatalf("decrypt = %#v, %v", decrypted, err)
	}

	redacted := redactPlatformSecrets(map[string]any{
		"models":  []any{map[string]any{"id": "sensenova-u1-fast", "modalities": []any{"image"}}},
		"api_key": "secret-chat-key",
		"nested":  map[string]any{"apiKey": "another-secret", "authorization": "Bearer value"},
	}).(map[string]any)
	raw, _ := json.Marshal(redacted)
	if strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "authorization") || strings.Contains(string(raw), "api_key") {
		t.Fatalf("redacted bootstrap = %s", raw)
	}
	if !strings.Contains(string(raw), "sensenova-u1-fast") {
		t.Fatalf("model capability lost from bootstrap = %s", raw)
	}
}

func TestPlatformBootstrapUsesBFFHeadersAndLeavesCapabilitiesIntact(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nextchat/bootstrap" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("X-NextChat-User-ID") != "7" || r.Header.Get("X-NextChat-API-Key-ID") != "12" {
			t.Fatalf("BFF headers = user=%q key=%q", r.Header.Get("X-NextChat-User-ID"), r.Header.Get("X-NextChat-API-Key-ID"))
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"models":{"groups":[{"models":[{"id":"sensenova-u1-fast","modalities":["image"],"image_capabilities":{"operations":["create"]}}]}]}}}`))
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	payload, err := platformBootstrapForSession(context.Background(), PlatformManagedSessionKey{UserID: 7, APIKeyID: 12, APIKey: "never-sent", Purpose: "image"})
	if err != nil {
		t.Fatalf("bootstrap = %v", err)
	}
	raw, _ := json.Marshal(payload)
	if !strings.Contains(string(raw), "sensenova-u1-fast") || !strings.Contains(string(raw), "image_capabilities") {
		t.Fatalf("capabilities missing = %s", raw)
	}
}

func TestPlatformBootstrapRetainsVideoAvailabilityDiagnostics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":0,"data":{"models":{"groups":[{"id":23,"video_available":false,"video_unavailable_code":"no_schedulable_account","models":[{"id":"grok-video","modalities":["video"],"adapter":"grok_video","capability_version":"v1","video_capabilities":{"operations":["generate"]}}]}]}}}`))
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	payload, err := platformBootstrapForSession(context.Background(), PlatformManagedSessionKey{UserID: 7, APIKeyID: 13, APIKey: "never-sent", Purpose: "video"})
	if err != nil {
		t.Fatalf("bootstrap = %v", err)
	}
	raw, _ := json.Marshal(payload)
	if !strings.Contains(string(raw), `"video_available":false`) || !strings.Contains(string(raw), `"video_unavailable_code":"no_schedulable_account"`) {
		t.Fatalf("video availability diagnostics missing = %s", raw)
	}
}

func TestPlatformManagedBootstrapKeepsHealthyScopesWhenVideoBootstrapFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("X-NextChat-API-Key-ID") {
		case "13":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"code":1,"msg":"video unavailable"}`))
		case "11":
			_, _ = w.Write([]byte(`{"code":0,"data":{"user":{"id":7},"models":{"groups":[{"id":1,"models":[{"id":"chat-model","modalities":["chat"]}]}]}}}`))
		case "12":
			_, _ = w.Write([]byte(`{"code":0,"data":{"user":{"id":7},"models":{"groups":[{"id":2,"models":[{"id":"sensenova-u1-fast","modalities":["image"],"adapter":"sensenova","capability_version":"v1","image_capabilities":{"operations":["create"]}}]}]}}}`))
		default:
			t.Fatalf("unexpected API key ID %q", r.Header.Get("X-NextChat-API-Key-ID"))
		}
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	payload, err := platformManagedBootstrapForScopes(context.Background(), PlatformManagedSession{
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		Sessions: map[string]PlatformManagedSessionKey{
			"chat":  {UserID: 7, APIKey: "chat-key", APIKeyID: 11, Purpose: "chat"},
			"image": {UserID: 7, APIKey: "image-key", APIKeyID: 12, Purpose: "image"},
			"video": {UserID: 7, APIKey: "video-key", APIKeyID: 13, Purpose: "video"},
		},
	})
	if err != nil {
		t.Fatalf("bootstrap error = %v", err)
	}
	workspaces, ok := payload["workspaces"].(map[string]any)
	if !ok || workspaces["chat"] == nil || workspaces["image"] == nil {
		t.Fatalf("healthy workspaces missing = %#v", payload["workspaces"])
	}
	if _, exists := workspaces["video"]; exists {
		t.Fatalf("failed video workspace must not be exposed = %#v", workspaces["video"])
	}
	compatibility, ok := payload["compatibility"].(map[string]any)
	if !ok || compatibility["state"] != "partial_managed_capabilities" {
		t.Fatalf("compatibility = %#v", payload["compatibility"])
	}
	purposes, ok := compatibility["unavailable_purposes"].([]string)
	if !ok || len(purposes) != 1 || purposes[0] != "video" {
		t.Fatalf("unavailable purposes = %#v", compatibility["unavailable_purposes"])
	}
	raw, _ := json.Marshal(payload)
	if !strings.Contains(string(raw), "sensenova-u1-fast") || strings.Contains(string(raw), "image-key") {
		t.Fatalf("partial bootstrap payload = %s", raw)
	}
}

func TestPlatformManagedBootstrapFailsWhenNoScopeSucceeds(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"code":1,"msg":"unavailable"}`))
	}))
	defer server.Close()
	withPlatformSessionTestConfig(t, server.URL)

	_, err := platformManagedBootstrapForScopes(context.Background(), PlatformManagedSession{
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		Sessions: map[string]PlatformManagedSessionKey{
			"chat":  {UserID: 7, APIKey: "chat-key", APIKeyID: 11, Purpose: "chat"},
			"image": {UserID: 7, APIKey: "image-key", APIKeyID: 12, Purpose: "image"},
			"video": {UserID: 7, APIKey: "video-key", APIKeyID: 13, Purpose: "video"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "创作能力暂不可用") {
		t.Fatalf("all-failed bootstrap error = %v", err)
	}
}

func TestPlatformGroupSwitchRequiresPinnedReplacementAndPersistsPurposeSession(t *testing.T) {
	withPlatformSessionTestConfig(t, "https://api.example.test")
	session := PlatformManagedSession{
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		Sessions: map[string]PlatformManagedSessionKey{
			"chat":  {UserID: 7, APIKey: "chat-key", APIKeyID: 11, Purpose: "chat"},
			"image": {UserID: 7, APIKey: "old-image-key", APIKeyID: 12, Purpose: "image"},
			"video": {UserID: 7, APIKey: "video-key", APIKeyID: 13, Purpose: "video"},
		},
		Groups: map[string]int64{},
	}
	user := &model.User{ID: "canvas-user"}
	replacement, err := decodePlatformManagedGroupSwitchResponse(json.RawMessage(`{"purpose":"image","session_binding":"group-pinned-v1","session":{"user_id":7,"api_key":"new-image-key","api_key_id":42,"purpose":"image","group_id":8,"binding":"group-pinned-v1"}}`), "image", session.Sessions["image"], 8)
	if err != nil {
		t.Fatalf("decode replacement = %v", err)
	}
	if err := persistPlatformManagedReplacementSession(user, &session, "image", replacement); err != nil {
		t.Fatalf("persist replacement = %v", err)
	}
	if strings.Contains(user.Extra, "new-image-key") {
		t.Fatal("encrypted Canvas user session exposed replacement API key")
	}
	if got := session.Sessions["image"]; got.APIKey != "old-image-key" || got.APIKeyID != 12 || got.GroupID != 0 || got.Binding != "" {
		t.Fatalf("base image session changed = %#v", got)
	}
	if got, found := platformManagedSessionForGroup(session, "image", 8); !found || got.APIKey != "new-image-key" || got.APIKeyID != 42 || got.GroupID != 8 || got.Binding != "group-pinned-v1" {
		t.Fatalf("persisted image group session = %#v, found=%t", got, found)
	}
	if got := session.Sessions["video"].APIKey; got != "video-key" {
		t.Fatalf("unrelated video session changed = %q", got)
	}
}

func TestPlatformGroupPinnedSessionsRemainDistinctAcrossConcurrentGroups(t *testing.T) {
	withPlatformSessionTestConfig(t, "https://api.example.test")
	session := PlatformManagedSession{
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		Sessions: map[string]PlatformManagedSessionKey{
			"chat":  {UserID: 7, APIKey: "chat-key", APIKeyID: 11, Purpose: "chat"},
			"image": {UserID: 7, APIKey: "base-image-key", APIKeyID: 12, Purpose: "image"},
		},
	}
	user := &model.User{ID: "canvas-user"}
	for _, replacement := range []PlatformManagedSessionKey{
		{UserID: 7, APIKey: "image-group-8", APIKeyID: 42, Purpose: "image", GroupID: 8, Binding: platformGroupPinnedSessionBinding},
		{UserID: 7, APIKey: "image-group-9", APIKeyID: 43, Purpose: "image", GroupID: 9, Binding: platformGroupPinnedSessionBinding},
	} {
		if err := persistPlatformManagedReplacementSession(user, &session, "image", replacement); err != nil {
			t.Fatalf("persist group %d = %v", replacement.GroupID, err)
		}
	}

	groupEight, foundEight := platformManagedSessionForGroup(session, "image", 8)
	groupNine, foundNine := platformManagedSessionForGroup(session, "image", 9)
	if !foundEight || !foundNine || groupEight.APIKey != "image-group-8" || groupNine.APIKey != "image-group-9" {
		t.Fatalf("group-pinned sessions = group8=%#v found=%t group9=%#v found=%t", groupEight, foundEight, groupNine, foundNine)
	}
	if got := session.Sessions["image"].APIKey; got != "base-image-key" {
		t.Fatalf("base purpose session changed = %q", got)
	}
	if got := session.GroupSessions["image"]; len(got) != 2 {
		t.Fatalf("group-pinned cache length = %d, want 2", len(got))
	}
}

func TestPlatformManagedGroupSessionRebasePreservesAnotherPurposeReplacement(t *testing.T) {
	withPlatformSessionTestConfig(t, "https://api.example.test")
	base := PlatformManagedSession{
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		Sessions: map[string]PlatformManagedSessionKey{
			"chat":  {UserID: 7, APIKey: "chat-key", APIKeyID: 11, Purpose: "chat"},
			"image": {UserID: 7, APIKey: "base-image-key", APIKeyID: 12, Purpose: "image"},
			"video": {UserID: 7, APIKey: "base-video-key", APIKeyID: 13, Purpose: "video"},
		},
	}

	// This mirrors an image switch winning the database compare-and-swap before
	// a concurrent video switch retries from the current encrypted payload.
	imageUser := &model.User{ID: "canvas-user"}
	imageSession := base
	imageReplacement := PlatformManagedSessionKey{UserID: 7, APIKey: "image-group-8", APIKeyID: 42, Purpose: "image", GroupID: 8, Binding: platformGroupPinnedSessionBinding}
	if err := persistPlatformManagedReplacementSession(imageUser, &imageSession, "image", imageReplacement); err != nil {
		t.Fatalf("persist image replacement: %v", err)
	}

	rebasedSession, err := readPlatformManagedSession(*imageUser)
	if err != nil {
		t.Fatalf("read persisted image session: %v", err)
	}
	videoReplacement := PlatformManagedSessionKey{UserID: 7, APIKey: "video-group-23", APIKeyID: 43, Purpose: "video", GroupID: 23, Binding: platformGroupPinnedSessionBinding}
	if err := persistPlatformManagedReplacementSession(imageUser, &rebasedSession, "video", videoReplacement); err != nil {
		t.Fatalf("persist rebased video replacement: %v", err)
	}

	finalSession, err := readPlatformManagedSession(*imageUser)
	if err != nil {
		t.Fatalf("read final session: %v", err)
	}
	if got, found := platformManagedSessionForGroup(finalSession, "image", 8); !found || got.APIKeyID != 42 {
		t.Fatalf("image replacement lost after rebase: %#v found=%t", got, found)
	}
	if got, found := platformManagedSessionForGroup(finalSession, "video", 23); !found || got.APIKeyID != 43 {
		t.Fatalf("video replacement missing after rebase: %#v found=%t", got, found)
	}
}

func TestPlatformManagedGroupSessionNeverFallsBackToBasePurposeKey(t *testing.T) {
	session := PlatformManagedSession{
		Sessions: map[string]PlatformManagedSessionKey{
			"image": {UserID: 7, APIKey: "base-image-key", APIKeyID: 12, Purpose: "image"},
		},
	}

	if _, err := requirePlatformManagedSessionForGroup(session, "image", 8); err == nil {
		t.Fatal("a selected image group must not fall back to the base image key")
	}
	base, err := requirePlatformManagedSessionForGroup(session, "image", 0)
	if err != nil || base.APIKey != "base-image-key" {
		t.Fatalf("unscoped image session = %#v, %v", base, err)
	}

	session.GroupSessions = map[string]map[int64]PlatformManagedSessionKey{
		"image": {
			8: {UserID: 7, APIKey: "group-image-key", APIKeyID: 42, Purpose: "image", GroupID: 8, Binding: platformGroupPinnedSessionBinding},
		},
	}
	pinned, err := requirePlatformManagedSessionForGroup(session, "image", 8)
	if err != nil || pinned.APIKey != "group-image-key" {
		t.Fatalf("group-pinned image session = %#v, %v", pinned, err)
	}
}

func TestParsePlatformManagedChannelIDRejectsPurposeMismatch(t *testing.T) {
	for _, tc := range []struct {
		name            string
		channelID       string
		fallbackPurpose string
		wantPurpose     string
		wantGroup       int64
		wantErr         bool
	}{
		{name: "matching image group", channelID: "platform-managed:image:17", fallbackPurpose: "image", wantPurpose: "image", wantGroup: 17},
		{name: "matching video group", channelID: "platform-managed:video:23", fallbackPurpose: "video", wantPurpose: "video", wantGroup: 23},
		{name: "legacy empty channel keeps chat compatibility", fallbackPurpose: "chat", wantPurpose: "chat"},
		{name: "legacy empty channel cannot bypass image group binding", fallbackPurpose: "image", wantErr: true},
		{name: "legacy empty channel cannot bypass video group binding", fallbackPurpose: "video", wantErr: true},
		{name: "image cannot be used for a video request", channelID: "platform-managed:image:17", fallbackPurpose: "video", wantErr: true},
		{name: "video cannot be used for a chat request", channelID: "platform-managed:video:23", fallbackPurpose: "chat", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			purpose, groupID, _, err := parsePlatformManagedChannelID(tc.channelID, tc.fallbackPurpose)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected purpose mismatch to fail")
				}
				return
			}
			if err != nil || purpose != tc.wantPurpose || groupID != tc.wantGroup {
				t.Fatalf("parsed channel = purpose=%q group=%d err=%v", purpose, groupID, err)
			}
		})
	}
}

func TestPlatformGroupSwitchRejectsMissingOrMutableReplacementSession(t *testing.T) {
	previous := PlatformManagedSessionKey{UserID: 7, APIKey: "old-image-key", APIKeyID: 12, Purpose: "image"}
	for name, raw := range map[string]string{
		"missing session":        `{"purpose":"image","session_binding":"group-pinned-v1"}`,
		"missing top binding":    `{"purpose":"image","session":{"user_id":7,"api_key":"replacement","api_key_id":42,"purpose":"image","group_id":8,"binding":"group-pinned-v1"}}`,
		"mutable nested binding": `{"purpose":"image","session_binding":"group-pinned-v1","session":{"user_id":7,"api_key":"replacement","api_key_id":42,"purpose":"image","group_id":8}}`,
		"wrong purpose":          `{"purpose":"video","session_binding":"group-pinned-v1","session":{"user_id":7,"api_key":"replacement","api_key_id":42,"purpose":"video","group_id":8,"binding":"group-pinned-v1"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodePlatformManagedGroupSwitchResponse(json.RawMessage(raw), "image", previous, 8); err == nil {
				t.Fatal("mutable or incomplete replacement session must be rejected")
			}
		})
	}
}

func TestPlatformManagedMediaModelRequiresDeclaredGroupOperationAndAdapter(t *testing.T) {
	workspace := map[string]any{
		"selected_group_id": float64(12),
		"groups": []any{
			map[string]any{
				"id": float64(12),
				"models": []any{
					map[string]any{
						"id":                 "sensenova-u1.5-lite",
						"modalities":         []any{"image"},
						"adapter":            "sensenova",
						"capability_version": "2026-08-26.1",
						"image_capabilities": map[string]any{"operations": []any{"create", "edit"}},
					},
				},
			},
		},
	}

	if err := validatePlatformManagedMediaModel(workspace, 12, "sensenova-u1.5-lite", "image", "create"); err != nil {
		t.Fatalf("declared image create = %v", err)
	}
	if err := validatePlatformManagedMediaModel(workspace, 12, "sensenova-u1.5-lite", "image", "variation"); err == nil {
		t.Fatal("undeclared image operation must be rejected")
	}
	if err := validatePlatformManagedMediaModel(workspace, 12, "sensenova-u1.5-lite", "image", "generation"); err == nil {
		t.Fatal("legacy image operation alias must be rejected")
	}
	if err := validatePlatformManagedMediaModel(workspace, 99, "sensenova-u1.5-lite", "image", "create"); err == nil {
		t.Fatal("model from a different group must be rejected")
	}
	if err := validatePlatformManagedMediaModel(map[string]any{
		"groups": []any{map[string]any{
			"id": float64(12),
			"models": []any{map[string]any{
				"id": "sensenova-u1.5-lite", "modalities": []any{"image"},
				"image_capabilities": map[string]any{"operations": []any{"create"}},
			}},
		}},
	}, 12, "sensenova-u1.5-lite", "image", "create"); err == nil {
		t.Fatal("a missing execution adapter must be rejected")
	}
	if err := validatePlatformManagedMediaModel(map[string]any{
		"groups": []any{
			map[string]any{
				"id": float64(12), "is_current": true,
				"models": []any{map[string]any{
					"id": "unrelated-model", "modalities": []any{"image"}, "adapter": "other", "capability_version": "v1",
					"image_capabilities": map[string]any{"operations": []any{"create"}},
				}},
			},
			map[string]any{
				"id": float64(13),
				"models": []any{map[string]any{
					"id": "sensenova-u1.5-lite", "modalities": []any{"image"}, "adapter": "sensenova", "capability_version": "v1",
					"image_capabilities": map[string]any{"operations": []any{"create"}},
				}},
			},
		},
	}, 0, "sensenova-u1.5-lite", "image", "create"); err == nil {
		t.Fatal("a model in another group must not be accepted when the requested group is omitted")
	}
}

func TestPlatformManagedVideoModelFailsClosedWhenGroupIsExplicitlyUnavailable(t *testing.T) {
	blocked := map[string]any{
		"groups": []any{map[string]any{
			"id":                     float64(23),
			"video_available":        false,
			"video_unavailable_code": "no_schedulable_account",
			"models": []any{map[string]any{
				"id": "grok-video", "modalities": []any{"video"}, "adapter": "grok_video", "capability_version": "v1",
				"video_capabilities": map[string]any{"operations": []any{"generate"}},
			}},
		}},
	}
	if err := validatePlatformManagedMediaModel(blocked, 23, "grok-video", "video", "generate"); err == nil || !strings.Contains(err.Error(), "暂时没有可用账号") || strings.Contains(err.Error(), "no_schedulable_account") {
		t.Fatalf("explicit unavailable video group must fail closed with a localized reason: %v", err)
	}
	blockedGroup := blocked["groups"].([]any)[0].(map[string]any)
	blockedGroup["video_unavailable_code"] = "future_platform_code"
	if err := validatePlatformManagedMediaModel(blocked, 23, "grok-video", "video", "generate"); err == nil || !strings.Contains(err.Error(), "视频分组暂不可用") || strings.Contains(err.Error(), "future_platform_code") {
		t.Fatalf("unknown video unavailability code must remain localized: %v", err)
	}

	legacy := map[string]any{
		"groups": []any{map[string]any{
			"id": float64(23),
			"models": []any{map[string]any{
				"id": "grok-video", "modalities": []any{"video"}, "adapter": "grok_video", "capability_version": "v1",
				"video_capabilities": map[string]any{"operations": []any{"generate"}},
			}},
		}},
	}
	if err := validatePlatformManagedMediaModel(legacy, 23, "grok-video", "video", "generate"); err != nil {
		t.Fatalf("legacy video workspace without availability metadata must remain compatible: %v", err)
	}
}
