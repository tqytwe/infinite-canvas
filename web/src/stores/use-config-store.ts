"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { filterModelsByCapability as filterDiscoveredModelsByCapability, modelMatchesCapability as discoveredModelMatchesCapability, type ModelCapabilities, type ModelCapability } from "@/lib/model-capabilities";
import {
    platformManagedChannelForCapability,
    platformManagedChannels,
    type PlatformImageMediaCapabilities,
    type PlatformManagedBootstrap,
    type PlatformManagedModelMediaCapabilities,
    type PlatformMediaPurpose,
    type PlatformVideoMediaCapabilities,
} from "@/lib/platform-managed-models";
import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";

export type LocalModelChannel = {
    id: string;
    protocol: "openai" | "kie" | "mimo";
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    modelCapabilities?: ModelCapabilities;
    modelMediaCapabilities?: Record<string, PlatformManagedModelMediaCapabilities>;
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
    imageWatermark: string;
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
export const JISUDENG_API_BASE_URL = "https://api.jisudeng.com";
export type { ModelCapability, ModelCapabilities } from "@/lib/model-capabilities";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: JISUDENG_API_BASE_URL,
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
    imageWatermark: "true",
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
    platformBootstrapToken: string;
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
        // The platform's image sessions accept only the Images API. Normalize
        // a legacy persisted Responses selection in the effective config so
        // UI history and retries describe the request that will be sent.
        apiMode: "images",
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
            platformBootstrapToken: "",
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
                if (!token || (get().isPlatformBootstrapLoading && get().platformBootstrapToken === token)) return;
                set({ isPlatformBootstrapLoading: true, platformBootstrapError: "", platformBootstrapToken: token, platformBootstrap: null });
                try {
                    const platformBootstrap = await apiGet<PlatformManagedBootstrap>("/api/v1/platform/bootstrap", undefined, token);
                    if (get().platformBootstrapToken === token) set({ platformBootstrap, platformBootstrapError: "" });
                } catch (error) {
                    if (get().platformBootstrapToken === token) set({ platformBootstrap: null, platformBootstrapError: error instanceof Error ? error.message : "创作能力加载失败" });
                } finally {
                    if (get().platformBootstrapToken === token) set({ isPlatformBootstrapLoading: false });
                }
            },
            clearPlatformBootstrap: () => set({ platformBootstrap: null, platformBootstrapError: "", isPlatformBootstrapLoading: false, platformBootstrapToken: "" }),
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
                        imageWatermark: config.imageWatermark || "true",
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
    return useMemo(() => {
        const localChannels = normalizeLocalChannels(config);
        const models = normalizeModelList(localChannels.flatMap((channel) => channel.models));
        return {
            ...config,
            channelMode: "local" as const,
            baseUrl: localChannels[0]?.baseUrl || config.baseUrl,
            apiKey: localChannels[0]?.apiKey || config.apiKey,
            localChannels,
            models,
            imageModels: localModelsByCapability(localChannels, "image"),
            videoModels: localModelsByCapability(localChannels, "video"),
            textModels: localModelsByCapability(localChannels, "text"),
            audioModels: localModelsByCapability(localChannels, "audio"),
            publicChannels: [],
        };
    }, [config]);
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
    const channels = (Array.isArray(config.localChannels) ? config.localChannels : [])
        .filter((channel) => {
            const id = channel?.id || "";
            return channel?.managedPlatform !== true && !id.startsWith("platform-managed:") && !(channel?.baseUrl?.trim() === "/api" && !channel?.apiKey?.trim());
        })
        .map((source, index) => {
            const models = Array.isArray(source.models) ? source.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim())) : [];
            const declaredModelIds = Array.isArray(source.declaredModelIds) ? source.declaredModelIds.filter((model): model is string => typeof model === "string" && Boolean(model.trim())) : [];
            const modelCapabilities = declaredModelIds.length ? Object.fromEntries(models.map((model) => [model, declaredModelIds.includes(model) ? source.modelCapabilities?.[model] || [] : []])) : source.modelCapabilities;
            const protocol: LocalModelChannel["protocol"] = source.protocol === "kie" || source.protocol === "mimo" ? source.protocol : "openai";
            return {
                id: source.id?.trim() || `local-channel-${index + 1}`,
                protocol,
                name: source.name?.trim() || `渠道 ${index + 1}`,
                baseUrl: source.baseUrl || "",
                apiKey: source.apiKey || "",
                models,
                modelCapabilities,
                ...(source.modelMediaCapabilities ? { modelMediaCapabilities: source.modelMediaCapabilities } : {}),
                declaredModelIds,
                modelDiscovery: source.modelDiscovery,
            };
        });
    if (channels.length) return channels;

    const models = Array.isArray(config.models) ? config.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim())) : [];
    return [{ id: "jisudeng-api", protocol: "openai", name: "极速蹬 API", baseUrl: config.baseUrl || JISUDENG_API_BASE_URL, apiKey: config.apiKey || "", models }];
}

export function hasConfiguredJisudengAPIKey() {
    return normalizeLocalChannels(useConfigStore.getState().config).some((channel) => Boolean(channel.baseUrl.trim() && channel.apiKey.trim()));
}

export function localModelsByCapability(channels: LocalModelChannel[], capability?: ModelCapability) {
    return normalizeModelList(channels.flatMap((channel) => filterModelsByCapability(channel.models, capability, channel)));
}

// Server-declared media details are runtime-only and are accepted exclusively
// from a managed channel selected for the exact purpose. A locally persisted
// channel therefore cannot accidentally turn a text model into a media model.
function platformManagedChannelForConfig(config: AiConfig, purpose: Exclude<PlatformMediaPurpose, "chat">, model = config.model): LocalModelChannel | undefined {
    const modelID = model.trim();
    if (!modelID) return undefined;
    const preferredID = purpose === "image" ? config.imageChannelId : config.videoChannelId;
    const channels = normalizeLocalChannels(config);
    const supportsModel = (channel: LocalModelChannel) => channel.models.some((candidate) => candidate.trim().toLowerCase() === modelID.toLowerCase());
    const preferred = channels.find((channel) => channel.id === preferredID);
    if (preferred) {
        return preferred.managedPlatform === true && preferred.platformPurpose === purpose && supportsModel(preferred) ? preferred : undefined;
    }
    return channels.find((channel) => channel.managedPlatform === true && channel.platformPurpose === purpose && supportsModel(channel));
}

export function isPlatformManagedImageConfig(config: AiConfig, model = config.model): boolean {
    return Boolean(platformManagedChannelForConfig(config, "image", model));
}

// A managed image session is purpose-bound on the platform. The Responses API
// is a chat-purpose route there, so stale persisted settings must not redirect
// image work to it. Keep the normalization at the request boundary as well as
// the UI so restored workflow and retry snapshots remain safe.
export function forcePlatformManagedImageAPI<T extends AiConfig>(config: T): T {
    if (!isPlatformManagedImageConfig(config) || config.apiMode === "images") return config;
    return { ...config, apiMode: "images" } as T;
}

export function platformManagedMediaCapabilitiesForConfig(config: AiConfig, purpose: Exclude<PlatformMediaPurpose, "chat">, model = config.model): PlatformManagedModelMediaCapabilities | undefined {
    const modelID = model.trim();
    if (!modelID) return undefined;
    const channel = platformManagedChannelForConfig(config, purpose, modelID);
    if (!channel) return undefined;
    const exact = channel.modelMediaCapabilities?.[modelID];
    if (exact) return exact;
    return Object.entries(channel.modelMediaCapabilities || {}).find(([candidate]) => candidate.toLowerCase() === modelID.toLowerCase())?.[1];
}

export function platformManagedImageCapabilitiesForConfig(config: AiConfig, model = config.model): PlatformImageMediaCapabilities | undefined {
    return platformManagedMediaCapabilitiesForConfig(config, "image", model)?.image;
}

export function platformManagedVideoCapabilitiesForConfig(config: AiConfig, model = config.model): PlatformVideoMediaCapabilities | undefined {
    return platformManagedMediaCapabilitiesForConfig(config, "video", model)?.video;
}

export function channelIdForActiveModel(config: AiConfig, capability?: ModelCapability) {
    const channels =
        config.channelMode === "remote"
            ? config.publicChannels.map((channel) => ({
                  id: channel.id || "",
                  models: channel.models || [],
                  modelCapabilities: channel.modelCapabilities,
              }))
            : normalizeLocalChannels(config);
    const channelForCapability = (requested: ModelCapability) => {
        const preferredChannelID = requested === "image" ? config.imageChannelId : requested === "video" ? config.videoChannelId : requested === "audio" ? config.audioChannelId : config.textChannelId;
        const preferred = channels.find((channel) => channel.id === preferredChannelID && channel.models.includes(config.model) && modelMatchesCapability(config.model, requested, channel));
        if (preferred?.id) return preferred.id;
        return channels.find((channel) => channel.models.includes(config.model) && modelMatchesCapability(config.model, requested, channel))?.id || "";
    };
    if (capability) return channelForCapability(capability);
    for (const requested of [
        ["image", config.imageChannelId],
        ["video", config.videoChannelId],
        ["audio", config.audioChannelId],
        ["text", config.textChannelId],
    ] as const) {
        const channelID = channelForCapability(requested[0]);
        if (channelID) return channelID;
    }
    if (config.activeChannelId) return config.activeChannelId;
    if (config.model === config.videoModel) return config.videoChannelId;
    if (config.model === config.textModel) return config.textChannelId;
    if (config.model === config.audioModel) return config.audioChannelId;
    return config.imageChannelId;
}

export function localChannelForActiveModel(config: AiConfig, capability?: ModelCapability) {
    const channels = normalizeLocalChannels(config);
    const preferredId = channelIdForActiveModel(config, capability);
    const matching = channels.filter((channel) => channel.models.includes(config.model) && (!capability || modelMatchesCapability(config.model, capability, channel)));
    return matching.find((channel) => channel.id === preferredId) || matching[0] || (capability ? undefined : channels.find((channel) => channel.id === preferredId) || channels[0]);
}

export type DirectAIProvider = "kie" | "apimart";

const directAIProviderCache = new Map<string, DirectAIProvider | null>();

export function directAIProviderForConfig(config: AiConfig, capability?: ModelCapability): DirectAIProvider | null {
    const channel = localChannelForActiveModel(config, capability);
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
