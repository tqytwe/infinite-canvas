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
const platformGroupPinnedSessionBinding = "group-pinned-v1"

// PlatformManagedSession is stored encrypted in the Canvas shadow account.
// API keys must remain in this server-side record and never be sent back to
// the browser with a bootstrap response.
type PlatformManagedSession struct {
	ExpiresAt     time.Time                                      `json:"expires_at"`
	Sessions      map[string]PlatformManagedSessionKey           `json:"sessions"`
	Groups        map[string]int64                               `json:"groups,omitempty"`
	GroupSessions map[string]map[int64]PlatformManagedSessionKey `json:"group_sessions,omitempty"`
}

type PlatformManagedSessionKey struct {
	UserID   int64  `json:"user_id"`
	APIKey   string `json:"api_key"`
	APIKeyID int64  `json:"api_key_id"`
	Purpose  string `json:"purpose"`
	GroupID  int64  `json:"group_id,omitempty"`
	Binding  string `json:"binding,omitempty"`
}

type platformGroupSwitchResponse struct {
	Purpose        string                    `json:"purpose"`
	SessionBinding string                    `json:"session_binding"`
	Session        PlatformManagedSessionKey `json:"session"`
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
	return PlatformManagedSession{ExpiresAt: expiresAt, Sessions: sessions, Groups: map[string]int64{}, GroupSessions: map[string]map[int64]PlatformManagedSessionKey{}}, nil
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
	if session.GroupSessions == nil {
		session.GroupSessions = map[string]map[int64]PlatformManagedSessionKey{}
	}
	// Older encrypted sessions may already have a group-pinned key in their
	// purpose slot. Preserve it as a keyed immutable entry during read so a
	// request for another group cannot overwrite the only usable key.
	for purpose, entry := range session.Sessions {
		if !isPlatformGroupPinnedSession(entry, purpose, entry.GroupID) {
			continue
		}
		if session.GroupSessions[purpose] == nil {
			session.GroupSessions[purpose] = map[int64]PlatformManagedSessionKey{}
		}
		if _, exists := session.GroupSessions[purpose][entry.GroupID]; !exists {
			session.GroupSessions[purpose][entry.GroupID] = entry
		}
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
	expectedPurpose, ok := platformSessionPurpose(fallbackPurpose)
	if !ok {
		expectedPurpose = "chat"
	}
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, platformManagedChannelPrefix) {
		// Chat existed before immutable group-bound managed sessions. Keep its
		// historical base-session compatibility, but image and video must always
		// identify the exact declared group. Falling either back to an unscoped
		// purpose key would bypass the server-owned media contract and billing
		// group isolation.
		if expectedPurpose == "image" || expectedPurpose == "video" {
			return "", 0, "", safeMessageError{message: "极速蹬创作媒体请求缺少固定分组"}
		}
		return expectedPurpose, 0, platformManagedChannelPrefix + expectedPurpose, nil
	}
	parts := strings.Split(strings.TrimPrefix(value, platformManagedChannelPrefix), ":")
	if len(parts) != 2 {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	purpose, ok := platformSessionPurpose(parts[0])
	if !ok {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	if purpose != expectedPurpose {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组与当前媒体类型不匹配"}
	}
	groupID, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || groupID <= 0 {
		return "", 0, "", safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	return purpose, groupID, value, nil
}

func setPlatformManagedGroup(ctx context.Context, user *model.User, session *PlatformManagedSession, purpose string, groupID int64) error {
	if groupID <= 0 {
		return nil
	}
	if _, found := platformManagedSessionForGroup(*session, purpose, groupID); found {
		return nil
	}
	entry := session.Sessions[purpose]
	body, err := json.Marshal(map[string]int64{"group_id": groupID})
	if err != nil {
		return err
	}
	raw, err := platformRequest(ctx, http.MethodPost, "nextchat/sessions/"+purpose+"/group", entry, bytes.NewReader(body))
	if err != nil {
		return err
	}
	replacement, err := decodePlatformManagedGroupSwitchResponse(raw, purpose, entry, groupID)
	if err != nil {
		return err
	}

	// The image and video switches can arrive at the same time from different
	// Canvas tabs. Re-read and merge the encrypted session on every retry, then
	// compare-and-swap only Extra. A full db.Save(user) would lose the other
	// purpose's replacement key across tabs or process instances.
	const maxPersistAttempts = 5
	for attempt := 0; attempt < maxPersistAttempts; attempt++ {
		stored, found, readErr := repository.GetUserByID(user.ID)
		if readErr != nil {
			return readErr
		}
		if !found {
			return safeMessageError{message: "极速蹬创作会话保存失败，请稍后重试"}
		}
		persisted, readErr := readPlatformManagedSession(stored)
		if readErr != nil {
			return readErr
		}
		if existing, exists := platformManagedSessionForGroup(persisted, purpose, groupID); exists {
			*user = stored
			*session = persisted
			if existing.UserID > 0 && existing.APIKeyID > 0 {
				return nil
			}
			return safeMessageError{message: "极速蹬创作分组会话更新失败，请稍后重试"}
		}

		expectedExtra := stored.Extra
		if err := persistPlatformManagedReplacementSession(&stored, &persisted, purpose, replacement); err != nil {
			return err
		}
		stored.UpdatedAt = now()
		updated, updateErr := repository.UpdateUserExtraIfUnchanged(stored.ID, expectedExtra, stored.Extra, stored.UpdatedAt)
		if updateErr != nil {
			return updateErr
		}
		if !updated {
			continue
		}
		*user = stored
		*session = persisted
		return nil
	}
	return safeMessageError{message: "极速蹬创作分组会话更新冲突，请稍后重试"}
}

func decodePlatformManagedGroupSwitchResponse(raw json.RawMessage, purpose string, current PlatformManagedSessionKey, groupID int64) (PlatformManagedSessionKey, error) {
	purpose, ok := platformSessionPurpose(purpose)
	if !ok || groupID <= 0 {
		return PlatformManagedSessionKey{}, safeMessageError{message: "极速蹬创作分组参数无效"}
	}
	var payload platformGroupSwitchResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return PlatformManagedSessionKey{}, safeMessageError{message: "极速蹬创作分组会话返回异常，请稍后重试"}
	}
	responsePurpose, ok := platformSessionPurpose(payload.Purpose)
	if !ok || responsePurpose != purpose || strings.TrimSpace(payload.SessionBinding) != platformGroupPinnedSessionBinding {
		return PlatformManagedSessionKey{}, safeMessageError{message: "极速蹬创作服务未返回固定分组会话，请稍后重试"}
	}
	replacement := payload.Session
	replacementPurpose, ok := platformSessionPurpose(replacement.Purpose)
	if !ok || replacementPurpose != purpose || replacement.UserID != current.UserID || replacement.APIKeyID <= 0 || strings.TrimSpace(replacement.APIKey) == "" || replacement.GroupID != groupID || strings.TrimSpace(replacement.Binding) != platformGroupPinnedSessionBinding {
		return PlatformManagedSessionKey{}, safeMessageError{message: "极速蹬创作服务未返回有效固定分组会话，请稍后重试"}
	}
	replacement.Purpose = purpose
	replacement.APIKey = strings.TrimSpace(replacement.APIKey)
	replacement.Binding = platformGroupPinnedSessionBinding
	return replacement, nil
}

func persistPlatformManagedReplacementSession(user *model.User, session *PlatformManagedSession, purpose string, replacement PlatformManagedSessionKey) error {
	if user == nil || session == nil {
		return errors.New("platform managed session is required")
	}
	if session.Sessions == nil {
		session.Sessions = map[string]PlatformManagedSessionKey{}
	}
	if session.Groups == nil {
		session.Groups = map[string]int64{}
	}
	if session.GroupSessions == nil {
		session.GroupSessions = map[string]map[int64]PlatformManagedSessionKey{}
	}
	if session.GroupSessions[purpose] == nil {
		session.GroupSessions[purpose] = map[int64]PlatformManagedSessionKey{}
	}
	session.GroupSessions[purpose][replacement.GroupID] = replacement
	session.Groups[purpose] = replacement.GroupID
	if err := savePlatformManagedSession(user, *session); err != nil {
		return err
	}
	persisted, err := readPlatformManagedSession(*user)
	if err != nil {
		return err
	}
	persistedEntry, found := platformManagedSessionForGroup(persisted, purpose, replacement.GroupID)
	if !found || persistedEntry.APIKeyID != replacement.APIKeyID || persistedEntry.GroupID != replacement.GroupID || strings.TrimSpace(persistedEntry.Binding) != platformGroupPinnedSessionBinding {
		return safeMessageError{message: "极速蹬创作分组会话更新失败，请稍后重试"}
	}
	*session = persisted
	return nil
}

func platformManagedSessionForGroup(session PlatformManagedSession, purpose string, groupID int64) (PlatformManagedSessionKey, bool) {
	purpose, ok := platformSessionPurpose(purpose)
	if !ok {
		return PlatformManagedSessionKey{}, false
	}
	if groupID <= 0 {
		entry, found := session.Sessions[purpose]
		return entry, found
	}
	entry, found := session.GroupSessions[purpose][groupID]
	if found && isPlatformGroupPinnedSession(entry, purpose, groupID) {
		return entry, true
	}
	// Sessions produced before group_sessions was introduced can be migrated at
	// read time. Do not use a differently scoped purpose session as a fallback.
	entry, found = session.Sessions[purpose]
	if found && isPlatformGroupPinnedSession(entry, purpose, groupID) {
		return entry, true
	}
	return PlatformManagedSessionKey{}, false
}

// requirePlatformManagedSessionForGroup deliberately refuses to fall back from
// a selected group to the base purpose session. A missing immutable binding is
// a server-contract failure, not permission to send work through whichever
// group happened to be selected when the base session was issued.
func requirePlatformManagedSessionForGroup(session PlatformManagedSession, purpose string, groupID int64) (PlatformManagedSessionKey, error) {
	entry, found := platformManagedSessionForGroup(session, purpose, groupID)
	if !found {
		return PlatformManagedSessionKey{}, safeMessageError{message: "极速蹬创作固定分组会话不可用，请重新进入 AI 创作空间后重试"}
	}
	return entry, nil
}

func isPlatformGroupPinnedSession(entry PlatformManagedSessionKey, purpose string, groupID int64) bool {
	normalizedPurpose, ok := platformSessionPurpose(purpose)
	if !ok || groupID <= 0 {
		return false
	}
	entryPurpose, ok := platformSessionPurpose(entry.Purpose)
	return ok && entryPurpose == normalizedPurpose && entry.UserID > 0 && entry.APIKeyID > 0 && strings.TrimSpace(entry.APIKey) != "" && entry.GroupID == groupID && strings.TrimSpace(entry.Binding) == platformGroupPinnedSessionBinding
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
	entry, err := requirePlatformManagedSessionForGroup(session, purpose, groupID)
	if err != nil {
		return model.ModelChannel{}, err
	}
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
	entry, err = requirePlatformManagedSessionForGroup(session, purpose, groupID)
	if err != nil {
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
		videoAvailable, videoAvailabilityDeclared := group["video_available"].(bool)
		if purpose == "video" && videoAvailabilityDeclared && !videoAvailable {
			return safeMessageError{message: platformWorkspaceVideoUnavailableMessage(group)}
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

func platformWorkspaceVideoUnavailableMessage(group map[string]any) string {
	switch strings.ToLower(platformWorkspaceString(group["video_unavailable_code"])) {
	case "not_mapped":
		return "当前视频分组尚未完成模型映射，请稍后重试"
	case "capability_not_declared":
		return "当前视频分组尚未声明可执行的视频能力，请稍后重试"
	case "price_missing":
		return "当前视频分组暂未完成价格配置，请稍后重试"
	case "adapter_unsupported":
		return "当前视频分组暂不支持所选视频能力，请稍后重试"
	case "no_schedulable_account":
		return "当前视频分组暂时没有可用账号，请稍后重试"
	case "group_permission_denied":
		return "当前账号暂无该视频分组权限，请稍后重试"
	case "subscription_reservation_unsupported":
		return "当前视频分组暂不支持此计费方式，请稍后重试"
	default:
		return "当前视频分组暂不可用，请稍后重试"
	}
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
