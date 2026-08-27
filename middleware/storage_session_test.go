package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestStorageSessionCannotEnterAccountOnlyRoute(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	t.Cleanup(func() { config.Cfg = previous })

	engine := gin.New()
	engine.GET("/storage", StorageSessionAuth, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	engine.POST("/ai", UserAuth, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	cookie := &http.Cookie{Name: service.StorageSessionCookieName, Value: service.NewStorageSession("user-api-key")}

	storageRequest := httptest.NewRequest(http.MethodGet, "/storage", nil)
	storageRequest.AddCookie(cookie)
	storageRecorder := httptest.NewRecorder()
	engine.ServeHTTP(storageRecorder, storageRequest)
	if storageRecorder.Code != http.StatusNoContent {
		t.Fatalf("storage request status = %d", storageRecorder.Code)
	}

	aiRequest := httptest.NewRequest(http.MethodPost, "/ai", nil)
	aiRequest.AddCookie(cookie)
	aiRecorder := httptest.NewRecorder()
	engine.ServeHTTP(aiRecorder, aiRequest)
	if aiRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("AI request status = %d, want %d", aiRecorder.Code, http.StatusUnauthorized)
	}
}
