package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
)

type storageSessionClaims struct {
	OwnerID string `json:"owner_id"`
	Scope   string `json:"scope"`
	jwt.RegisteredClaims
}

func CreateStorageSession(_ context.Context, baseURL, apiKey string) (string, error) {
	canonicalBaseURL, err := canonicalStorageSessionBaseURL(baseURL)
	if err != nil {
		return "", err
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", safeMessageError{message: "请先填写 API Key"}
	}
	return NewStorageSession(canonicalBaseURL, apiKey), nil
}

func NewStorageSession(baseURL, apiKey string) string {
	ownerID := "api-key:" + storageSessionFingerprint(baseURL, apiKey)
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

func canonicalStorageSessionBaseURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.User != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return "", safeMessageError{message: "API 地址必须是无参数的 HTTPS 地址"}
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	return parsed.String(), nil
}

func storageSessionFingerprint(baseURL, apiKey string) string {
	mac := hmac.New(sha256.New, []byte(config.Cfg.JWTSecret))
	_, _ = mac.Write([]byte(baseURL + "\n" + strings.TrimSpace(apiKey)))
	return hex.EncodeToString(mac.Sum(nil))
}
