package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeDockerSQLiteDSNUsesMountedDataDir(t *testing.T) {
	root := t.TempDir()
	appDataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(appDataDir, 0755); err != nil {
		t.Fatal(err)
	}
	Cfg = Config{StorageDriver: "sqlite", DatabaseDSN: "data/infinite-canvas.db?_pragma=busy_timeout(5000)"}

	normalizeDockerSQLiteDSN(appDataDir)

	want := filepath.Join(root, "data", "infinite-canvas.db") + "?_pragma=busy_timeout(5000)"
	if Cfg.DatabaseDSN != want {
		t.Fatalf("DatabaseDSN = %q, want %q", Cfg.DatabaseDSN, want)
	}
}

func TestNormalizeDockerSQLiteDSNLeavesLocalPathWithoutMountedDataDir(t *testing.T) {
	Cfg = Config{StorageDriver: "sqlite", DatabaseDSN: "data/infinite-canvas.db"}

	normalizeDockerSQLiteDSN(filepath.Join(t.TempDir(), "missing-data"))

	if Cfg.DatabaseDSN != "data/infinite-canvas.db" {
		t.Fatalf("DatabaseDSN = %q, want relative local path", Cfg.DatabaseDSN)
	}
}

func TestApplyLegacyCanvasStorageLimit(t *testing.T) {
	t.Setenv("CANVAS_STORAGE_LIMIT_BYTES", "")
	t.Setenv("CANVAS_MAX_STORAGE_BYTES", "32212254720")
	Cfg.CanvasStorageLimit = 30_000_000_000

	applyLegacyCanvasStorageLimit()

	if Cfg.CanvasStorageLimit != 10_000_000_000 {
		t.Fatalf("CanvasStorageLimit = %d, want capped legacy value", Cfg.CanvasStorageLimit)
	}
}

func TestApplyLegacyCanvasStorageLimitPrefersCurrentName(t *testing.T) {
	t.Setenv("CANVAS_STORAGE_LIMIT_BYTES", "30000000000")
	t.Setenv("CANVAS_MAX_STORAGE_BYTES", "32212254720")
	Cfg.CanvasStorageLimit = 30_000_000_000

	applyLegacyCanvasStorageLimit()

	if Cfg.CanvasStorageLimit != 30_000_000_000 {
		t.Fatalf("CanvasStorageLimit = %d, want current environment value", Cfg.CanvasStorageLimit)
	}
}
