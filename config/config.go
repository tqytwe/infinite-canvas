package config

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Port                             string `env:"PORT" envDefault:"8080"`
	AdminUsername                    string `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPassword                    string `env:"ADMIN_PASSWORD" envDefault:"infinite-canvas"`
	JWTSecret                        string `env:"JWT_SECRET" envDefault:"infinite-canvas"`
	JWTExpireHours                   int    `env:"JWT_EXPIRE_HOURS" envDefault:"168"`
	StorageDriver                    string `env:"STORAGE_DRIVER" envDefault:"sqlite"`
	DatabaseDSN                      string `env:"DATABASE_DSN" envDefault:"data/infinite-canvas.db"`
	CanvasDataDir                    string `env:"CANVAS_DATA_DIR" envDefault:"/data/infinite-canvas"`
	CanvasStorageLimit               int64  `env:"CANVAS_STORAGE_LIMIT_BYTES" envDefault:"30000000000"`
	CanvasStorageReserve             int64  `env:"CANVAS_STORAGE_RESERVE_BYTES" envDefault:"3000000000"`
	CanvasCleanupThreshold           int64  `env:"CANVAS_STORAGE_CLEANUP_THRESHOLD_BYTES" envDefault:"24000000000"`
	CanvasUserStorageLimit           int64  `env:"CANVAS_USER_STORAGE_LIMIT_BYTES" envDefault:"5000000000"`
	CanvasMaxObjectBytes             int64  `env:"CANVAS_MAX_OBJECT_BYTES" envDefault:"2147483648"`
	CanvasUnreferencedRetentionHours int    `env:"CANVAS_UNREFERENCED_RETENTION_HOURS" envDefault:"72"`
	PublicBaseURL                    string `env:"PUBLIC_BASE_URL"`
	PlatformAPIBaseURL               string `env:"CANVAS_PLATFORM_API_BASE_URL"`
	PlatformWebURL                   string `env:"CANVAS_PLATFORM_WEB_URL" envDefault:"https://www.jisudeng.com"`
	PlatformLoginPath                string `env:"CANVAS_PLATFORM_LOGIN_PATH" envDefault:"/login"`
	PlatformEntryPath                string `env:"CANVAS_PLATFORM_ENTRY_PATH" envDefault:"/ai-creation-space"`
	PlatformExchangeSecret           string `env:"CANVAS_EXCHANGE_SECRET"`
	LinuxDoAuthorizeURL              string `env:"LINUX_DO_AUTHORIZE_URL" envDefault:"https://connect.linux.do/oauth2/authorize"`
	LinuxDoTokenURL                  string `env:"LINUX_DO_TOKEN_URL" envDefault:"https://connect.linux.do/oauth2/token"`
	LinuxDoUserInfoURL               string `env:"LINUX_DO_USERINFO_URL" envDefault:"https://connect.linux.do/api/user"`
	AILogDir                         string `env:"AI_LOG_DIR" envDefault:"data/logs/ai-calls"`
}

var Cfg Config

func Load() error {
	_ = godotenv.Load()
	if err := env.Parse(&Cfg); err != nil {
		return err
	}
	applyLegacyCanvasStorageLimit()
	if strings.TrimSpace(Cfg.CanvasDataDir) == "" {
		Cfg.CanvasDataDir = "/data/infinite-canvas"
	}
	if Cfg.CanvasStorageLimit <= 0 {
		Cfg.CanvasStorageLimit = 30_000_000_000
	}
	if Cfg.CanvasStorageReserve < 0 || Cfg.CanvasStorageReserve >= Cfg.CanvasStorageLimit {
		Cfg.CanvasStorageReserve = Cfg.CanvasStorageLimit / 10
	}
	if Cfg.CanvasCleanupThreshold <= 0 || Cfg.CanvasCleanupThreshold > Cfg.CanvasStorageLimit-Cfg.CanvasStorageReserve {
		Cfg.CanvasCleanupThreshold = (Cfg.CanvasStorageLimit - Cfg.CanvasStorageReserve) * 8 / 9
	}
	if Cfg.CanvasUserStorageLimit <= 0 || Cfg.CanvasUserStorageLimit > Cfg.CanvasStorageLimit-Cfg.CanvasStorageReserve {
		Cfg.CanvasUserStorageLimit = 5_000_000_000
	}
	if Cfg.CanvasMaxObjectBytes <= 0 || Cfg.CanvasMaxObjectBytes > Cfg.CanvasStorageLimit-Cfg.CanvasStorageReserve {
		Cfg.CanvasMaxObjectBytes = 2 * 1024 * 1024 * 1024
	}
	if Cfg.CanvasUnreferencedRetentionHours < 1 {
		Cfg.CanvasUnreferencedRetentionHours = 72
	}
	if err := migrateLegacyCanvasDatabase(); err != nil {
		return err
	}
	normalizeDockerSQLiteDSN("/app/data")
	if strings.TrimSpace(Cfg.JWTSecret) == "" || Cfg.JWTSecret == "infinite-canvas" {
		secret, err := randomSecret()
		if err != nil {
			return err
		}
		Cfg.JWTSecret = secret
	}
	return nil
}

// applyLegacyCanvasStorageLimit keeps the existing Zeabur setting effective
// while production moves to the explicit CANVAS_STORAGE_LIMIT_BYTES name.
func applyLegacyCanvasStorageLimit() {
	if current, configured := os.LookupEnv("CANVAS_STORAGE_LIMIT_BYTES"); configured && strings.TrimSpace(current) != "" {
		return
	}
	legacy, configured := os.LookupEnv("CANVAS_MAX_STORAGE_BYTES")
	if !configured {
		return
	}
	limit, err := strconv.ParseInt(strings.TrimSpace(legacy), 10, 64)
	if err == nil && limit > 0 {
		Cfg.CanvasStorageLimit = limit
	}
}

func migrateLegacyCanvasDatabase() error {
	if strings.ToLower(strings.TrimSpace(Cfg.StorageDriver)) != "sqlite" {
		return nil
	}
	pathPart := strings.TrimSpace(Cfg.DatabaseDSN)
	if index := strings.Index(pathPart, "?"); index >= 0 {
		pathPart = pathPart[:index]
	}
	if filepath.Clean(pathPart) != filepath.Clean("/data/infinite-canvas/infinite-canvas.db") {
		return nil
	}
	legacyPath := "/app/data/infinite-canvas.db"
	if _, err := os.Stat(legacyPath); err != nil {
		return nil
	}
	if _, err := os.Stat(pathPart); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(pathPart), 0o700); err != nil {
		return err
	}
	if err := copyFile(legacyPath, pathPart); err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(legacyPath + suffix); err == nil {
			if err := copyFile(legacyPath+suffix, pathPart+suffix); err != nil {
				return err
			}
		}
	}
	return nil
}

func copyFile(source string, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		_ = os.Remove(target)
		return err
	}
	if err := output.Sync(); err != nil {
		_ = output.Close()
		_ = os.Remove(target)
		return err
	}
	return output.Close()
}

func normalizeDockerSQLiteDSN(appDataDir string) {
	driver := strings.ToLower(strings.TrimSpace(Cfg.StorageDriver))
	if driver != "" && driver != "sqlite" {
		return
	}
	dsn := strings.TrimSpace(Cfg.DatabaseDSN)
	if dsn == "" || dsn == ":memory:" || strings.HasPrefix(dsn, "file:") {
		return
	}
	pathPart, suffix := dsn, ""
	if index := strings.Index(dsn, "?"); index >= 0 {
		pathPart = dsn[:index]
		suffix = dsn[index:]
	}
	if filepath.IsAbs(pathPart) {
		return
	}
	slashPath := filepath.ToSlash(pathPart)
	if slashPath != "data" && !strings.HasPrefix(slashPath, "data/") {
		return
	}
	if _, err := os.Stat(appDataDir); err != nil {
		return
	}
	Cfg.DatabaseDSN = filepath.Join(filepath.Dir(appDataDir), filepath.FromSlash(slashPath)) + suffix
}

func randomSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
