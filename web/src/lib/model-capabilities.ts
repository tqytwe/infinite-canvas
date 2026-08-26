export type ModelCapability = "image" | "video" | "text" | "audio";
export type ModelCapabilities = Record<string, ModelCapability[]>;
export type ModelDiscoveryMode = "declared" | "legacy";

export type ModelDiscoveryResult = {
    models: string[];
    modelCapabilities: ModelCapabilities;
    declaredModelIds: string[];
    mode: ModelDiscoveryMode;
};

export type ModelCapabilitySource = {
    modelCapabilities?: ModelCapabilities;
    declaredModelIds?: string[];
};

export type ModelDiscoveryState = ModelDiscoveryMode | "error";

export type ModelDiscoveryChannel = {
    models: string[];
    modelCapabilities?: ModelCapabilities;
    declaredModelIds?: string[];
    modelDiscovery?: {
        state: ModelDiscoveryState;
        message?: string;
    };
};

const exactLegacyCapabilities: Record<string, ModelCapability[]> = {
    "sensenova-u1.5-lite": ["image"],
    "sensenova-u1-fast": ["image"],
};

const capabilityAliases: Record<string, ModelCapability> = {
    image: "image",
    images: "image",
    image_generation: "image",
    "image-generation": "image",
    image_edit: "image",
    "image-edit": "image",
    video: "video",
    videos: "video",
    video_generation: "video",
    "video-generation": "video",
    text: "text",
    chat: "text",
    completion: "text",
    completions: "text",
    responses: "text",
    audio: "audio",
    speech: "audio",
    tts: "audio",
};

export function parseModelDiscovery(payload: unknown): ModelDiscoveryResult {
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const discovered = new Map<string, { present: boolean; capabilities: ModelCapability[] }>();
    for (const item of data) {
        if (!isRecord(item)) continue;
        const id = stringValue(item.id);
        if (!id) continue;
        const declared = readDeclaredCapabilities(item);
        const previous = discovered.get(id);
        discovered.set(id, {
            present: previous?.present === true || declared.present,
            capabilities: declared.present ? uniqueCapabilities([...(previous?.capabilities || []), ...declared.capabilities]) : previous?.capabilities || [],
        });
    }

    const modelCapabilities: ModelCapabilities = {};
    const models = Array.from(discovered.keys()).sort((a, b) => a.localeCompare(b));
    const declaredModelIds = models.filter((id) => discovered.get(id)?.present);
    const hasDeclarations = declaredModelIds.length > 0;
    for (const id of models) {
        const declared = discovered.get(id);
        modelCapabilities[id] = hasDeclarations ? (declared?.present ? declared.capabilities : []) : legacyModelCapabilities(id);
    }

    return {
        models,
        modelCapabilities,
        declaredModelIds,
        mode: hasDeclarations ? "declared" : "legacy",
    };
}

export function legacyModelDiscovery(models: string[]): ModelDiscoveryResult {
    const normalized = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return {
        models: normalized,
        modelCapabilities: Object.fromEntries(normalized.map((model) => [model, legacyModelCapabilities(model)])),
        declaredModelIds: [],
        mode: "legacy",
    };
}

export function modelMatchesCapability(model: string, capability?: ModelCapability, source?: ModelCapabilitySource) {
    if (!capability) return true;
    const modelId = model.trim();
    const declaredModelIds = source?.declaredModelIds || [];
    const capabilities = source?.modelCapabilities;
    if (declaredModelIds.length) return capabilities?.[modelId]?.includes(capability) === true;
    if (capabilities && Object.prototype.hasOwnProperty.call(capabilities, modelId)) return capabilities[modelId].includes(capability);
    return legacyModelCapabilities(modelId).includes(capability);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability, source?: ModelCapabilitySource) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability, source)) : models;
}

export function legacyModelCapabilities(model: string): ModelCapability[] {
    const value = model.trim().toLowerCase();
    const exact = exactLegacyCapabilities[value];
    if (exact) return [...exact];
    if (isVideoModelName(value)) return ["video"];
    if (isImageModelName(value)) return ["image"];
    if (isAudioModelName(value)) return ["audio"];
    return ["text"];
}

export function modelDiscoveryFailure<T extends ModelDiscoveryChannel>(channel: T, message: string) {
    return {
        channel: {
            ...channel,
            modelDiscovery: { state: "error", message },
        } as T,
        error: true,
    };
}

export function applyModelDiscovery<T extends ModelDiscoveryChannel>(channel: T, discovery: ModelDiscoveryResult) {
    if (!discovery.models.length) return modelDiscoveryFailure(channel, "接口没有返回可用模型，已保留原模型");
    return {
        channel: {
            ...channel,
            models: discovery.models,
            modelCapabilities: discovery.modelCapabilities,
            declaredModelIds: discovery.declaredModelIds,
            modelDiscovery: { state: discovery.mode },
        } as T,
        error: false,
    };
}

function readDeclaredCapabilities(model: Record<string, unknown>) {
    let present = false;
    const capabilities: ModelCapability[] = [];
    const add = (value: ModelCapability | undefined) => {
        if (value && !capabilities.includes(value)) capabilities.push(value);
    };
    const read = (value: unknown) => {
        for (const capability of readCapabilityValues(value)) add(capability);
    };
    const readFeature = (value: unknown, capability: ModelCapability) => {
        if (featureEnabled(value)) add(capability);
    };

    for (const key of ["capabilities", "modalities"] as const) {
        if (!Object.prototype.hasOwnProperty.call(model, key)) continue;
        present = true;
        read(model[key]);
    }
    for (const [key, capability] of [
        ["image_capabilities", "image"],
        ["video_capabilities", "video"],
    ] as const) {
        if (!Object.prototype.hasOwnProperty.call(model, key)) continue;
        present = true;
        readFeature(model[key], capability);
    }

    return { present, capabilities };
}

function uniqueCapabilities(capabilities: ModelCapability[]) {
    return capabilities.filter((capability, index) => capabilities.indexOf(capability) === index);
}

function readCapabilityValues(value: unknown): ModelCapability[] {
    if (typeof value === "string") return [capabilityAliases[value.trim().toLowerCase()]].filter((item): item is ModelCapability => Boolean(item));
    if (Array.isArray(value)) return value.flatMap(readCapabilityValues);
    if (!isRecord(value)) return [];

    const capabilities: ModelCapability[] = [];
    const add = (capability: ModelCapability | undefined) => {
        if (capability && !capabilities.includes(capability)) capabilities.push(capability);
    };
    for (const key of ["capabilities", "modalities"] as const) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            for (const capability of readCapabilityValues(value[key])) add(capability);
        }
    }
    for (const [key, capability] of [
        ["image", "image"],
        ["video", "video"],
        ["text", "text"],
        ["audio", "audio"],
        ["image_capabilities", "image"],
        ["video_capabilities", "video"],
    ] as const) {
        if (Object.prototype.hasOwnProperty.call(value, key) && featureEnabled(value[key])) add(capability);
    }
    return capabilities;
}

function featureEnabled(value: unknown) {
    if (value === true) return true;
    if (!value) return false;
    if (typeof value === "string") return !["false", "0", "none", "unsupported", "disabled"].includes(value.trim().toLowerCase());
    if (Array.isArray(value)) return value.some(featureEnabled);
    if (!isRecord(value)) return false;
    for (const key of ["enabled", "supported", "available"] as const) {
        if (typeof value[key] === "boolean") return value[key] === true;
    }
    return Object.values(value).some(featureEnabled);
}

function isVideoModelName(value: string) {
    const normalized = value.replace(/[._/]+/g, "-");
    return (
        value.includes("video") ||
        value.includes("seedance") ||
        normalized === "sd2-5" ||
        normalized === "sd-2-5" ||
        value.includes("sora") ||
        value.includes("veo") ||
        value.includes("kling") ||
        value.includes("hailuo") ||
        normalized === "minimax-h3" ||
        (value.includes("minimax") && (value.includes("video") || value.includes("text-to-video") || value.includes("image-to-video"))) ||
        normalized === "manxue2-5" ||
        normalized === "manxue-2-5" ||
        value.includes("skyreels") ||
        value.includes("happyhorse") ||
        value.includes("runway") ||
        value.includes("aleph") ||
        value.includes("vidu") ||
        value.includes("pixverse") ||
        value.includes("omni-flash") ||
        value.includes("gemini-omni-video") ||
        value.includes("veo3.1") ||
        value.includes("veo-3.1") ||
        value.includes("infinitalk") ||
        value.includes("wan2-5") ||
        value.includes("wan2.5") ||
        value.includes("wan2-6") ||
        value.includes("wan2.6") ||
        value.includes("wan2-7") ||
        value.includes("wan2.7") ||
        value.includes("wan2-7-r2v") ||
        value.includes("wan2.7-r2v") ||
        value.includes("wan2-7-videoedit") ||
        value.includes("wan2.7-videoedit") ||
        value.includes("wan/2-5") ||
        value.includes("wan/2-6") ||
        value.includes("wan/2-7-text-to-video") ||
        value.includes("wan/2-7-image-to-video") ||
        value.includes("wan/2-7-videoedit") ||
        value.includes("wan/2-7-r2v") ||
        (value.includes("grok-imagine") && (value.includes("/upscale") || value.includes("/extend")))
    );
}

function isImageModelName(value: string) {
    return (
        !isVideoModelName(value) &&
        !isAudioModelName(value) &&
        (value.includes("image") ||
            value.includes("nano-banana") ||
            value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("cogview") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("gemini-2.5-flash") ||
            value.includes("gemini-3-pro") ||
            value.includes("gemini-3.1-flash") ||
            value.includes("flux") ||
            value.includes("kontext") ||
            value.includes("4o-image") ||
            value.includes("4o image") ||
            value.includes("gpt-4o-image") ||
            value.includes("z-image") ||
            value.includes("qwen/image") ||
            value.includes("qwen2/image") ||
            value.includes("qwen/text-to-image") ||
            value.includes("qwen2/text-to-image") ||
            value.includes("ideogram") ||
            value.includes("recraft") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney") ||
            value.includes("wan2-7-image") ||
            value.includes("wan2.7-image") ||
            value.includes("wan/2-7-image") ||
            value.includes("topaz/image") ||
            value.includes("gemini-omni-character") ||
            (value.includes("grok-imagine") && !value.includes("video")))
    );
}

function isAudioModelName(value: string) {
    return (
        value.includes("audio") ||
        value.includes("tts") ||
        value.includes("speech") ||
        value.includes("voice") ||
        value.includes("music") ||
        value.includes("sound") ||
        value.includes("elevenlabs") ||
        value.includes("suno") ||
        value.includes("lyrics") ||
        value.includes("vocal") ||
        value.includes("midi") ||
        value.includes("wav")
    );
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
