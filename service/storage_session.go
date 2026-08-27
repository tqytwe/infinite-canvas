package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

const (
	StorageSessionCookieName = "canvas_storage_session"
	storageSessionScope      = "canvas_storage"
	jisudengAPIBaseURL       = "https://api.jisudeng.com"
)

var storageSessionHTTPClient = &http.Client{Timeout: 15 * time.Second}

type storageSessionClaims struct {
	OwnerID string `json:"owner_id"`
	Scope   string `json:"scope"`
	jwt.RegisteredClaims
}

func CreateStorageSession(ctx context.Context, baseURL, apiKey string) (string, error) {
	if !isJisudengAPIBaseURL(baseURL) {
		return "", safeMessageError{message: "仅支持极速蹬 API 地址 https://api.jisudeng.com"}
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", safeMessageError{message: "请先填写 API Key"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jisudengAPIBaseURL+"/v1/models", nil)
	if err != nil {
		return "", safeMessageError{message: "模型校验请求创建失败"}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := storageSessionHTTPClient.Do(req)
	if err != nil {
		return "", safeMessageError{message: "极速蹬模型服务暂不可用，请稍后重试"}
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return "", safeMessageError{message: "API Key 无效或无权读取模型"}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", safeMessageError{message: "极速蹬模型服务暂不可用，请稍后重试"}
	}
	return NewStorageSession(apiKey), nil
}

func NewStorageSession(apiKey string) string {
	ownerID := "api-key:" + storageSessionFingerprint(apiKey)
	claims := storageSessionClaims{
		OwnerID: ownerID,
		Scope:   storageSessionScope,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   ownerID,
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		return ""
	}
	return token
}

func StorageSessionUser(tokenText string) (model.AuthUser, bool) {
	claims := storageSessionClaims{}
	token, err := jwt.ParseWithClaims(tokenText, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("invalid signing method")
		}
		return []byte(config.Cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid || claims.Scope != storageSessionScope || !strings.HasPrefix(claims.OwnerID, "api-key:") || claims.Subject != claims.OwnerID {
		return model.AuthUser{}, false
	}
	return model.AuthUser{ID: claims.OwnerID, Username: "canvas-storage", Role: model.UserRoleUser}, true
}

func isJisudengAPIBaseURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.User != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Host, "api.jisudeng.com") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	path := strings.TrimRight(parsed.EscapedPath(), "/")
	return path == "" || path == "/v1"
}

func storageSessionFingerprint(apiKey string) string {
	mac := hmac.New(sha256.New, []byte(config.Cfg.JWTSecret))
	_, _ = mac.Write([]byte(strings.TrimSpace(apiKey)))
	return hex.EncodeToString(mac.Sum(nil))
}
