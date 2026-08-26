package service

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func TestPlatformAuthDisablesRemoteModelChannels(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	config.Cfg = config.Config{
		PlatformAPIBaseURL:     "https://api.jisudeng.com",
		PlatformExchangeSecret: "test-secret",
	}

	if UserCanUseRemoteModelChannel(model.AuthUser{Role: model.UserRoleAdmin}) {
		t.Fatal("platform SSO must disable remote channels for administrators too")
	}
}

func TestVideoModelNameRecognizesConfiguredAliasesWithoutClassifyingMinimaxText(t *testing.T) {
	for _, name := range []string{"manxue2.5", "minimax_h3", "seedance2.5", "sd2.5", "veo-3.1", "veo-3.1-fast", "veo-3.1-i2v"} {
		if !isVideoModelName(name) {
			t.Fatalf("%q should be classified as video", name)
		}
	}
	for _, name := range []string{"minimax-text-01", "minimax-chat", "minimax-01"} {
		if isVideoModelName(name) {
			t.Fatalf("%q should not be classified as video", name)
		}
	}
}

func TestModelCapabilitiesRecognizeSenseNovaOnlyByExactID(t *testing.T) {
	for _, name := range []string{"sensenova-u1.5-lite", "sensenova-u1-fast"} {
		capabilities := modelCapabilitiesForModels(nil, []string{name})
		if got := capabilities[name]; !reflect.DeepEqual(got, []model.ModelCapability{model.ModelCapabilityImage}) {
			t.Fatalf("%q capabilities = %#v, want image only", name, got)
		}
		if !isImageModelName(name) {
			t.Fatalf("%q should be classified as an image model", name)
		}
	}

	for _, name := range []string{"sensenova-u1.5-lite-preview", "custom-sensenova-u1-fast", "sensenova-u1"} {
		capabilities := modelCapabilitiesForModels(nil, []string{name})
		if got := capabilities[name]; len(got) != 0 && got[0] == model.ModelCapabilityImage {
			t.Fatalf("%q must not inherit an image capability from a partial model ID: %#v", name, got)
		}
		if isImageModelName(name) {
			t.Fatalf("%q must not be classified as an image model by a partial SenseNova ID", name)
		}
	}
}

func TestPublicChannelInfosFailClosedWhenAChannelDeclaresCapabilities(t *testing.T) {
	channels := []model.ModelChannel{
		{
			ID:      "declared-image",
			Name:    "Declared image channel",
			BaseURL: "https://example.test",
			Enabled: true,
			Models:  []string{"future-image", "sensenova-u1-fast"},
			ModelCapabilities: model.ModelCapabilities{
				"future-image": {model.ModelCapabilityImage},
			},
		},
	}

	infos := publicChannelInfos(channels)
	if len(infos) != 1 {
		t.Fatalf("publicChannelInfos() length = %d, want 1", len(infos))
	}
	if got := infos[0].ModelCapabilities["future-image"]; !reflect.DeepEqual(got, []model.ModelCapability{model.ModelCapabilityImage}) {
		t.Fatalf("declared capabilities = %#v, want image", got)
	}
	if got, exists := infos[0].ModelCapabilities["sensenova-u1-fast"]; !exists || len(got) != 0 {
		t.Fatalf("undeclared model capabilities = %#v, want an explicit empty declaration", got)
	}
	public := publicModelCapabilities(nil, channels, []string{"future-image", "sensenova-u1-fast"})
	if got, exists := public["sensenova-u1-fast"]; !exists || len(got) != 0 {
		t.Fatalf("public undeclared model capabilities = %#v, want an explicit empty declaration", got)
	}
}

func TestModelCapabilitiesForModelsUsesLegacyOnlyWithoutDeclarations(t *testing.T) {
	declared := model.ModelCapabilities{
		"declared-text": {model.ModelCapabilityText},
	}
	models := []string{"declared-text", "sensenova-u1-fast", "legacy-image"}

	got := modelCapabilitiesForModels(declared, models)
	if want := []model.ModelCapability{model.ModelCapabilityText}; !reflect.DeepEqual(got["declared-text"], want) {
		t.Fatalf("declared capabilities = %#v, want %#v", got["declared-text"], want)
	}
	for _, name := range []string{"sensenova-u1-fast", "legacy-image"} {
		if capabilities, exists := got[name]; !exists || len(capabilities) != 0 {
			t.Fatalf("%q capabilities = %#v, want explicit empty declaration", name, capabilities)
		}
	}

	legacy := modelCapabilitiesForModels(nil, []string{"sensenova-u1-fast", "legacy-image"})
	if got := legacy["sensenova-u1-fast"]; !reflect.DeepEqual(got, []model.ModelCapability{model.ModelCapabilityImage}) {
		t.Fatalf("legacy exact SenseNova capabilities = %#v, want image", got)
	}
	if got := legacy["legacy-image"]; !reflect.DeepEqual(got, []model.ModelCapability{model.ModelCapabilityImage}) {
		t.Fatalf("legacy image capabilities = %#v, want image", got)
	}
}

func TestPublicModelCapabilitiesKeepsLegacyClassificationScopedToLegacyChannels(t *testing.T) {
	channels := []model.ModelChannel{
		{
			ID:      "declared-channel",
			BaseURL: "https://declared.example.test",
			Enabled: true,
			Models:  []string{"declared-image", "sensenova-u1-fast"},
			ModelCapabilities: model.ModelCapabilities{
				"declared-image": {model.ModelCapabilityImage},
			},
		},
		{
			ID:      "legacy-channel",
			BaseURL: "https://legacy.example.test",
			Enabled: true,
			Models:  []string{"legacy-video"},
		},
	}

	got := publicModelCapabilities(nil, channels, []string{"declared-image", "sensenova-u1-fast", "legacy-video"})
	if capabilities := got["sensenova-u1-fast"]; len(capabilities) != 0 {
		t.Fatalf("undeclared model capabilities = %#v, want explicit empty declaration", capabilities)
	}
	if want := []model.ModelCapability{model.ModelCapabilityVideo}; !reflect.DeepEqual(got["legacy-video"], want) {
		t.Fatalf("legacy channel capabilities = %#v, want %#v", got["legacy-video"], want)
	}
}

func TestNormalizePublicSettingsUsesPublishedCapabilitiesForDefaults(t *testing.T) {
	channels := []model.ModelChannel{{
		ID:      "declared-channel",
		BaseURL: "https://example.test",
		Enabled: true,
		Models:  []string{"image-named-text", "opaque-image"},
		ModelCapabilities: model.ModelCapabilities{
			"image-named-text": {model.ModelCapabilityText},
			"opaque-image":     {model.ModelCapabilityImage},
		},
	}}

	setting := normalizePublicSettingWithChannels(model.PublicSetting{
		ModelChannel: model.PublicModelChannelSetting{AvailableModels: []string{"image-named-text", "opaque-image"}},
	}, channels)
	if got := setting.ModelChannel.DefaultImageModel; got != "opaque-image" {
		t.Fatalf("default image model = %q, want opaque-image", got)
	}
	if got := setting.ModelChannel.DefaultTextModel; got != "image-named-text" {
		t.Fatalf("default text model = %q, want image-named-text", got)
	}
}

func TestFetchAdminChannelModelsParsesOpenAIModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":""}]}`))
	}))
	defer server.Close()

	models, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL,
		APIKey:  "test-key",
	})
	if err != nil {
		t.Fatalf("fetchAdminChannelModels returned error: %v", err)
	}
	if want := []string{"a-model", "z-model"}; !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %#v, want %#v", models, want)
	}
}

func TestFetchAdminChannelModelsReportsArkPlanModelsUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/plan/v3/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL + "/api/plan/v3/contents/generations/tasks",
		APIKey:  "test-key",
	})
	if err == nil {
		t.Fatal("expected unsupported /models error")
	}
	if !strings.Contains(err.Error(), "Agent Plan 未提供 OpenAI /models") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestBuildModelChannelURLNormalizesArkPlanTaskPath(t *testing.T) {
	got := BuildModelChannelURL(model.ModelChannel{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks?debug=1"}, "/models")
	want := "https://ark.cn-beijing.volces.com/api/plan/v3/models"
	if got != want {
		t.Fatalf("BuildModelChannelURL = %q, want %q", got, want)
	}
}

func TestBuildModelChannelURLZhipuV4(t *testing.T) {
	tests := []struct {
		baseURL string
		path    string
		want    string
	}{
		{"https://open.bigmodel.cn/api/paas/v4", "/chat/completions", "https://open.bigmodel.cn/api/paas/v4/chat/completions"},
		{"https://open.bigmodel.cn/api/paas/v4/", "/models", "https://open.bigmodel.cn/api/paas/v4/models"},
		{"https://open.bigmodel.cn/api/paas/v4", "/images/generations", "https://open.bigmodel.cn/api/paas/v4/images/generations"},
		{"https://ark.cn-beijing.volces.com/api/plan/v3", "/chat/completions", "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions"},
		{"https://api.openai.com", "/chat/completions", "https://api.openai.com/v1/chat/completions"},
	}
	for _, tt := range tests {
		got := BuildModelChannelURL(model.ModelChannel{BaseURL: tt.baseURL}, tt.path)
		if got != tt.want {
			t.Fatalf("BuildModelChannelURL(%q, %q) = %q, want %q", tt.baseURL, tt.path, got, tt.want)
		}
	}
}
