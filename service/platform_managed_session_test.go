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
