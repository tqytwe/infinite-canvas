package service

import (
	"context"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
)

func TestCreateStorageSessionAcceptsIndependentHTTPSChannelsWithoutPersistingKey(t *testing.T) {
	previousConfig := config.Cfg
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	t.Cleanup(func() { config.Cfg = previousConfig })

	token, err := CreateStorageSession(context.Background(), "https://other.example.test/v1/", "user-api-key")
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
}

func TestStorageSessionOwnerFingerprintIsBoundToAPIAddressAndKey(t *testing.T) {
	previousConfig := config.Cfg
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	t.Cleanup(func() { config.Cfg = previousConfig })

	first := NewStorageSession("https://first.example.test", "same-key")
	second := NewStorageSession("https://first.example.test", "same-key")
	otherKey := NewStorageSession("https://first.example.test", "other-key")
	otherBaseURL := NewStorageSession("https://second.example.test", "same-key")
	firstUser, firstOK := StorageSessionUser(first)
	secondUser, secondOK := StorageSessionUser(second)
	otherKeyUser, otherKeyOK := StorageSessionUser(otherKey)
	otherBaseURLUser, otherBaseURLOK := StorageSessionUser(otherBaseURL)
	if !firstOK || !secondOK || !otherKeyOK || !otherBaseURLOK || firstUser.ID != secondUser.ID || firstUser.ID == otherKeyUser.ID || firstUser.ID == otherBaseURLUser.ID {
		t.Fatalf("unexpected storage owners: first=%#v second=%#v other-key=%#v other-base-url=%#v", firstUser, secondUser, otherKeyUser, otherBaseURLUser)
	}
	if _, ok := StorageSessionUser("same-key"); ok {
		t.Fatal("raw API key must never authenticate as a storage session")
	}
}

func TestCreateStorageSessionRejectsUnsafeBaseURLs(t *testing.T) {
	previousConfig := config.Cfg
	config.Cfg = config.Config{JWTSecret: "test-jwt-secret"}
	t.Cleanup(func() { config.Cfg = previousConfig })

	for _, baseURL := range []string{"http://example.test", "https:///v1", "https://user@example.test", "https://example.test/v1?x=1", "https://example.test/v1#fragment"} {
		if _, err := CreateStorageSession(context.Background(), baseURL, "user-api-key"); err == nil {
			t.Fatalf("CreateStorageSession(%q) succeeded", baseURL)
		}
	}
}
