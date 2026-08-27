package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestStorageCookieCanAccessStorageRoutesButNotAIProxy(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	t.Cleanup(func() { config.Cfg = previous })

	engine := New()
	cookie := &http.Cookie{Name: service.StorageSessionCookieName, Value: service.NewStorageSession("https://api.example.test", "test-api-key")}

	storageRequest := httptest.NewRequest(http.MethodPost, "/api/storage/files", nil)
	storageRequest.AddCookie(cookie)
	storageRecorder := httptest.NewRecorder()
	engine.ServeHTTP(storageRecorder, storageRequest)
	if storageRecorder.Code == http.StatusUnauthorized {
		t.Fatalf("storage cookie was rejected by storage route: %d", storageRecorder.Code)
	}

	aiRequest := httptest.NewRequest(http.MethodPost, "/api/v1/images/generations", nil)
	aiRequest.AddCookie(cookie)
	aiRecorder := httptest.NewRecorder()
	engine.ServeHTTP(aiRecorder, aiRequest)
	if aiRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("storage cookie entered AI proxy: %d", aiRecorder.Code)
	}
}
