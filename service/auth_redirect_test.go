package service

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
)

func TestPlatformLaunchTokenExchangeClassifiesPlatformUnavailable(t *testing.T) {
	previousConfig := config.Cfg
	previousClient := platformAuthHTTPClient
	t.Cleanup(func() {
		config.Cfg = previousConfig
		platformAuthHTTPClient = previousClient
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"code":1,"msg":"upstream unavailable"}`))
	}))
	defer server.Close()
	config.Cfg = config.Config{PlatformAPIBaseURL: server.URL, PlatformExchangeSecret: "configured"}

	_, err := LoginWithPlatformLaunchToken(t.Context(), "one-time-token")
	if err == nil || !strings.Contains(err.Error(), "暂时不可用") {
		t.Fatalf("LoginWithPlatformLaunchToken() error = %v, want platform unavailable", err)
	}
}

func TestPlatformLaunchTokenExchangeRejectsInvalidToken(t *testing.T) {
	previousConfig := config.Cfg
	previousClient := platformAuthHTTPClient
	t.Cleanup(func() {
		config.Cfg = previousConfig
		platformAuthHTTPClient = previousClient
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":1,"msg":"invalid"}`))
	}))
	defer server.Close()
	config.Cfg = config.Config{PlatformAPIBaseURL: server.URL, PlatformExchangeSecret: "configured"}

	_, err := LoginWithPlatformLaunchToken(t.Context(), "replayed-token")
	if err == nil || !strings.Contains(err.Error(), "无效或已过期") {
		t.Fatalf("LoginWithPlatformLaunchToken() error = %v, want invalid token", err)
	}
}

func TestPlatformLoginURLTargetsAICreationSpace(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	config.Cfg = config.Config{
		PlatformAPIBaseURL:     "https://api.jisudeng.com",
		PlatformWebURL:         "https://www.jisudeng.com",
		PlatformExchangeSecret: "test-secret",
	}

	if got, want := PlatformLoginURL(), "https://www.jisudeng.com/login?redirect=%2Fai-creation-space"; got != want {
		t.Fatalf("PlatformLoginURL() = %q, want %q", got, want)
	}
}

func TestPlatformEntryURLTargetsAuthenticatedAICreationSpace(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	config.Cfg = config.Config{
		PlatformAPIBaseURL:     "https://api.jisudeng.com",
		PlatformWebURL:         "https://www.jisudeng.com",
		PlatformEntryPath:      "/ai-creation-space",
		PlatformExchangeSecret: "test-secret",
	}

	if got, want := PlatformEntryURL(), "https://www.jisudeng.com/ai-creation-space"; got != want {
		t.Fatalf("PlatformEntryURL() = %q, want %q", got, want)
	}
}

func TestSafeRedirectPath(t *testing.T) {
	cases := map[string]string{
		"/":                   "/",
		"/canvas/abc":         "/canvas/abc",
		"/login?redirect=/x":  "/login?redirect=/x",
		"":                    "/",
		"//evil.com":          "/",
		"/\\evil.com":         "/",
		"https://evil.com":    "/",
		"http://evil.com":     "/",
		"javascript:alert(1)": "/",
		"evil.com":            "/",
		"/\t/evil.com":        "/", // browsers strip the tab → //evil.com
		"/normal\tpath":       "/normalpath",
	}
	for in, want := range cases {
		if got := safeRedirectPath(in); got != want {
			t.Errorf("safeRedirectPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDecodeStateRejectsOpenRedirect(t *testing.T) {
	for _, in := range []string{"//evil.com", "/\\evil.com", "https://evil.com"} {
		state := base64.RawURLEncoding.EncodeToString([]byte(in))
		if got := decodeState(state); got != "/" {
			t.Errorf("decodeState(state(%q)) = %q, want \"/\"", in, got)
		}
	}
	state := base64.RawURLEncoding.EncodeToString([]byte("/canvas/1"))
	if got := decodeState(state); got != "/canvas/1" {
		t.Errorf("decodeState(state(/canvas/1)) = %q, want /canvas/1", got)
	}
}
