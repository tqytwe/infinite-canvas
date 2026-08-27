package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
)

type storageSessionRoundTripper func(*http.Request) (*http.Response, error)

func (fn storageSessionRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestCreateStorageSessionOnlyValidatesJisudengModelAPIAndNeverPersistsKey(t *testing.T) {
	previousConfig, previousClient := config.Cfg, storageSessionHTTPClient
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	storageSessionHTTPClient = &http.Client{Transport: storageSessionRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://api.jisudeng.com/v1/models" {
			t.Fatalf("validation URL = %q", request.URL.String())
		}
		if request.Header.Get("Authorization") != "Bearer user-api-key" {
			t.Fatal("validation request must use the submitted key once")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"data":[]}`)), Header: make(http.Header)}, nil
	})}
	t.Cleanup(func() {
		config.Cfg = previousConfig
		storageSessionHTTPClient = previousClient
	})

	token, err := CreateStorageSession(context.Background(), "https://api.jisudeng.com/v1", "user-api-key")
	if err != nil {
		t.Fatalf("CreateStorageSession() error = %v", err)
	}
	if strings.Contains(token, "user-api-key") {
		t.Fatal("storage cookie token must not contain the API key")
	}
	user, ok := StorageSessionUser(token)
	if !ok || !strings.HasPrefix(user.ID, "api-key:") || user.Role != "user" {
		t.Fatalf("storage session user = %#v, ok=%t", user, ok)
	}
	if _, err := CreateStorageSession(context.Background(), "https://example.com", "user-api-key"); err == nil || !strings.Contains(err.Error(), "极速蹬") {
		t.Fatalf("unexpected external base URL result: %v", err)
	}
}

func TestStorageSessionOwnerFingerprintIsStableButKeyIsNotReusableAsToken(t *testing.T) {
	previousConfig := config.Cfg
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	t.Cleanup(func() { config.Cfg = previousConfig })

	first := NewStorageSession("same-key")
	second := NewStorageSession("same-key")
	other := NewStorageSession("other-key")
	firstUser, firstOK := StorageSessionUser(first)
	secondUser, secondOK := StorageSessionUser(second)
	otherUser, otherOK := StorageSessionUser(other)
	if !firstOK || !secondOK || !otherOK || firstUser.ID != secondUser.ID || firstUser.ID == otherUser.ID {
		t.Fatalf("unexpected storage owners: first=%#v second=%#v other=%#v", firstUser, secondUser, otherUser)
	}
	if _, ok := StorageSessionUser("same-key"); ok {
		t.Fatal("raw API key must never authenticate as a storage session")
	}
}
