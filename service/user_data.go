package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type UserConfigPayload struct {
	ModelConfig      json.RawMessage       `json:"modelConfig,omitempty"`
	StorageProvider  *UserStorageProviders `json:"storageProvider,omitempty"`
	ImageHistory     json.RawMessage       `json:"imageHistory,omitempty"`
	AssetData        json.RawMessage       `json:"assetData,omitempty"`
	SyncCapabilities map[string]bool       `json:"syncCapabilities,omitempty"`
}

type StorageObjectProviderInput struct {
	Enabled         *bool  `json:"enabled,omitempty"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	PathPrefix      string `json:"pathPrefix"`
	Username        string `json:"username"`
	Password        string `json:"password"`
}

type UserStorageProviders struct {
	S3     *StorageObjectProviderInput `json:"s3,omitempty"`
	WebDAV *StorageObjectProviderInput `json:"webdav,omitempty"`
}

type UserAssetPage struct {
	Assets     []json.RawMessage `json:"assets"`
	NextCursor string            `json:"nextCursor,omitempty"`
	HasMore    bool              `json:"hasMore"`
	Total      int64             `json:"total"`
}

type userAssetCursor struct {
	UpdatedAt string `json:"updatedAt"`
	ID        string `json:"id"`
}

type userModelConfigInput struct {
	LocalChannels []userLocalModelChannelInput `json:"localChannels"`
}

type userLocalModelChannelInput struct {
	ID       string   `json:"id"`
	Protocol string   `json:"protocol"`
	Name     string   `json:"name"`
	BaseURL  string   `json:"baseUrl"`
	APIKey   string   `json:"apiKey"`
	Models   []string `json:"models"`
}

func SelectUserLocalModelChannelForModel(userID string, modelName string, channelID string) (model.ModelChannel, error) {
	userID = strings.TrimSpace(userID)
	modelName = strings.TrimSpace(modelName)
	channelID = strings.TrimSpace(channelID)
	if userID == "" {
		return model.ModelChannel{}, errors.New("请先登录")
	}
	if modelName == "" {
		return model.ModelChannel{}, errors.New("缺少模型名称")
	}
	if channelID == "" {
		return model.ModelChannel{}, errors.New("缺少模型渠道")
	}
	config, ok, err := repository.GetUserConfig(userID)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !ok || strings.TrimSpace(config.ModelConfig) == "" {
		return model.ModelChannel{}, errors.New("本地渠道不存在")
	}
	var modelConfig userModelConfigInput
	if err := json.Unmarshal([]byte(config.ModelConfig), &modelConfig); err != nil {
		return model.ModelChannel{}, err
	}
	for _, channel := range modelConfig.LocalChannels {
		if strings.TrimSpace(channel.ID) != channelID {
			continue
		}
		baseURL := strings.TrimSpace(channel.BaseURL)
		apiKey := strings.TrimSpace(channel.APIKey)
		if baseURL == "" || apiKey == "" {
			return model.ModelChannel{}, errors.New("本地渠道配置不完整")
		}
		models := userLocalChannelModels(channel.Models)
		if len(models) > 0 && !userLocalChannelHasModel(models, modelName) {
			return model.ModelChannel{}, errors.New("本地渠道不支持该模型")
		}
		protocol := strings.ToLower(strings.TrimSpace(channel.Protocol))
		if protocol == "" {
			protocol = "openai"
		}
		return model.ModelChannel{
			ID:       channelID,
			Protocol: protocol,
			Name:     firstVideoTaskValue(strings.TrimSpace(channel.Name), "本地直连"),
			BaseURL:  baseURL,
			APIKey:   apiKey,
			Models:   models,
			Weight:   1,
			Timeout:  600,
			Enabled:  true,
		}, nil
	}
	return model.ModelChannel{}, errors.New("本地渠道不存在")
}

func userLocalChannelModels(models []string) []string {
	result := make([]string, 0, len(models))
	seen := map[string]bool{}
	for _, item := range models {
		modelName := strings.TrimSpace(item)
		if modelName == "" || seen[modelName] {
			continue
		}
		result = append(result, modelName)
		seen[modelName] = true
	}
	return result
}

func userLocalChannelHasModel(models []string, modelName string) bool {
	for _, item := range models {
		if strings.EqualFold(strings.TrimSpace(item), modelName) {
			return true
		}
	}
	return false
}

func CurrentUserConfig(ctx context.Context) (UserConfigPayload, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return UserConfigPayload{}, errors.New("请先登录")
	}
	config, ok, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return UserConfigPayload{}, err
	}
	result := UserConfigPayload{
		SyncCapabilities: map[string]bool{
			"userData":  true,
			"workflows": true,
			"assets":    true,
		},
	}
	if !ok {
		return result, nil
	}
	if strings.TrimSpace(config.ModelConfig) != "" {
		result.ModelConfig = json.RawMessage(config.ModelConfig)
	}
	if strings.TrimSpace(config.StorageProvider) != "" {
		providers := readUserStorageProviders(config.StorageProvider)
		var syncFlags struct {
			SyncStorageConfig       bool `json:"syncStorageConfig"`
			SyncWebDAVStorageConfig bool `json:"syncWebDAVStorageConfig"`
		}
		_ = json.Unmarshal(result.ModelConfig, &syncFlags)
		if !syncFlags.SyncStorageConfig {
			providers.S3 = nil
		}
		if !syncFlags.SyncWebDAVStorageConfig {
			providers.WebDAV = nil
		}
		if providers.S3 != nil || providers.WebDAV != nil {
			result.StorageProvider = &providers
		}
	}
	if strings.TrimSpace(config.ImageHistory) != "" {
		result.ImageHistory = json.RawMessage(config.ImageHistory)
	}
	if strings.TrimSpace(config.AssetData) != "" {
		result.AssetData = json.RawMessage(config.AssetData)
	}
	return result, nil
}

func readUserStorageProviders(raw string) UserStorageProviders {
	var providers UserStorageProviders
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &providers)
	}
	return providers
}

func SaveCurrentUserModelConfig(ctx context.Context, raw json.RawMessage) (UserConfigPayload, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return UserConfigPayload{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return UserConfigPayload{}, err
	}
	current := now()
	if config.UserID == "" {
		config.UserID = user.ID
		config.CreatedAt = current
	}
	config.ModelConfig = string(raw)
	config.UpdatedAt = current
	if _, err := repository.SaveUserConfig(config); err != nil {
		return UserConfigPayload{}, err
	}
	return CurrentUserConfig(ctx)
}

func CurrentUserImageHistory(ctx context.Context) (json.RawMessage, error) {
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.ImageHistory) == "" {
		return json.RawMessage(`{"logs":[],"categories":[]}`), nil
	}
	return json.RawMessage(config.ImageHistory), nil
}

func SaveCurrentUserImageHistory(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	config, err := saveCurrentUserConfigField(ctx, func(config *model.UserConfig) {
		config.ImageHistory = string(raw)
	})
	if err != nil {
		return nil, err
	}
	return json.RawMessage(config.ImageHistory), nil
}

func CurrentUserAssetData(ctx context.Context) (json.RawMessage, error) {
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.AssetData) == "" {
		return json.RawMessage(`{"assets":[]}`), nil
	}
	return json.RawMessage(config.AssetData), nil
}

func SaveCurrentUserAssetData(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	rows, err := userAssetRows(ctx, raw)
	if err != nil {
		return nil, err
	}
	config, err := saveCurrentUserConfigField(ctx, func(config *model.UserConfig) {
		config.AssetData = string(raw)
	})
	if err != nil {
		return nil, err
	}
	if err := repository.SyncUserAssets(userIDFromContext(ctx), rows); err != nil {
		return nil, err
	}
	return json.RawMessage(config.AssetData), nil
}

func CurrentUserAssets(ctx context.Context, kind string, query string, cursor string, limit int) (UserAssetPage, error) {
	userID := userIDFromContext(ctx)
	if userID == "" {
		return UserAssetPage{}, errors.New("请先登录")
	}
	cursorTime, cursorID, err := decodeUserAssetCursor(cursor)
	if err != nil {
		return UserAssetPage{}, err
	}
	rows, hasMore, err := repository.ListUserAssets(userID, kind, query, cursorTime, cursorID, limit)
	if err != nil {
		return UserAssetPage{}, err
	}
	total, err := repository.CountUserAssets(userID, kind, query)
	if err != nil {
		return UserAssetPage{}, err
	}
	if total == 0 && strings.TrimSpace(cursor) == "" && strings.TrimSpace(kind) == "" && strings.TrimSpace(query) == "" {
		if config, ok, configErr := repository.GetUserConfig(userID); configErr == nil && ok && strings.TrimSpace(config.AssetData) != "" {
			if legacyRows, rowsErr := userAssetRows(ctx, json.RawMessage(config.AssetData)); rowsErr == nil {
				if syncErr := repository.SyncUserAssets(userID, legacyRows); syncErr == nil {
					rows, hasMore, err = repository.ListUserAssets(userID, kind, query, cursorTime, cursorID, limit)
					if err != nil {
						return UserAssetPage{}, err
					}
					total, err = repository.CountUserAssets(userID, kind, query)
					if err != nil {
						return UserAssetPage{}, err
					}
				}
			}
		}
	}
	page := UserAssetPage{Assets: make([]json.RawMessage, 0, len(rows)), HasMore: hasMore, Total: total}
	for _, row := range rows {
		page.Assets = append(page.Assets, refreshUserAssetPayload(userID, []byte(row.Payload)))
	}
	if hasMore && len(rows) > 0 {
		page.NextCursor = encodeUserAssetCursor(userAssetCursor{UpdatedAt: rows[len(rows)-1].UpdatedAt, ID: rows[len(rows)-1].ID})
	}
	return page, nil
}

func userAssetRows(ctx context.Context, raw json.RawMessage) ([]model.UserAsset, error) {
	userID := userIDFromContext(ctx)
	if userID == "" {
		return nil, errors.New("请先登录")
	}
	var snapshot struct {
		Assets []json.RawMessage `json:"assets"`
	}
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, errors.New("素材数据格式无效")
	}
	current := now()
	rows := make([]model.UserAsset, 0, len(snapshot.Assets))
	seen := make(map[string]struct{}, len(snapshot.Assets))
	for _, payload := range snapshot.Assets {
		var asset struct {
			ID        string `json:"id"`
			Kind      string `json:"kind"`
			Title     string `json:"title"`
			Source    string `json:"source"`
			CreatedAt string `json:"createdAt"`
			UpdatedAt string `json:"updatedAt"`
		}
		if err := json.Unmarshal(payload, &asset); err != nil || !isUserAssetKind(asset.Kind) {
			return nil, errors.New("素材数据格式无效")
		}
		clientID := strings.TrimSpace(asset.ID)
		if clientID == "" {
			clientID = uuid.NewString()
		}
		if _, exists := seen[clientID]; exists {
			continue
		}
		seen[clientID] = struct{}{}
		createdAt := strings.TrimSpace(asset.CreatedAt)
		if createdAt == "" {
			createdAt = current
		}
		updatedAt := strings.TrimSpace(asset.UpdatedAt)
		if updatedAt == "" {
			updatedAt = createdAt
		}
		rows = append(rows, model.UserAsset{
			ID: uuid.NewString(), UserID: userID, Kind: strings.TrimSpace(asset.Kind),
			Title: asset.Title, Source: asset.Source, Payload: string(payload),
			CreatedAt: createdAt, UpdatedAt: updatedAt,
		})
	}
	return rows, nil
}

func isUserAssetKind(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "text", "image", "video", "audio":
		return true
	default:
		return false
	}
}

func decodeUserAssetCursor(value string) (string, string, error) {
	if strings.TrimSpace(value) == "" {
		return "", "", nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return "", "", errors.New("素材分页游标无效")
	}
	var cursor userAssetCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.UpdatedAt == "" || cursor.ID == "" {
		return "", "", errors.New("素材分页游标无效")
	}
	return cursor.UpdatedAt, cursor.ID, nil
}

func encodeUserAssetCursor(cursor userAssetCursor) string {
	value, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(value)
}

func refreshUserAssetPayload(userID string, raw []byte) json.RawMessage {
	var asset map[string]any
	if json.Unmarshal(raw, &asset) != nil {
		return json.RawMessage(raw)
	}
	data, _ := asset["data"].(map[string]any)
	storageKey, _ := data["storageKey"].(string)
	if !strings.HasPrefix(storageKey, "server:") {
		return json.RawMessage(raw)
	}
	objectID := strings.TrimPrefix(storageKey, "server:")
	object, err := repository.GetUserStorageObject(userID, objectID)
	if err != nil {
		return json.RawMessage(raw)
	}
	url := SignedStorageURL(object.ID, userID)
	switch strings.TrimSpace(fmt.Sprint(asset["kind"])) {
	case "image":
		data["dataUrl"] = url
		if _, ok := asset["coverUrl"]; ok {
			asset["coverUrl"] = url
		}
	case "video", "audio":
		data["url"] = url
	}
	asset["data"] = data
	result, err := json.Marshal(asset)
	if err != nil {
		return json.RawMessage(raw)
	}
	return result
}

func currentUserConfig(ctx context.Context) (model.UserConfig, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserConfig{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return model.UserConfig{}, err
	}
	if config.UserID == "" {
		config.UserID = user.ID
	}
	return config, nil
}

func saveCurrentUserConfigField(ctx context.Context, patch func(config *model.UserConfig)) (model.UserConfig, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserConfig{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return model.UserConfig{}, err
	}
	current := now()
	if config.UserID == "" {
		config.UserID = user.ID
		config.CreatedAt = current
	}
	patch(&config)
	config.UpdatedAt = current
	return repository.SaveUserConfig(config)
}
