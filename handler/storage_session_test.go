package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateStorageSessionRejectsInvalidAddressWithoutEchoingSubmittedKey(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/storage-session", bytes.NewBufferString(`{"baseUrl":"http://example.invalid","apiKey":"test-api-key"}`))
	recorder := httptest.NewRecorder()

	CreateStorageSession(recorder, request)

	if !strings.Contains(recorder.Header().Get("Set-Cookie"), "canvas_storage_session=;") {
		t.Fatalf("failure must clear storage cookie: %q", recorder.Header().Get("Set-Cookie"))
	}
	if !strings.Contains(recorder.Header().Get("Set-Cookie"), "HttpOnly") || !strings.Contains(recorder.Header().Get("Set-Cookie"), "Secure") {
		t.Fatalf("storage cookie flags missing: %q", recorder.Header().Get("Set-Cookie"))
	}
	if strings.Contains(recorder.Body.String(), "test-api-key") {
		t.Fatal("response must never echo submitted API Key")
	}
}
