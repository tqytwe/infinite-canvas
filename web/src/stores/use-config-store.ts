import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { isCanvasAuthenticated, isCanvasManagedMode, useCanvasSessionStore } from "@/services/canvas-cloud";

export type ApiCallFormat = "openai" | "gemini" | "ark";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    displayName?: string;
    platform?: string;
    useCase?: string;
    toolCapabilities?: Record<string, unknown>;
    imageCapabilities?: Record<string, unknown> | boolean;
};

export type ModelChannel = {
    id: string;
    name: string;
    groupId?: number;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo", "agnes"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) || config.channels.find((item) => item.models.some((model) => model.name === name)) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const normalizedCurrent = normalizeModelOptionValue(currentModel, config.channels);
    const normalizedDefault = normalizeModelOptionValue(defaultModel, config.channels);
    if (normalizedCurrent && modelMatchesCapability(config, normalizedCurrent, capability)) return normalizedCurrent;
    if (normalizedDefault && modelMatchesCapability(config, normalizedDefault, capability)) return normalizedDefault;
    return selectableModelsByCapability(config, capability)[0] || fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (isCanvasManagedMode() && !isCanvasAuthenticated()) return false;
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const session = useCanvasSessionStore((state) => state.session);
    return useMemo(() => {
        if (!isCanvasManagedMode()) return { ...config, channelMode: "local" as const };
        if (session?.authenticated && session.models) return applyManagedWorkspaceConfig(config, session.models);
        return {
            ...config,
            channelMode: "remote" as const,
            baseUrl: "",
            apiKey: "",
            channels: [],
            models: [],
            model: "",
            imageModel: "",
            videoModel: "",
            textModel: "",
            audioModel: "",
        };
    }, [config, session?.authenticated, session?.models]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        if (typeof item === "string") {
            result.push({ name, capability, script });
            continue;
        }
        result.push({
            name,
            capability,
            script,
            displayName: item.displayName?.trim() || undefined,
            platform: item.platform?.trim() || undefined,
            useCase: item.useCase?.trim() || undefined,
            toolCapabilities: item.toolCapabilities,
            imageCapabilities: item.imageCapabilities,
        });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) {
        const matched = config.channels.flatMap((channel) => channel.models).find((model) => model.name === value);
        return matched?.displayName || value;
    }
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const model = channel?.models.find((item) => item.name === decoded.model);
    const label = model?.displayName || decoded.model;
    return channel ? `${label}（${channel.name}）` : label;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        if (channel && channel.models.some((item) => item.name === decoded.model)) return model;
        return normalizeModelOptionValue(decoded.model, channels);
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    if (isCanvasManagedMode() && !isCanvasAuthenticated()) {
        return {
            ...config,
            model: modelOptionName(value || config.model),
            baseUrl: "",
            apiKey: "",
            apiFormat: channel.apiFormat,
        };
    }
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "ark") return ARK_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "ark" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

export function managedWorkspaceConfig(models: unknown): Partial<AiConfig> {
    const channels = collectManagedChannels(models);
    const options = modelOptionsFromChannels(channels);
    const modelFor = (capability: ModelCapability) => {
        for (const channel of channels) {
            const model = channel.models.find((item) => item.capability === capability);
            if (model) return encodeChannelModel(channel.id, model.name);
        }
        return "";
    };
    return {
        channelMode: "remote",
        baseUrl: "/api/platform/gateway",
        apiKey: "managed-session",
        apiFormat: "openai",
        channels,
        models: options,
        model: modelFor("text") || modelFor("image") || modelFor("video") || modelFor("audio") || options[0] || "",
        imageModel: modelFor("image"),
        videoModel: modelFor("video"),
        textModel: modelFor("text"),
        audioModel: modelFor("audio"),
    };
}

export function applyManagedWorkspaceConfig(config: AiConfig, models: unknown): AiConfig {
    const managed = managedWorkspaceConfig(models);
    const next = { ...config, ...managed, channelMode: "remote" as const } as AiConfig;
    const imageModel = pickManagedCapabilityModel(next, config.imageModel || config.model, "image", managed.imageModel);
    const videoModel = pickManagedCapabilityModel(next, config.videoModel || config.model, "video", managed.videoModel);
    const textModel = pickManagedCapabilityModel(next, config.textModel || config.model, "text", managed.textModel);
    const audioModel = pickManagedCapabilityModel(next, config.audioModel || config.model, "audio", managed.audioModel);
    const model = pickManagedModel(next.models, config.model, managed.model) || textModel || imageModel || videoModel || audioModel;
    return { ...next, model, imageModel, videoModel, textModel, audioModel };
}

function pickManagedCapabilityModel(config: AiConfig, current: string | undefined, capability: ModelCapability, fallback: string | undefined) {
    const options = selectableModelsByCapability(config, capability);
    return pickManagedModel(options, current, fallback) || "";
}

function pickManagedModel(options: string[], current: string | undefined, fallback: string | undefined) {
    return matchingModelOption(options, current) || matchingModelOption(options, fallback) || options[0] || "";
}

function matchingModelOption(options: string[], value: string | undefined) {
    const model = (value || "").trim();
    if (!model) return "";
    if (options.includes(model)) return model;
    const name = modelOptionName(model);
    return options.find((option) => modelOptionName(option) === name) || "";
}

function collectManagedChannels(value: unknown): ModelChannel[] {
    const groups = value && typeof value === "object" && "groups" in value && Array.isArray(value.groups) ? value.groups : [];
    return groups
        .map((group, index) => createManagedChannel(group, index))
        .filter((channel): channel is ModelChannel => Boolean(channel?.models.length));
}

function createManagedChannel(group: unknown, index: number): ModelChannel | null {
    const groupRecord = group && typeof group === "object" ? (group as Record<string, unknown>) : {};
    const entries = Array.isArray(groupRecord.models) ? groupRecord.models : [];
    const models = collectManagedModels(entries);
    if (!models.length) return null;
    const rawId = stringValue(groupRecord.id) || stringValue(groupRecord.key) || stringValue(groupRecord.name) || stringValue(groupRecord.platform) || String(index + 1);
    const name = stringValue(groupRecord.name) || stringValue(groupRecord.display_name) || stringValue(groupRecord.platform) || i18n.t("config.channels.indexedName", { index: index + 1 });
    return {
        id: `managed-${sanitizeChannelId(rawId, index)}-${index + 1}`,
        name,
        groupId: Number.isSafeInteger(Number(groupRecord.id)) && Number(groupRecord.id) > 0 ? Number(groupRecord.id) : undefined,
        baseUrl: "/api/platform/gateway",
        apiKey: "managed-session",
        apiFormat: "openai",
        models,
    };
}

function collectManagedModels(entries: unknown[]): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const name = stringValue(record.name) || stringValue(record.id);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const displayName = stringValue(record.display_name) || stringValue(record.displayName);
        const platform = stringValue(record.platform);
        const useCase = stringValue(record.use_case || record.useCase).toLowerCase();
        const toolCapabilities = record.tool_capabilities && typeof record.tool_capabilities === "object" ? (record.tool_capabilities as Record<string, unknown>) : undefined;
        const imageCapabilities = typeof record.image_capabilities === "boolean" || (record.image_capabilities && typeof record.image_capabilities === "object") ? (record.image_capabilities as Record<string, unknown> | boolean) : undefined;
        result.push({
            name,
            displayName: displayName || undefined,
            platform: platform || undefined,
            useCase: useCase || undefined,
            toolCapabilities,
            imageCapabilities,
            capability: managedModelCapability({ name, useCase, imageCapabilities }),
        });
    }
    return result;
}

function sanitizeChannelId(value: string, index: number) {
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || String(index + 1)
    );
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function managedModelCapability(model: { name: string; useCase: string; imageCapabilities?: Record<string, unknown> | boolean }): ModelCapability {
    if (hasImageStudioOperation(model.imageCapabilities, "create")) return "image";
    if (["image", "image_studio", "image-studio", "vision-image"].includes(model.useCase)) return "image";
    if (["video", "video_generation", "video-generation"].includes(model.useCase)) return "video";
    if (["audio", "audio_generation", "audio-generation", "tts", "speech"].includes(model.useCase)) return "audio";
    if (["text", "chat", "code", "reasoning", "general"].includes(model.useCase)) return "text";
    return guessCapability(model.name);
}

function hasImageStudioOperation(imageCapabilities: Record<string, unknown> | boolean | undefined, operation: "create" | "edit") {
    if (imageCapabilities === true) return operation === "create";
    if (!imageCapabilities || typeof imageCapabilities !== "object") return false;
    const operations = Array.isArray(imageCapabilities.operations) ? imageCapabilities.operations : [];
    return operations.some((item) => {
        const value = String(item || "")
            .trim()
            .toLowerCase();
        return value === operation || (operation === "create" && value === "generate");
    });
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
