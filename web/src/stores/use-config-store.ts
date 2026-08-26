"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { filterModelsByCapability as filterDiscoveredModelsByCapability, modelMatchesCapability as discoveredModelMatchesCapability, type ModelCapabilities, type ModelCapability } from "@/lib/model-capabilities";
import { platformManagedChannelForCapability, platformManagedChannels, type PlatformManagedBootstrap } from "@/lib/platform-managed-models";
import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export type LocalModelChannel = {
    id: string;
    protocol: "openai" | "kie" | "mimo";
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    modelCapabilities?: ModelCapabilities;
    declaredModelIds?: string[];
    modelDiscovery?: {
        state: "declared" | "legacy" | "error";
        message?: string;
    };
    managedPlatform?: boolean;
    platformPurpose?: "chat" | "image" | "video";
    platformGroupID?: string;
    isCurrent?: boolean;
};

export type PublicModelChannel = {
    id?: string;
    name?: string;
    baseUrl?: string;
    models?: string[];
    modelCapabilities?: ModelCapabilities;
    weight?: number;
    timeout?: number;
    enabled?: boolean;
    remark?: string;
};

export type VideoMultiPromptItem = { prompt: string; duration: string };
export type VideoElementReference = { id: string; kind: "image" | "video" | "audio"; name: string; type: string; dataUrl?: string; url?: string; storageKey?: string; bytes?: number; width?: number; height?: number; durationMs?: number };
export type VideoElementItem = { name: string; description: string; references: VideoElementReference[] };

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    glmTtsVoice: string;
    glmTtsFormat: string;
    glmTtsSpeed: string;
    mimoTtsVoice: string;
    mimoTtsFormat: string;
    mimoVoiceDesignPrompt: string;
    videoSeconds: string;
    videoMode: string;
    videoNegativePrompt: string;
    videoMultiShot: string;
    videoShotType: string;
    videoMultiPrompt: VideoMultiPromptItem[];
    videoElementList: VideoElementItem[];
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoCharacterOrientation: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    videoSize: string;
    count: string;
    canvasImageCount: string;
    timeout: string;
    apiMode: string;
    streamImages: string;
    streamPartialImages: string;
    responseFormatB64Json: string;
    codexCli: string;
    systemPrompts: {
        image: string;
        video: string;
        text: string;
        workflow: string;
        workflowAgent: string;
    };
    localChannels: LocalModelChannel[];
    publicChannels: PublicModelChannel[];
    syncStorageConfig: boolean;
    syncWebDAVStorageConfig: boolean;
    activeChannelId: string;
    imageChannelId: string;
    videoChannelId: string;
    textChannelId: string;
    audioChannelId: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type { ModelCapability, ModelCapabilities } from "@/lib/model-capabilities";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "https://api.openai.com",
    apiKey: "",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    videoModel: "grok-imagine-video",
    textModel: "gpt-5.5",
    audioModel: "gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    glmTtsVoice: "tongtong",
    glmTtsFormat: "wav",
    glmTtsSpeed: "1",
    mimoTtsVoice: "冰糖",
    mimoTtsFormat: "wav",
    mimoVoiceDesignPrompt: "",
    videoSeconds: "6",
    videoMode: "std",
    videoNegativePrompt: "",
    videoMultiShot: "false",
    videoShotType: "intelligence",
    videoMultiPrompt: [{ prompt: "", duration: "1" }],
    videoElementList: [{ name: "", description: "", references: [] }],
    vquality: "720",
    videoGenerateAudio: "false",
    videoWatermark: "false",
    videoCharacterOrientation: "video",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    videoSize: "1280x720",
    count: "1",
    canvasImageCount: "1",
    timeout: "600",
    apiMode: "images",
    streamImages: "",
    streamPartialImages: "1",
    responseFormatB64Json: "",
    codexCli: "",
    systemPrompts: {
        image: "",
        video: "",
        text: "",
        workflow: "",
        workflowAgent: "",
    },
    localChannels: [],
    publicChannels: [],
    syncStorageConfig: false,
    syncWebDAVStorageConfig: false,
    activeChannelId: "",
    imageChannelId: "",
    videoChannelId: "",
    textChannelId: "",
    audioChannelId: "",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    platformBootstrap: PlatformManagedBootstrap | null;
    platformBootstrapError: string;
    isPlatformBootstrapLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    loadPlatformBootstrap: (token: string) => Promise<void>;
    clearPlatformBootstrap: () => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null, canUseRemoteChannel: boolean, isPlatformManagedUser: boolean, platformBootstrap: PlatformManagedBootstrap | null, platformToken: string) {
    if (isPlatformManagedUser) return resolvePlatformManagedConfig(config, platformBootstrap, platformToken);
    const channelMode = canUseRemoteChannel ? (modelChannel?.allowCustomChannel ? config.channelMode : "remote") : "local";
    if (channelMode === "local" || !modelChannel) {
        const localChannels = normalizeLocalChannels(config);
        const models = normalizeModelList(localChannels.flatMap((channel) => channel.models));
        return {
            ...config,
            channelMode,
            localChannels,
            models,
            imageModels: localModelsByCapability(localChannels, "image"),
            videoModels: localModelsByCapability(localChannels, "video"),
            textModels: localModelsByCapability(localChannels, "text"),
            audioModels: localModelsByCapability(localChannels, "audio"),
            publicChannels: modelChannel?.channels || [],
        };
    }
    const models = modelChannel.availableModels;
    const capabilitySource = { modelCapabilities: modelChannel.modelCapabilities };
    const textModels = filterModelsByCapability(models, "text", capabilitySource);
    const imageModels = filterModelsByCapability(models, "image", capabilitySource);
    const videoModels = filterModelsByCapability(models, "video", capabilitySource);
    const audioModels = filterModelsByCapability(models, "audio", capabilitySource);
    const fallbackTextModel = validDefault(modelChannel.defaultTextModel, textModels) || preferredModel(textModels, isTextModelName);
    const fallbackModel = validDefault(modelChannel.defaultModel, textModels) || fallbackTextModel;
    const fallbackImageModel = validDefault(modelChannel.defaultImageModel, imageModels) || preferredModel(imageModels, isImageModelName);
    const fallbackVideoModel = validDefault(modelChannel.defaultVideoModel, videoModels) || preferredModel(videoModels, isVideoModelName);
    const fallbackAudioModel = preferredModel(audioModels, isAudioModelName);
    return {
        ...config,
        channelMode,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: textModels.includes(config.model) ? config.model : fallbackModel,
        imageModel: imageModels.includes(config.imageModel) ? config.imageModel : fallbackImageModel,
        videoModel: videoModels.includes(config.videoModel) ? config.videoModel : fallbackVideoModel,
        textModel: textModels.includes(config.textModel) ? config.textModel : fallbackTextModel || fallbackModel,
        audioModel: audioModels.includes(config.audioModel) ? config.audioModel : fallbackAudioModel,
        systemPrompt: modelChannel.systemPrompt,
        publicChannels: modelChannel.channels || [],
    };
}

function resolvePlatformManagedConfig(config: AiConfig, bootstrap: PlatformManagedBootstrap | null, token: string) {
    // The Canvas JWT is injected only into this calculated runtime config. It
    // is never copied into the persisted AI configuration, and the platform
    // API keys are never available to the browser.
    const managedChannels = platformManagedChannels(bootstrap);
    const localChannels = managedChannels.map((channel) => ({ ...channel, apiKey: token }));
    const models = normalizeModelList(localChannels.flatMap((channel) => channel.models));
    const imageModels = localModelsByCapability(localChannels, "image");
    const videoModels = localModelsByCapability(localChannels, "video");
    const textModels = localModelsByCapability(localChannels, "text");
    const audioModels = localModelsByCapability(localChannels, "audio");
    const imageChannel = platformManagedChannelForCapability(managedChannels, "image", config.imageChannelId);
    const videoChannel = platformManagedChannelForCapability(managedChannels, "video", config.videoChannelId);
    const textChannel = platformManagedChannelForCapability(managedChannels, "text", config.textChannelId);
    const audioChannel = platformManagedChannelForCapability(managedChannels, "audio", config.audioChannelId);
    const selectModel = (current: string, options: string[]) => (options.includes(current) ? current : options[0] || "");
    const imageModel = selectModel(config.imageModel, imageModels);
    const videoModel = selectModel(config.videoModel, videoModels);
    const textModel = selectModel(config.textModel, textModels);
    const audioModel = selectModel(config.audioModel, audioModels);
    return {
        ...config,
        channelMode: "local" as const,
        baseUrl: "/api",
        apiKey: token,
        localChannels,
        publicChannels: [],
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel,
        videoModel,
        textModel,
        audioModel,
        model: textModel || imageModel || videoModel || audioModel,
        imageChannelId: imageChannel?.id || "",
        videoChannelId: videoChannel?.id || "",
        textChannelId: textChannel?.id || "",
        audioChannelId: audioChannel?.id || "",
        activeChannelId: textChannel?.id || imageChannel?.id || videoChannel?.id || "",
    };
}

function validDefault(model: string, models: string[]) {
    return models.includes(model) ? model : "";
}

function preferredModel(models: string[], predicate: (model: string) => boolean) {
    return models.find(predicate) || "";
}

function isImageModelName(model: string) {
    return discoveredModelMatchesCapability(model, "image");
}

function isVideoModelName(model: string) {
    return discoveredModelMatchesCapability(model, "video");
}

function isAudioModelName(model: string) {
    return discoveredModelMatchesCapability(model, "audio");
}

function isTextModelName(model: string) {
    return discoveredModelMatchesCapability(model, "text");
}

export function modelMatchesCapability(model: string, capability?: ModelCapability, source?: { modelCapabilities?: ModelCapabilities; declaredModelIds?: string[] }) {
    return discoveredModelMatchesCapability(model, capability, source);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability, source?: { modelCapabilities?: ModelCapabilities; declaredModelIds?: string[] }) {
    return filterDiscoveredModelsByCapability(models, capability, source);
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    return filterModelsByCapability(config.models, capability);
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = localChannelForActiveModel({ ...config, model });
    return Boolean(model.trim()) && (config.channelMode === "remote" || Boolean(channel?.baseUrl.trim() && channel?.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            platformBootstrap: null,
            platformBootstrapError: "",
            isPlatformBootstrapLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            loadPlatformBootstrap: async (token) => {
                if (!token || get().isPlatformBootstrapLoading) return;
                set({ isPlatformBootstrapLoading: true, platformBootstrapError: "" });
                try {
                    const platformBootstrap = await apiGet<PlatformManagedBootstrap>("/api/v1/platform/bootstrap", undefined, token);
                    set({ platformBootstrap, platformBootstrapError: "" });
                } catch (error) {
                    set({ platformBootstrap: null, platformBootstrapError: error instanceof Error ? error.message : "创作能力加载失败" });
                } finally {
                    set({ isPlatformBootstrapLoading: false });
                }
            },
            clearPlatformBootstrap: () => set({ platformBootstrap: null, platformBootstrapError: "", isPlatformBootstrapLoading: false }),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                const localChannels = normalizeLocalChannels(config);
                const localModels = normalizeModelList(localChannels.flatMap((channel) => channel.models));
                return {
                    ...current,
                    config: {
                        ...config,
                        localChannels,
                        models: localModels,
                        baseUrl: localChannels[0]?.baseUrl || config.baseUrl,
                        apiKey: localChannels[0]?.apiKey || config.apiKey,
                        imageChannelId: config.imageChannelId || localChannels[0]?.id || "",
                        videoChannelId: config.videoChannelId || localChannels[0]?.id || "",
                        textChannelId: config.textChannelId || localChannels[0]?.id || "",
                        audioChannelId: config.audioChannelId || localChannels[0]?.id || "",
                        activeChannelId: config.activeChannelId || "",
                        syncStorageConfig: config.syncStorageConfig === true,
                        syncWebDAVStorageConfig: config.syncWebDAVStorageConfig === true,
                        channelMode: config.channelMode || "remote",
                        imageModel: config.imageModel || config.model,
                        videoModel: config.videoModel || "grok-imagine-video",
                        textModel: config.textModel || config.model,
                        audioModel: config.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        glmTtsVoice: config.glmTtsVoice || defaultConfig.glmTtsVoice,
                        glmTtsFormat: config.glmTtsFormat || defaultConfig.glmTtsFormat,
                        glmTtsSpeed: config.glmTtsSpeed || defaultConfig.glmTtsSpeed,
                        systemPrompts: config.systemPrompts?.image ? config.systemPrompts : defaultConfig.systemPrompts,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        videoMode: config.videoMode || "std",
                        videoNegativePrompt: config.videoNegativePrompt || "",
                        videoMultiShot: config.videoMultiShot || "false",
                        videoShotType: config.videoShotType || "intelligence",
                        videoMultiPrompt: Array.isArray(config.videoMultiPrompt) && config.videoMultiPrompt.length ? config.videoMultiPrompt : defaultConfig.videoMultiPrompt,
                        videoElementList: Array.isArray(config.videoElementList) && config.videoElementList.length ? config.videoElementList : defaultConfig.videoElementList,
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "false",
                        videoWatermark: config.videoWatermark || "false",
                        videoCharacterOrientation: config.videoCharacterOrientation === "image" ? "image" : "video",
                        canvasImageCount: config.canvasImageCount || "1",
                        imageModels: localModelsByCapability(localChannels, "image"),
                        videoModels: localModelsByCapability(localChannels, "video"),
                        textModels: localModelsByCapability(localChannels, "text"),
                        audioModels: localModelsByCapability(localChannels, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    const platformAuthEnabled = useConfigStore((state) => state.publicSettings?.auth?.platform?.enabled === true);
    const platformBootstrap = useConfigStore((state) => state.platformBootstrap);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const canUseRemoteChannel = !platformAuthEnabled && Boolean(token && user && (user.role === "admin" || modelChannel?.allowUserRemoteChannel === true));
    const isPlatformManagedUser = platformAuthEnabled && Boolean(user) && user?.role !== "admin";
    const managedBootstrap = isPlatformManagedUser ? platformBootstrap : null;
    return useMemo(() => resolveEffectiveConfig(config, modelChannel, canUseRemoteChannel, isPlatformManagedUser, managedBootstrap, token), [canUseRemoteChannel, config, isPlatformManagedUser, managedBootstrap, modelChannel, token]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeVersionedBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") || lowerBaseUrl.endsWith("/api/paas/v4") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeVersionedBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        for (const versionPath of ["/api/plan/v3", "/api/paas/v4"]) {
            const versionIndex = lowerPath.indexOf(versionPath);
            if (versionIndex < 0) continue;
            const end = versionIndex + versionPath.length;
            if (lowerPath.length !== end && lowerPath[end] !== "/") continue;
            url.pathname = path.slice(0, end);
            url.search = "";
            url.hash = "";
            return url.toString().replace(/\/+$/, "");
        }
        return baseUrl;
    } catch {
        return baseUrl;
    }
}

export function normalizeLocalChannels(config: Partial<AiConfig>): LocalModelChannel[] {
    const channels = Array.isArray(config.localChannels) ? config.localChannels : [];
    const normalized: LocalModelChannel[] = channels.map((channel, index) => {
        const models = Array.isArray(channel.models) ? channel.models.filter(Boolean) : [];
        const declaredModelIds = Array.isArray(channel.declaredModelIds) ? channel.declaredModelIds.filter((model): model is string => typeof model === "string" && Boolean(model.trim())) : [];
        const modelCapabilities = declaredModelIds.length ? Object.fromEntries(models.map((model) => [model, declaredModelIds.includes(model) ? channel.modelCapabilities?.[model] || [] : []])) : channel.modelCapabilities;
        return {
            id: channel.id || `local-${index + 1}`,
            protocol: channel.protocol === "kie" || channel.protocol === "mimo" ? channel.protocol : "openai",
            name: typeof channel.name === "string" ? channel.name : `本地渠道 ${index + 1}`,
            baseUrl: channel.baseUrl || "",
            apiKey: channel.apiKey || "",
            models,
            modelCapabilities,
            declaredModelIds,
            modelDiscovery: channel.modelDiscovery,
            managedPlatform: channel.managedPlatform === true,
            platformPurpose: channel.platformPurpose,
            platformGroupID: channel.platformGroupID,
            isCurrent: channel.isCurrent === true,
        };
    });
    if (!normalized.length) {
        normalized.push({ id: "local-default", protocol: "openai", name: "本地直连", baseUrl: config.baseUrl || defaultConfig.baseUrl, apiKey: config.apiKey || "", models: Array.isArray(config.models) ? config.models.filter(Boolean) : [] });
    }
    return normalized;
}

export function localModelsByCapability(channels: LocalModelChannel[], capability?: ModelCapability) {
    return normalizeModelList(channels.flatMap((channel) => filterModelsByCapability(channel.models, capability, channel)));
}

export function channelIdForActiveModel(config: AiConfig) {
    const channels =
        config.channelMode === "remote"
            ? config.publicChannels.map((channel) => ({
                  id: channel.id || "",
                  models: channel.models || [],
                  modelCapabilities: channel.modelCapabilities,
              }))
            : normalizeLocalChannels(config);
    for (const [capability, preferredChannelID] of [
        ["image", config.imageChannelId],
        ["video", config.videoChannelId],
        ["audio", config.audioChannelId],
        ["text", config.textChannelId],
    ] as const) {
        const preferred = channels.find((channel) => channel.id === preferredChannelID && channel.models.includes(config.model) && modelMatchesCapability(config.model, capability, channel));
        if (preferred?.id) return preferred.id;
        const matching = channels.find((channel) => channel.models.includes(config.model) && modelMatchesCapability(config.model, capability, channel));
        if (matching?.id) return matching.id;
    }
    if (config.activeChannelId) return config.activeChannelId;
    if (config.model === config.videoModel) return config.videoChannelId;
    if (config.model === config.textModel) return config.textChannelId;
    if (config.model === config.audioModel) return config.audioChannelId;
    return config.imageChannelId;
}

export function localChannelForActiveModel(config: AiConfig) {
    const channels = normalizeLocalChannels(config);
    const preferredId = channelIdForActiveModel(config);
    return channels.find((channel) => channel.id === preferredId && channel.models.includes(config.model)) || channels.find((channel) => channel.models.includes(config.model)) || channels.find((channel) => channel.id === preferredId) || channels[0];
}

export type DirectAIProvider = "kie" | "apimart";

const directAIProviderCache = new Map<string, DirectAIProvider | null>();

export function directAIProviderForConfig(config: AiConfig): DirectAIProvider | null {
    const channel = localChannelForActiveModel(config);
    if (!channel) return null;
    const protocol = channel.protocol.toLowerCase();
    const baseUrl = channel.baseUrl.trim().toLowerCase();
    const model = (config.model || "").trim().toLowerCase();
    const key = `${protocol}\n${baseUrl}\n${model}`;
    if (directAIProviderCache.has(key)) return directAIProviderCache.get(key) || null;
    const provider = protocol === "kie" || baseUrl.includes("kie.ai") || model.includes("kie/") ? "kie" : baseUrl.includes("apimart.ai") || model.includes("apimart") ? "apimart" : null;
    directAIProviderCache.set(key, provider);
    return provider;
}
