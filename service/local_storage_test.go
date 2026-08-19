package service

import (
	"bytes"
	"context"
	"encoding/json"
	neturl "net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestLocalStoragePathRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	original := config.Cfg.CanvasDataDir
	config.Cfg.CanvasDataDir = root
	t.Cleanup(func() { config.Cfg.CanvasDataDir = original })

	for _, key := range []string{"../outside", "/absolute/path", "media/../outside"} {
		if _, err := localStoragePath(key); err == nil {
			t.Fatalf("expected path traversal to be rejected: %q", key)
		}
	}
	valid, err := localStoragePath(filepath.ToSlash(filepath.Join("media", "users", "u1", "2026", "08", "object.mp4")))
	if err != nil || !filepath.IsAbs(valid) {
		t.Fatalf("expected valid local storage path, got %q: %v", valid, err)
	}
}

func TestSignedStorageURLRejectsTamperingAndExpiry(t *testing.T) {
	original := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = original })

	signedURL := SignedStorageURL("object-id", "user-a")
	query := signedURL[strings.Index(signedURL, "?")+1:]
	values, err := neturl.ParseQuery(query)
	if err != nil {
		t.Fatal(err)
	}
	if !verifyStorageSignature("object-id", "user-a", values.Get("expires"), values.Get("signature")) {
		t.Fatal("expected freshly signed URL to verify")
	}
	if verifyStorageSignature("object-id", "user-b", values.Get("expires"), values.Get("signature")) {
		t.Fatal("expected owner tampering to fail")
	}
	expired := time.Now().Add(-time.Minute).Unix()
	if verifyStorageSignature("object-id", "user-a", strconv.FormatInt(expired, 10), values.Get("signature")) {
		t.Fatal("expected expired signature to fail")
	}
}

func TestUploadLocalObjectIsOwnerScoped(t *testing.T) {
	root := t.TempDir()
	original := config.Cfg
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(root, "canvas.db")
	config.Cfg.CanvasDataDir = filepath.Join(root, "media-root")
	config.Cfg.CanvasStorageLimit = 10 << 20
	config.Cfg.CanvasStorageReserve = 1 << 20
	config.Cfg.CanvasUserStorageLimit = 8 << 20
	config.Cfg.CanvasMaxObjectBytes = 4 << 20
	config.Cfg.JWTSecret = "test-secret"
	t.Cleanup(func() { config.Cfg = original })

	owner := WithUser(context.Background(), model.AuthUser{ID: "user-a", Role: model.UserRoleUser})
	uploaded, err := UploadLocalObject(owner, "clip.mp4", "video/mp4", bytes.NewReader([]byte("media")), "video", "task-1")
	if err != nil {
		t.Fatalf("upload failed: %v", err)
	}
	if !strings.HasPrefix(uploaded.StorageKey, "server:") || uploaded.URL == "" {
		t.Fatalf("unexpected upload result: %+v", uploaded)
	}
	objectID := strings.TrimPrefix(uploaded.StorageKey, "server:")
	object, err := StorageObjectForRequest(owner, objectID, "", "")
	if err != nil || object.CreatedBy != "user-a" {
		t.Fatalf("owner could not read object: %+v %v", object, err)
	}
	other := WithUser(context.Background(), model.AuthUser{ID: "user-b", Role: model.UserRoleUser})
	if _, err := StorageObjectForRequest(other, objectID, "", ""); err == nil {
		t.Fatal("expected cross-user object access to fail")
	}
	if _, err := os.Stat(filepath.Join(config.Cfg.CanvasDataDir, object.ObjectKey)); err != nil {
		t.Fatalf("stored file missing: %v", err)
	}
	assetData := json.RawMessage(`{"assets":[{"id":"asset-1","kind":"video","title":"clip","data":{"url":"","storageKey":"server:` + objectID + `","mimeType":"video/mp4"}}]}`)
	if _, err := SaveCurrentUserAssetData(owner, assetData); err != nil {
		t.Fatalf("asset sync failed: %v", err)
	}
	page, err := CurrentUserAssets(owner, "", "", "", 1)
	if err != nil || page.Total != 1 || len(page.Assets) != 1 {
		t.Fatalf("unexpected asset page: %+v %v", page, err)
	}
	var listed map[string]any
	if err := json.Unmarshal(page.Assets[0], &listed); err != nil {
		t.Fatal(err)
	}
	data, _ := listed["data"].(map[string]any)
	mediaURL, _ := data["url"].(string)
	if !strings.HasPrefix(mediaURL, "/api/files/") {
		t.Fatalf("expected refreshed signed media URL, got %#v", data["url"])
	}
	if err := DeleteLocalStorageObject(objectID); err == nil {
		t.Fatal("expected referenced media deletion to fail")
	}
	if _, err := SaveCurrentUserAssetData(owner, json.RawMessage(`{"assets":[]}`)); err != nil {
		t.Fatalf("clear assets failed: %v", err)
	}
	if err := DeleteLocalStorageObject(objectID); err != nil {
		t.Fatalf("expected unreferenced media deletion to succeed: %v", err)
	}

	orphan, err := UploadLocalObject(owner, "old.mp4", "video/mp4", bytes.NewReader([]byte("old-media")), "video", "")
	if err != nil {
		t.Fatalf("orphan upload failed: %v", err)
	}
	orphanID := strings.TrimPrefix(orphan.StorageKey, "server:")
	orphanObject, err := repository.GetStorageObject(orphanID)
	if err != nil {
		t.Fatal(err)
	}
	orphanObject.CreatedAt = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveStorageObject(orphanObject); err != nil {
		t.Fatal(err)
	}
	config.Cfg.CanvasUnreferencedRetentionHours = 1
	reclaimed, err := ReclaimLocalStorage(owner, "user-a", 1)
	if err != nil {
		t.Fatalf("reclaim failed: %v", err)
	}
	if reclaimed.ObjectCount != 1 || reclaimed.ObjectBytes != int64(len("old-media")) {
		t.Fatalf("unexpected reclaim result: %+v", reclaimed)
	}
	if _, err := StorageObjectForRequest(owner, orphanID, "", ""); err == nil {
		t.Fatal("expected reclaimed media to be unavailable")
	}
}
