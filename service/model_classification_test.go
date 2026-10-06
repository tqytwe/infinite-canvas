package service

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"reflect"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestExplicitModelClassificationAndPublicIsolation(t *testing.T) {
	var channels []model.ModelChannel
	err := json.Unmarshal([]byte(`[{"id":"video","protocol":"openai","enabled":true,"baseUrl":"https://example.invalid","models":["custom-name","gpt-image-2","hidden"],"modelCapabilities":{"custom-name":"video","gpt-image-2":"video","hidden":"video"}},{"id":"text","protocol":"openai","enabled":true,"baseUrl":"https://example.invalid","models":["custom-name"],"modelCapabilities":{"custom-name":"text"}}]`), &channels)
	if err != nil {
		t.Fatal(err)
	}
	infos := publicChannelInfos(normalizePrivateSetting(model.PrivateSetting{Channels: channels}).Channels, []string{"custom-name", "gpt-image-2"}, nil)
	encoded, err := json.Marshal(infos)
	if err != nil {
		t.Fatal(err)
	}
	var result []struct {
		ModelCapabilities map[string]string `json:"modelCapabilities"`
	}
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 || !reflect.DeepEqual(result[0].ModelCapabilities, map[string]string{"custom-name": "video", "gpt-image-2": "video"}) || !reflect.DeepEqual(result[1].ModelCapabilities, map[string]string{"custom-name": "text"}) {
		t.Fatalf("public classifications lost or crossed channels: %s", encoded)
	}
}

func TestExplicitModelClassificationRepairsDefaults(t *testing.T) {
	var channels []model.ModelChannel
	if err := json.Unmarshal([]byte(`[{"enabled":true,"models":["gpt-image-2","plain"],"modelCapabilities":{"gpt-image-2":"video","plain":"text"}}]`), &channels); err != nil {
		t.Fatal(err)
	}
	setting := normalizePublicSettingWithChannels(model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{AvailableModels: []string{"gpt-image-2", "plain"}, DefaultImageModel: "gpt-image-2"}}, channels).ModelChannel
	if setting.DefaultVideoModel != "gpt-image-2" || setting.DefaultTextModel != "plain" || setting.DefaultImageModel != "" {
		t.Fatalf("defaults ignored explicit classification: %#v", setting)
	}
}

func TestUserLocalChannelInputKeepsModelClassification(t *testing.T) {
	var input userModelConfigInput
	if err := json.Unmarshal([]byte(`{"localChannels":[{"id":"video","models":["plain"],"modelCapabilities":{"plain":"video"}}]}`), &input); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var output struct {
		LocalChannels []struct {
			ModelCapabilities map[string]string `json:"modelCapabilities"`
		} `json:"localChannels"`
	}
	if err := json.Unmarshal(encoded, &output); err != nil {
		t.Fatal(err)
	}
	if output.LocalChannels[0].ModelCapabilities["plain"] != "video" {
		t.Fatalf("user config classification lost: %s", encoded)
	}
}

func TestModelClassificationAccountAndSettingsPersistence(t *testing.T) {
	// Isolate the repository singleton and never use the host database.
	const marker = "MODEL_CLASSIFICATION_ACCOUNT_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestModelClassificationAccountAndSettingsPersistence$", "-test.timeout=40s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated classification persistence: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	channels := []model.ModelChannel{
		{ID: "video", Protocol: "openai", BaseURL: "https://example.invalid", APIKey: "test-fixture", Models: []string{"plain", "hidden"}, Enabled: true, ModelCapabilities: map[string]string{"plain": "video", "hidden": "text"}},
		{ID: "text", Protocol: "openai", BaseURL: "https://example.invalid", APIKey: "test-fixture", Models: []string{"plain"}, Enabled: true, ModelCapabilities: map[string]string{"plain": "text"}},
	}
	raw, err := json.Marshal(map[string]any{"localChannels": channels, "videoModel": "plain", "videoChannelId": "video"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithUser(context.Background(), model.AuthUser{ID: "classification-user"})
	if _, err := SaveCurrentUserModelConfig(context.Background(), raw); err == nil {
		t.Fatal("unauthenticated config save accepted")
	}
	if _, err := SaveCurrentUserModelConfig(ctx, raw); err != nil {
		t.Fatal(err)
	}
	reloaded, err := CurrentUserConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(reloaded.ModelConfig) != string(raw) {
		t.Fatal("account sync changed model configuration")
	}
	for _, item := range channels {
		selected, err := SelectUserLocalModelChannelForModel("classification-user", "plain", item.ID)
		if err != nil {
			t.Fatal(err)
		}
		if selected.ModelCapabilities["plain"] != item.ModelCapabilities["plain"] {
			t.Fatal("local channel classification lost or crossed channels")
		}
	}
	mixed, err := SelectUserLocalModelChannelForModel("classification-user", "hidden", "video")
	if err != nil || mixed.ModelCapabilities["plain"] != "video" || mixed.ModelCapabilities["hidden"] != "text" {
		t.Fatal("mixed classifications on one account channel were not preserved")
	}
	if _, err := SelectUserLocalModelChannelForModel("classification-user", "forbidden", "video"); err == nil {
		t.Fatal("unlisted local model accepted")
	}
	settings := model.Settings{Private: model.PrivateSetting{Channels: channels}, Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{AvailableModels: []string{"plain"}, DefaultVideoModel: "plain"}}}
	if _, err := SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	saved, err := AdminSettings()
	if err != nil {
		t.Fatal(err)
	}
	if saved.Private.Channels[0].ModelCapabilities["plain"] != "video" || saved.Private.Channels[1].ModelCapabilities["plain"] != "text" {
		t.Fatal("settings classification lost or crossed channels")
	}
	public, err := PublicSettings()
	if err != nil {
		t.Fatal(err)
	}
	if public.ModelChannel.DefaultVideoModel != "plain" || public.ModelChannel.Channels[0].ModelCapabilities["plain"] != "video" {
		t.Fatal("explicit custom video default lost on reload")
	}
	if _, ok := public.ModelChannel.Channels[0].ModelCapabilities["hidden"]; ok {
		t.Fatal("hidden model classification exposed")
	}
	if UserCanUseRemoteModelChannel(model.AuthUser{Role: model.UserRoleUser}) {
		t.Fatal("classification bypassed remote authorization")
	}
	if _, err := SelectModelChannelForModel("hidden", "video", true); err == nil {
		t.Fatal("classification bypassed public allowed models")
	}
	for _, name := range []string{"veo-3.1", "kling-v3", "sora-2", "nano-banana"} {
		public := model.PublicModelChannelSetting{AvailableModels: []string{name}}
		if name == "nano-banana" {
			public.DefaultImageModel = name
		} else {
			public.DefaultVideoModel = name
		}
		channel := model.ModelChannel{ID: "auto", Protocol: "gemini", Enabled: true, BaseURL: "https://example.invalid", Models: []string{name}}
		if _, err := SaveSettings(model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{channel}}, Public: model.PublicSetting{ModelChannel: public}}); err != nil {
			t.Fatal(err)
		}
		reloaded, err := AdminSettings()
		if err != nil {
			t.Fatal(err)
		}
		defaults := reloaded.Public.ModelChannel
		if name == "nano-banana" && defaults.DefaultImageModel != name || name != "nano-banana" && defaults.DefaultVideoModel != name {
			t.Fatalf("automatic default %q lost during settings save/reload", name)
		}
	}
}

func TestModelChannelClassificationOverridesAndAutomaticFallback(t *testing.T) {
	channel := model.ModelChannel{ModelCapabilities: map[string]string{"plain": "video", "gpt-image-2": "video", "seedance": "text"}}
	if !ModelChannelMatchesCapability(channel, "plain", "video") || ModelChannelMatchesCapability(channel, "plain", "text") || ModelChannelMatchesCapability(channel, "gpt-image-2", "image") || !ModelChannelMatchesCapability(channel, "seedance", "text") {
		t.Fatal("explicit classification did not override recognition")
	}
	if !ModelChannelMatchesCapability(model.ModelChannel{}, "seedance", "video") || !ModelChannelMatchesCapability(model.ModelChannel{}, "plain", "text") {
		t.Fatal("automatic classification changed")
	}
}

func TestModelAutomaticDefaultsRemainSelectable(t *testing.T) {
	for _, name := range []string{"veo-3.1", "kling-v3", "sora-2", "nano-banana"} {
		capability := "video"
		setting := model.PublicModelChannelSetting{AvailableModels: []string{name}, DefaultVideoModel: name}
		if name == "nano-banana" {
			capability = "image"
			setting.DefaultImageModel = name
		}
		channels := []model.ModelChannel{{ID: "auto", Protocol: "gemini", Enabled: true, Models: []string{name}}}
		result := normalizePublicSettingWithChannels(model.PublicSetting{ModelChannel: setting}, channels).ModelChannel
		if capability == "video" && result.DefaultVideoModel != name || capability == "image" && result.DefaultImageModel != name {
			t.Fatalf("automatic %s default %q lost", capability, name)
		}
	}
}
