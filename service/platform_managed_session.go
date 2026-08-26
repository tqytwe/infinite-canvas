package service

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const platformManagedChannelPrefix = "platform-managed:"
const platformManagedSessionExtraKey = "platform_managed_session"

// PlatformManagedSession is stored encrypted in the Canvas shadow account.
// API keys must remain in this server-side record and never be sent back to
// the browser with a bootstrap response.
type PlatformManagedSession struct {
	ExpiresAt time.Time                            `json:"expires_at"`
	Sessions  map[string]PlatformManagedSessionKey `json:"sessions"`
	Groups    map[string]int64                     `json:"groups,omitempty"`
}

type PlatformManagedSessionKey struct {
	UserID   int64  `json:"user_id"`
	APIKey   string `json:"api_key"`
	APIKeyID int64  `json:"api_key_id"`
	Purpose  string `json:"purpose"`
}

type platformSessionExchangeResponse struct {
	Code int `json:"code"`
	Data struct {
		UserID    int64                                `json:"user_id"`
		APIKey    string                               `json:"api_key"`
		APIKeyID  int64                                `json:"api_key_id"`
		Purpose   string                               `json:"purpose"`
		ExpiresAt time.Time                            `json:"expires_at"`
		Sessions  map[string]PlatformManagedSessionKey `json:"sessions"`
	} `json:"data"`
}

type platformBootstrapEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

type platformBootstrapIdentity struct {
	User struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		Email     string `json:"email"`
		AvatarURL string `json:"avatar_url"`
		Role      string `json:"role"`
	} `json:"user"`
}

func platformSessionPurpose(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "chat":
		return "chat", true
	case "image":
		return "image", true
	case "video":
		return "video", true
	default:
		return "", false
	}
}

func platformSessionAPIURL(path string) (string, error) {
	base := strings.TrimSpace(config.Cfg.PlatformAPIBaseURL)
	if base == "" {
		return "", safeMessageError{message: "极速蹬统一登录未配置"}
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", safeMessageError{message: "极速蹬统一登录地址无效"}
	}
	basePath := strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(strings.ToLower(basePath), "/v1") {
		basePath = strings.TrimSuffix(basePath, "/v1")
	}
	parsed.Path = basePath + "/api/v1/" + strings.TrimLeft(path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func platformExchangeManagedSession(ctx context.Context, launchToken string) (PlatformManagedSession, error) {
	launchToken = strings.TrimSpace(launchToken)
	if launchToken == "" {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬登录令牌缺失"}
	}
	if !PlatformAuthEnabled() {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬统一登录未配置"}
	}
	endpoint, err := platformSessionAPIURL("nextchat/session")
	if err != nil {
		return PlatformManagedSession{}, err
	}
	body, err := json.Marshal(map[string]string{"launch_token": launchToken})
	if err != nil {
		return PlatformManagedSession{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return PlatformManagedSession{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-NextChat-Secret", strings.TrimSpace(config.Cfg.PlatformExchangeSecret))
	resp, err := platformAuthHTTPClient.Do(req)
	if err != nil {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬登录服务暂时不可用"}
	}
	defer resp.Body.Close()
	var payload platformSessionExchangeResponse
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 256*1024)).Decode(&payload)
	if resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusGatewayTimeout || resp.StatusCode == http.StatusBadGateway {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬登录服务暂时不可用"}
	}
	if decodeErr != nil || resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || payload.Code != 0 {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬登录令牌无效或已过期"}
	}

	sessions := payload.Data.Sessions
	if len(sessions) == 0 && payload.Data.UserID > 0 && payload.Data.APIKeyID > 0 && strings.TrimSpace(payload.Data.APIKey) != "" {
		purpose, ok := platformSessionPurpose(payload.Data.Purpose)
		if !ok {
			purpose = "chat"
		}
		sessions = map[string]PlatformManagedSessionKey{purpose: {
			UserID: payload.Data.UserID, APIKey: payload.Data.APIKey, APIKeyID: payload.Data.APIKeyID, Purpose: purpose,
		}}
	}
	for purpose, entry := range sessions {
		normalizedPurpose, ok := platformSessionPurpose(purpose)
		if !ok || entry.UserID <= 0 || entry.APIKeyID <= 0 || strings.TrimSpace(entry.APIKey) == "" {
			return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话不完整，请重新进入 AI 创作空间"}
		}
		entry.Purpose = normalizedPurpose
		sessions[normalizedPurpose] = entry
		if normalizedPurpose != purpose {
			delete(sessions, purpose)
		}
	}
	if entry := sessions["chat"]; entry.UserID <= 0 || entry.APIKeyID <= 0 || strings.TrimSpace(entry.APIKey) == "" {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话不完整，请重新进入 AI 创作空间"}
	}
	expiresAt := payload.Data.ExpiresAt.UTC()
	if expiresAt.IsZero() || !expiresAt.After(time.Now().UTC()) {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话已过期，请重新进入 AI 创作空间"}
	}
	return PlatformManagedSession{ExpiresAt: expiresAt, Sessions: sessions, Groups: map[string]int64{}}, nil
}

func platformSessionCipher() (cipher.AEAD, error) {
	material := strings.TrimSpace(config.Cfg.JWTSecret) + ":" + strings.TrimSpace(config.Cfg.PlatformExchangeSecret)
	if material == ":" {
		return nil, errors.New("platform session encryption is not configured")
	}
	sum := sha256.Sum256([]byte(material))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func encryptPlatformSession(session PlatformManagedSession) (string, error) {
	plain, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	gcm, err := platformSessionCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, plain, nil)
	return base64.RawURLEncoding.EncodeToString(append(nonce, sealed...)), nil
}

func decryptPlatformSession(value string) (PlatformManagedSession, error) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return PlatformManagedSession{}, err
	}
	gcm, err := platformSessionCipher()
	if err != nil {
		return PlatformManagedSession{}, err
	}
	if len(raw) < gcm.NonceSize() {
		return PlatformManagedSession{}, errors.New("platform session ciphertext is invalid")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return PlatformManagedSession{}, err
	}
	var session PlatformManagedSession
	if err := json.Unmarshal(plain, &session); err != nil {
		return PlatformManagedSession{}, err
	}
	return session, nil
}

func savePlatformManagedSession(user *model.User, session PlatformManagedSession) error {
	if user == nil {
		return errors.New("platform user is required")
	}
	encrypted, err := encryptPlatformSession(session)
	if err != nil {
		return err
	}
	extra := map[string]json.RawMessage{}
	if strings.TrimSpace(user.Extra) != "" {
		if err := json.Unmarshal([]byte(user.Extra), &extra); err != nil {
			return err
		}
	}
	encoded, err := json.Marshal(encrypted)
	if err != nil {
		return err
	}
	extra[platformManagedSessionExtraKey] = encoded
	raw, err := json.Marshal(extra)
	if err != nil {
		return err
	}
	user.Extra = string(raw)
	return nil
}

func readPlatformManagedSession(user model.User) (PlatformManagedSession, error) {
	if strings.TrimSpace(user.Extra) == "" {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话不存在，请重新进入 AI 创作空间"}
	}
	var extra map[string]json.RawMessage
	if err := json.Unmarshal([]byte(user.Extra), &extra); err != nil {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话无效，请重新进入 AI 创作空间"}
	}
	raw := extra[platformManagedSessionExtraKey]
	var encrypted string
	if len(raw) == 0 || json.Unmarshal(raw, &encrypted) != nil || strings.TrimSpace(encrypted) == "" {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话不存在，请重新进入 AI 创作空间"}
	}
	session, err := decryptPlatformSession(encrypted)
	if err != nil || session.ExpiresAt.IsZero() || !session.ExpiresAt.After(time.Now().UTC()) {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话已过期，请重新进入 AI 创作空间"}
	}
	entry := session.Sessions["chat"]
	if entry.UserID <= 0 || entry.APIKeyID <= 0 || strings.TrimSpace(entry.APIKey) == "" {
		return PlatformManagedSession{}, safeMessageError{message: "极速蹬创作会话不完整，请重新进入 AI 创作空间"}
	}
	if session.Groups == nil {
		session.Groups = map[string]int64{}
	}
	return session, nil
}

func platformRequest(ctx context.Context, method string, path string, session PlatformManagedSessionKey, body io.Reader) (json.RawMessage, error) {
	endpoint, err := platformSessionAPIURL(path)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-NextChat-Secret", strings.TrimSpace(config.Cfg.PlatformExchangeSecret))
	req.Header.Set("X-NextChat-User-ID", strconv.FormatInt(session.UserID, 10))
	req.Header.Set("X-NextChat-API-Key-ID", strconv.FormatInt(session.APIKeyID, 10))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := platformAuthHTTPClient.Do(req)
	if err != nil {
		return nil, safeMessageError{message: "极速蹬创作服务暂时不可用"}
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, safeMessageError{message: "极速蹬创作服务暂时不可用"}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, safeMessageError{message: "极速蹬创作会话已失效，请重新进入 AI 创作空间"}
	}
	if resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusBadGateway || resp.StatusCode == http.StatusGatewayTimeout {
		return nil, safeMessageError{message: "极速蹬创作服务暂时不可用"}
	}
	var envelope platformBootstrapEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil || resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || envelope.Code != 0 {
		return nil, safeMessageError{message: "极速蹬创作能力暂不可用，请稍后重试"}
	}
	return envelope.Data, nil
}

func platformBootstrapForSession(ctx context.Context, session PlatformManagedSessionKey) (map[string]any, error) {
	raw, err := platformRequest(ctx, http.MethodGet, "nextchat/bootstrap", session, nil)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, safeMessageError{message: "极速蹬创作能力返回异常"}
	}
	return payload, nil
}

// PlatformManagedBootstrap returns the platform-owned model contract without
// API keys. It combines separately scoped chat, image, and video workspaces.
func PlatformManagedBootstrap(ctx context.Context, canvasUserID string) (map[string]any, error) {
	user, ok, err := repository.GetUserByID(strings.TrimSpace(canvasUserID))
	if err != nil {
		return nil, err
	}
	if !ok || user.PlatformUserID == nil {
		return nil, safeMessageError{message: "极速蹬创作会话不存在，请重新进入 AI 创作空间"}
	}
	session, err := readPlatformManagedSession(user)
	if err != nil {
		return nil, err
	}
	workspaces := map[string]any{}
	var first map[string]any
	missingPurposes := make([]string, 0, 2)
	for _, purpose := range []string{"chat", "image", "video"} {
		entry, exists := session.Sessions[purpose]
		if !exists || entry.UserID <= 0 || entry.APIKeyID <= 0 || strings.TrimSpace(entry.APIKey) == "" {
			missingPurposes = append(missingPurposes, purpose)
			continue
		}
		workspace, err := platformBootstrapForSession(ctx, entry)
		if err != nil {
			return nil, err
		}
		if first == nil {
			first = workspace
		}
		workspaces[purpose] = workspace["models"]
	}
	if first == nil {
		return nil, safeMessageError{message: "极速蹬创作能力暂不可用，请稍后重试"}
	}
	result := map[string]any{
		"user":       first["user"],
		"brand":      first["brand"],
		"features":   first["features"],
		"workspaces": workspaces,
		"expires_at": session.ExpiresAt.UTC().Format(time.RFC3339),
	}
	if len(missingPurposes) > 0 {
		result["compatibility"] = map[string]any{
			"state":                "incomplete_managed_sessions",
			"unavailable_purposes": missingPurposes,
			"message":              "服务端尚未提供完整的媒体会话，请重新进入 AI 创作空间后重试",
		}
	}
	return redactPlatformSecrets(result).(map[string]any), nil
}

func redactPlatformSecrets(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			normalized := strings.ToLower(strings.ReplaceAll(key, "_", ""))
			if normalized == "apikey" || normalized == "authorization" || normalized == "token" {
				continue
			}
			result[key] = redactPlatformSecrets(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = redactPlatformSecrets(item)
		}
		return result
	default:
		return value
	}
}

func parsePlatformManagedChannelID(value string, fallbackPurpose string) (string, int64, string, error) {
	purpose, ok := platformSessionPurpose(fallbackPurpose)
	if !ok {
		purpose = "chat"
	}
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, platformManagedChannelPrefix) {
		return purpose, 0, platformManagedChannelPrefix + purpose, nil
	}
	parts := strings.Split(strings.TrimPrefix(value, platformManagedChannelPrefix), ":")
	if len(parts) != 2 {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	purpose, ok = platformSessionPurpose(parts[0])
	if !ok {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	groupID, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || groupID <= 0 {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	return purpose, groupID, value, nil
}

func setPlatformManagedGroup(ctx context.Context, user *model.User, session *PlatformManagedSession, purpose string, groupID int64) error {
	if groupID <= 0 || session.Groups[purpose] == groupID {
		return nil
	}
	body, err := json.Marshal(map[string]int64{"group_id": groupID})
	if err != nil {
		return err
	}
	if _, err := platformRequest(ctx, http.MethodPost, "nextchat/sessions/"+purpose+"/group", session.Sessions[purpose], bytes.NewReader(body)); err != nil {
		return err
	}
	session.Groups[purpose] = groupID
	if err := savePlatformManagedSession(user, *session); err != nil {
		return err
	}
	user.UpdatedAt = now()
	_, err = repository.SaveUser(*user)
	return err
}

// PlatformManagedChannelForUser resolves a Canvas-only channel identifier to
// a server-side platform API key. The returned key is intentionally used only
// by Canvas handlers when proxying an upstream request.
func PlatformManagedChannelForUser(ctx context.Context, canvasUserID string, channelID string, fallbackPurpose string) (model.ModelChannel, error) {
	user, ok, err := repository.GetUserByID(strings.TrimSpace(canvasUserID))
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !ok || user.PlatformUserID == nil {
		return model.ModelChannel{}, safeMessageError{message: "极速蹬创作会话不存在，请重新进入 AI 创作空间"}
	}
	session, err := readPlatformManagedSession(user)
	if err != nil {
		return model.ModelChannel{}, err
	}
	purpose, groupID, normalizedID, err := parsePlatformManagedChannelID(channelID, fallbackPurpose)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if entry := session.Sessions[purpose]; entry.UserID <= 0 || entry.APIKeyID <= 0 || strings.TrimSpace(entry.APIKey) == "" {
		return model.ModelChannel{}, safeMessageError{message: "极速蹬服务端尚未提供该媒体会话，请重新进入 AI 创作空间后重试"}
	}
	if err := setPlatformManagedGroup(ctx, &user, &session, purpose, groupID); err != nil {
		return model.ModelChannel{}, err
	}
	entry := session.Sessions[purpose]
	return model.ModelChannel{
		ID:       normalizedID,
		Protocol: "openai",
		Name:     "极速蹬 " + purpose,
		BaseURL:  strings.TrimSpace(config.Cfg.PlatformAPIBaseURL),
		APIKey:   entry.APIKey,
		Weight:   1,
		Timeout:  600,
		Enabled:  true,
	}, nil
}

func IsPlatformManagedChannel(channel model.ModelChannel) bool {
	return strings.HasPrefix(strings.TrimSpace(channel.ID), platformManagedChannelPrefix)
}

// ValidatePlatformManagedMediaRequest rejects a media request unless the
// platform's current, group-scoped workspace declares the exact model,
// modality, operation and executable adapter. This is intentionally checked on
// the Canvas server instead of trusting the browser model picker.
func ValidatePlatformManagedMediaRequest(
	ctx context.Context,
	canvasUserID string,
	channelID string,
	expectedPurpose string,
	modelID string,
	operation string,
) error {
	expectedPurpose, ok := platformSessionPurpose(expectedPurpose)
	if !ok || (expectedPurpose != "image" && expectedPurpose != "video") {
		return safeMessageError{message: "极速蹬创作媒体类型无效"}
	}
	modelID = strings.TrimSpace(modelID)
	operation = strings.TrimSpace(operation)
	if modelID == "" || operation == "" {
		return safeMessageError{message: "极速蹬创作媒体请求不完整"}
	}

	user, found, err := repository.GetUserByID(strings.TrimSpace(canvasUserID))
	if err != nil {
		return err
	}
	if !found || user.PlatformUserID == nil {
		return safeMessageError{message: "极速蹬创作会话不存在，请重新进入 AI 创作空间"}
	}
	session, err := readPlatformManagedSession(user)
	if err != nil {
		return err
	}
	purpose, groupID, _, err := parsePlatformManagedChannelID(channelID, expectedPurpose)
	if err != nil {
		return err
	}
	if purpose != expectedPurpose {
		return safeMessageError{message: "极速蹬创作分组与媒体类型不匹配"}
	}
	entry := session.Sessions[purpose]
	if entry.UserID <= 0 || entry.APIKeyID <= 0 || strings.TrimSpace(entry.APIKey) == "" {
		return safeMessageError{message: "极速蹬服务端尚未提供该媒体会话，请重新进入 AI 创作空间后重试"}
	}
	if err := setPlatformManagedGroup(ctx, &user, &session, purpose, groupID); err != nil {
		return err
	}
	bootstrap, err := platformBootstrapForSession(ctx, entry)
	if err != nil {
		return err
	}
	workspace, ok := bootstrap["models"].(map[string]any)
	if !ok {
		return safeMessageError{message: "极速蹬创作能力返回异常"}
	}
	return validatePlatformManagedMediaModel(workspace, groupID, modelID, purpose, operation)
}

func validatePlatformManagedMediaModel(workspace map[string]any, groupID int64, modelID string, purpose string, operation string) error {
	groups, ok := workspace["groups"].([]any)
	if !ok || len(groups) == 0 {
		return safeMessageError{message: "极速蹬创作服务未返回可用分组"}
	}
	if groupID <= 0 {
		groupID = platformWorkspaceID(workspace["selected_group_id"])
		if groupID <= 0 {
			for _, rawGroup := range groups {
				group, isGroup := rawGroup.(map[string]any)
				if isGroup && platformWorkspaceBool(group["is_current"]) {
					groupID = platformWorkspaceID(group["id"])
					break
				}
			}
		}
	}
	if groupID <= 0 {
		return safeMessageError{message: "极速蹬创作服务未返回当前分组"}
	}

	for _, rawGroup := range groups {
		group, ok := rawGroup.(map[string]any)
		if !ok || (groupID > 0 && platformWorkspaceID(group["id"]) != groupID) {
			continue
		}
		models, ok := group["models"].([]any)
		if !ok {
			break
		}
		for _, rawModel := range models {
			item, ok := rawModel.(map[string]any)
			if !ok || !platformWorkspaceModelMatches(item, modelID) {
				continue
			}
			if !platformWorkspaceStringsContain(item["modalities"], purpose) {
				return safeMessageError{message: "当前模型未声明所需的媒体能力"}
			}
			if strings.TrimSpace(platformWorkspaceString(item["adapter"])) == "" || strings.TrimSpace(platformWorkspaceString(item["capability_version"])) == "" {
				return safeMessageError{message: "当前模型未声明可执行的媒体适配器"}
			}
			capabilities, ok := item[purpose+"_capabilities"].(map[string]any)
			if !ok || !platformWorkspaceStringsContain(capabilities["operations"], operation) {
				return safeMessageError{message: "当前模型不支持该媒体操作"}
			}
			return nil
		}
		return safeMessageError{message: "当前分组没有可用的指定媒体模型"}
	}
	return safeMessageError{message: "极速蹬创作分组不可用"}
}

func platformWorkspaceID(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case json.Number:
		id, _ := typed.Int64()
		return id
	case string:
		id, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return id
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func platformWorkspaceString(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func platformWorkspaceBool(value any) bool {
	flag, _ := value.(bool)
	return flag
}

func platformWorkspaceStringsContain(value any, expected string) bool {
	values, ok := value.([]any)
	if !ok {
		return false
	}
	for _, raw := range values {
		if strings.EqualFold(platformWorkspaceString(raw), strings.TrimSpace(expected)) {
			return true
		}
	}
	return false
}

func platformWorkspaceModelMatches(model map[string]any, modelID string) bool {
	modelID = strings.TrimSpace(modelID)
	return strings.EqualFold(platformWorkspaceString(model["id"]), modelID) ||
		strings.EqualFold(platformWorkspaceString(model["name"]), modelID)
}

func IsPlatformManagedCanvasUser(ctx context.Context, canvasUserID string) bool {
	user, ok, err := repository.GetUserByID(strings.TrimSpace(canvasUserID))
	return err == nil && ok && user.PlatformUserID != nil
}

func PlatformManagedChannelForTask(ctx context.Context, canvasUserID string, channelID string) (model.ModelChannel, error) {
	return PlatformManagedChannelForUser(ctx, canvasUserID, channelID, "video")
}

func platformIdentityFromBootstrap(payload map[string]any) (platformBootstrapIdentity, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return platformBootstrapIdentity{}, err
	}
	var identity platformBootstrapIdentity
	if err := json.Unmarshal(raw, &identity); err != nil || identity.User.ID <= 0 {
		return platformBootstrapIdentity{}, safeMessageError{message: "极速蹬用户信息无效"}
	}
	return identity, nil
}
