import type { ModelCapabilities, ModelCapability } from "./model-capabilities";

export type PlatformModel = {
    id?: unknown;
    name?: unknown;
    display_name?: unknown;
    modalities?: unknown;
    capabilities?: unknown;
    image_capabilities?: unknown;
    video_capabilities?: unknown;
};

export type PlatformWorkspaceGroup = {
    id?: unknown;
    name?: unknown;
    is_current?: unknown;
    // A false value is an authoritative server-side decision. Canvas must not
    // surface an otherwise well-shaped video model from that group.
    video_available?: unknown;
    video_unavailable_code?: unknown;
    models?: unknown;
};

export type PlatformWorkspace = {
    groups?: unknown;
};

export type PlatformManagedBootstrap = {
    workspaces?: Partial<Record<PlatformMediaPurpose, PlatformWorkspace>>;
    compatibility?: {
        state?: string;
        unavailable_purposes?: string[];
        message?: string;
    };
};

export type PlatformMediaPurpose = "chat" | "image" | "video";

// These types mirror the transport-safe media contract returned by the
// platform. They are intentionally separate from ModelCapabilities: the
// latter answers only "which picker should show this model", while this
// contract governs the concrete controls and request payload we may send.
export type PlatformImageMediaCapabilities = {
    operations: string[];
    sizingKind?: string;
    supportedSizes: string[];
    supportedRatios: string[];
    supportedFormats: string[];
    minDimension?: number;
    maxDimension?: number;
    dimensionStep?: number;
    maxAspectRatio?: number;
    maxReferenceImages?: number;
};

export type PlatformVideoMediaCapabilities = {
    operations: string[];
    supportedResolutions: string[];
    supportedRatios: string[];
    supportedDurations: number[];
    maxReferenceAssets?: number;
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    maxReferenceAudios?: number;
    generateAudio?: boolean;
    watermark?: boolean;
};

export type PlatformManagedModelMediaCapabilities = {
    adapter: string;
    capabilityVersion: string;
    modalities: ModelCapability[];
    image?: PlatformImageMediaCapabilities;
    video?: PlatformVideoMediaCapabilities;
};

export type PlatformManagedChannel = {
    id: string;
    name: string;
    protocol: "openai";
    baseUrl: "/api";
    apiKey: "";
    models: string[];
    modelCapabilities: ModelCapabilities;
    modelMediaCapabilities: Record<string, PlatformManagedModelMediaCapabilities>;
    declaredModelIds: string[];
    managedPlatform: true;
    platformPurpose: PlatformMediaPurpose;
    platformGroupID: string;
    isCurrent: boolean;
};

const purposeCapability: Record<PlatformMediaPurpose, ModelCapability> = {
    chat: "text",
    image: "image",
    video: "video",
};

const canonicalMediaOperations: Record<Exclude<PlatformMediaPurpose, "chat">, readonly string[]> = {
    image: ["create", "edit"],
    video: ["generate"],
};

const capabilityAliases: Record<string, ModelCapability> = {
    chat: "text",
    text: "text",
    completion: "text",
    completions: "text",
    response: "text",
    responses: "text",
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
    audio: "audio",
    speech: "audio",
    tts: "audio",
};

export function platformManagedChannels(bootstrap: PlatformManagedBootstrap | null | undefined): PlatformManagedChannel[] {
    const channels: PlatformManagedChannel[] = [];
    for (const purpose of ["chat", "image", "video"] as const) {
        const groups = workspaceGroups(bootstrap?.workspaces?.[purpose]);
        for (const group of groups) {
            if (purpose === "video" && group.video_available === false) continue;
            const groupID = positiveID(group.id);
            if (!groupID) continue;
            const capabilities: ModelCapabilities = {};
            const modelMediaCapabilities: Record<string, PlatformManagedModelMediaCapabilities> = {};
            const models = uniqueStrings(group.models)
                .map((model) => ({ id: modelID(model), capabilities: platformWorkspaceModelCapabilities(model, purpose), mediaCapabilities: platformWorkspaceModelMediaCapabilities(model, purpose) }))
                .filter((model) => Boolean(model.id) && model.capabilities.includes(purposeCapability[purpose]));
            if (!models.length) continue;
            for (const model of models) {
                capabilities[model.id] = model.capabilities;
                if (model.mediaCapabilities) modelMediaCapabilities[model.id] = model.mediaCapabilities;
            }
            channels.push({
                id: `platform-managed:${purpose}:${groupID}`,
                name: stringValue(group.name) || `极速蹬 ${purpose}`,
                protocol: "openai",
                baseUrl: "/api",
                apiKey: "",
                models: models.map((model) => model.id),
                modelCapabilities: capabilities,
                modelMediaCapabilities,
                declaredModelIds: models.map((model) => model.id),
                managedPlatform: true,
                platformPurpose: purpose,
                platformGroupID: groupID,
                isCurrent: group.is_current === true,
            });
        }
    }
    return channels;
}

// A managed Canvas must not fall back to a model-name heuristic when the
// platform has not supplied a media contract. Keep the reason available to the
// UI so an empty picker remains actionable instead of looking like an empty
// group.
export function platformManagedCapabilityIssue(bootstrap: PlatformManagedBootstrap | null | undefined, capability: ModelCapability) {
    if (!bootstrap) return "创作能力正在加载，请稍后重试";

    const purpose: PlatformMediaPurpose = capability === "image" || capability === "video" ? capability : "chat";
    const compatibility = bootstrap.compatibility;
    if (compatibility?.unavailable_purposes?.includes(purpose)) {
        return compatibility.message || `服务端尚未提供${capabilityLabel(capability)}会话，请重新进入 AI 创作空间后重试`;
    }

    const groups = workspaceGroups(bootstrap.workspaces?.[purpose]);
    if (!groups.length) return `服务端没有返回可用的${capabilityLabel(capability)}分组，请稍后重试`;

    // Older platform responses do not include video_available, so only an
    // explicit false value changes behavior. Reuse the same filtered groups as
    // platformManagedChannels to keep the empty-state reason truthful.
    const availableGroups = purpose === "video" ? groups.filter((group) => group.video_available !== false) : groups;
    if (!availableGroups.length) return platformVideoUnavailableMessage(groups);

    const models = availableGroups.flatMap((group) => uniqueStrings(group.models));
    if (!models.length) return `当前${capabilityLabel(capability)}分组没有可调度模型，请检查分组、映射和权限`;
    if (!models.some(platformModelHasCapabilityDeclaration)) {
        return `服务端未声明模型${capabilityLabel(capability)}能力，请升级服务端后重试`;
    }
    if (!models.some((model) => platformModelCapabilities(model).includes(capability))) {
        return `当前分组没有可用的${capabilityLabel(capability)}模型，请检查能力声明和适配器`;
    }
    const supportsPurposeOperation = (model: PlatformModel) => (purpose === "image" || purpose === "video") && platformModelDeclaresModality(model, purpose) && platformModelSupportsCanonicalOperation(model, purpose);
    if ((purpose === "image" || purpose === "video") && !models.some(supportsPurposeOperation)) {
        return `服务端未声明模型${capabilityLabel(capability)}可执行操作，请升级服务端后重试`;
    }
    if ((purpose === "image" || purpose === "video") && !models.some((model) => supportsPurposeOperation(model) && platformModelHasExecutableAdapter(model))) {
        return `服务端未声明模型${capabilityLabel(capability)}可执行适配器，请升级服务端后重试`;
    }
    return "";
}

export function platformModelCapabilities(model: PlatformModel): ModelCapability[] {
    const capabilities = new Set<ModelCapability>();
    for (const value of capabilityValues(model.modalities)) capabilities.add(value);
    for (const value of capabilityValues(model.capabilities)) capabilities.add(value);
    if (featureEnabled(model.image_capabilities)) capabilities.add("image");
    if (featureEnabled(model.video_capabilities)) capabilities.add("video");
    return Array.from(capabilities);
}

function platformWorkspaceModelCapabilities(model: PlatformModel, purpose: PlatformMediaPurpose): ModelCapability[] {
    const capabilities = platformModelCapabilities(model);
    // Legacy model lists predate the media contract. Their placement in the
    // server-owned chat workspace is sufficient only for text chat; images and
    // videos always require explicit per-model declarations.
    if (purpose === "chat" && capabilities.length === 0 && !platformModelHasCapabilityDeclaration(model)) {
        return ["text"];
    }
    if (purpose === "chat") {
        return capabilities.includes("text") ? ["text"] : [];
    }
    return platformWorkspaceModelMediaCapabilities(model, purpose) ? [purposeCapability[purpose]] : [];
}

function platformWorkspaceModelMediaCapabilities(model: PlatformModel, purpose: PlatformMediaPurpose): PlatformManagedModelMediaCapabilities | undefined {
    if (purpose === "chat" || !platformModelDeclaresModality(model, purpose) || !platformModelHasExecutableAdapter(model)) return undefined;
    const adapter = stringValue((model as Record<string, unknown>).adapter);
    const capabilityVersion = stringValue((model as Record<string, unknown>).capability_version);
    if (!adapter || !capabilityVersion) return undefined;

    if (purpose === "image") {
        const image = parsePlatformImageMediaCapabilities(model.image_capabilities);
        if (!image || !image.operations.some((operation) => canonicalMediaOperations.image.includes(operation))) return undefined;
        return { adapter, capabilityVersion, modalities: ["image"], image };
    }

    const video = parsePlatformVideoMediaCapabilities(model.video_capabilities);
    if (!video || !video.operations.some((operation) => canonicalMediaOperations.video.includes(operation))) return undefined;
    return { adapter, capabilityVersion, modalities: ["video"], video };
}

function platformModelDeclaresModality(model: PlatformModel, purpose: Exclude<PlatformMediaPurpose, "chat">): boolean {
    return capabilityValues(model.modalities).includes(purpose);
}

function platformModelSupportsCanonicalOperation(model: PlatformModel, purpose: Exclude<PlatformMediaPurpose, "chat">): boolean {
    const capabilities = purpose === "image" ? model.image_capabilities : model.video_capabilities;
    if (!isRecord(capabilities) || !Array.isArray(capabilities.operations)) return false;
    const allowed = canonicalMediaOperations[purpose];
    return capabilities.operations.some((operation) => typeof operation === "string" && allowed.includes(operation.trim().toLowerCase()));
}

function parsePlatformImageMediaCapabilities(value: unknown): PlatformImageMediaCapabilities | undefined {
    if (!isRecord(value)) return undefined;
    const sizingKind = stringValue(value.sizing_kind);
    const minDimension = positiveInteger(value.min_dimension);
    const maxDimension = positiveInteger(value.max_dimension);
    const dimensionStep = positiveInteger(value.dimension_step);
    const maxAspectRatio = positiveNumber(value.max_aspect_ratio);
    const maxReferenceImages = nonNegativeInteger(value.max_reference_images);
    return {
        operations: contractStrings(value.operations),
        supportedSizes: contractStrings(value.supported_sizes),
        supportedRatios: contractStrings(value.supported_ratios),
        supportedFormats: contractStrings(value.supported_formats),
        ...(sizingKind ? { sizingKind } : {}),
        ...(minDimension !== undefined ? { minDimension } : {}),
        ...(maxDimension !== undefined ? { maxDimension } : {}),
        ...(dimensionStep !== undefined ? { dimensionStep } : {}),
        ...(maxAspectRatio !== undefined ? { maxAspectRatio } : {}),
        ...(maxReferenceImages !== undefined ? { maxReferenceImages } : {}),
    };
}

function parsePlatformVideoMediaCapabilities(value: unknown): PlatformVideoMediaCapabilities | undefined {
    if (!isRecord(value)) return undefined;
    const maxReferenceAssets = nonNegativeInteger(value.max_reference_assets);
    const maxReferenceImages = nonNegativeInteger(value.max_reference_images);
    const maxReferenceVideos = nonNegativeInteger(value.max_reference_videos);
    const maxReferenceAudios = nonNegativeInteger(value.max_reference_audios);
    const generateAudio = optionalBoolean(value.generate_audio);
    const watermark = optionalBoolean(value.watermark);
    return {
        operations: contractStrings(value.operations),
        supportedResolutions: contractStrings(value.supported_resolutions),
        supportedRatios: contractStrings(value.supported_ratios),
        supportedDurations: contractNumbers(value.supported_durations),
        ...(maxReferenceAssets !== undefined ? { maxReferenceAssets } : {}),
        ...(maxReferenceImages !== undefined ? { maxReferenceImages } : {}),
        ...(maxReferenceVideos !== undefined ? { maxReferenceVideos } : {}),
        ...(maxReferenceAudios !== undefined ? { maxReferenceAudios } : {}),
        ...(generateAudio !== undefined ? { generateAudio } : {}),
        ...(watermark !== undefined ? { watermark } : {}),
    };
}

function platformModelHasExecutableAdapter(model: PlatformModel): boolean {
    const values = model as Record<string, unknown>;
    return stringValue(values.adapter) !== "" && stringValue(values.capability_version) !== "";
}

export function platformManagedChannelForCapability(channels: PlatformManagedChannel[], capability: ModelCapability, preferredID = "") {
    return (
        channels.find((channel) => channel.id === preferredID && channel.models.some((model) => channel.modelCapabilities[model]?.includes(capability))) ||
        channels.find((channel) => channel.isCurrent && channel.models.some((model) => channel.modelCapabilities[model]?.includes(capability))) ||
        channels.find((channel) => channel.models.some((model) => channel.modelCapabilities[model]?.includes(capability)))
    );
}

export function platformImageSupportsOperation(capabilities: PlatformImageMediaCapabilities | undefined, operation: "create" | "edit") {
    return Boolean(capabilities?.operations.includes(operation));
}

export function platformVideoSupportsOperation(capabilities: PlatformVideoMediaCapabilities | undefined, operation = "generate") {
    return Boolean(capabilities?.operations.includes(operation));
}

export function platformAspectRatio(value: string): string {
    const normalized = value.trim().toLowerCase();
    const ratio = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
    const dimensions = normalized.match(/^(\d+)\s*x\s*(\d+)$/);
    const parts = ratio || dimensions;
    if (!parts) return "";
    const width = Number(parts[1]);
    const height = Number(parts[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

export function platformImageSupportsSize(capabilities: PlatformImageMediaCapabilities | undefined, value: string) {
    if (!capabilities) return true;
    const size = value.trim().toLowerCase();
    const hasSizingConstraint = Boolean(capabilities.supportedSizes.length || capabilities.supportedRatios.length || capabilities.minDimension || capabilities.maxDimension || capabilities.dimensionStep || capabilities.maxAspectRatio);
    if (!size || size === "auto") return !hasSizingConstraint;
    if (capabilities.supportedSizes.length && !capabilities.supportedSizes.some((candidate) => candidate.toLowerCase() === size)) return false;
    const ratio = platformAspectRatio(size);
    if (capabilities.supportedRatios.length && (!ratio || !capabilities.supportedRatios.some((candidate) => platformAspectRatio(candidate) === ratio))) return false;
    const dimensions = parsePlatformDimensions(size);
    if (!dimensions) return !capabilities.minDimension && !capabilities.maxDimension && !capabilities.dimensionStep && !capabilities.maxAspectRatio;
    const { width, height } = dimensions;
    if (capabilities.minDimension && (width < capabilities.minDimension || height < capabilities.minDimension)) return false;
    if (capabilities.maxDimension && (width > capabilities.maxDimension || height > capabilities.maxDimension)) return false;
    if (capabilities.dimensionStep && (width % capabilities.dimensionStep !== 0 || height % capabilities.dimensionStep !== 0)) return false;
    if (capabilities.maxAspectRatio && Math.max(width / height, height / width) > capabilities.maxAspectRatio) return false;
    return true;
}

export function platformVideoSupportsResolution(capabilities: PlatformVideoMediaCapabilities | undefined, value: string) {
    if (!capabilities || !capabilities.supportedResolutions.length) return true;
    const expected = normalizePlatformVideoResolution(value);
    return capabilities.supportedResolutions.some((candidate) => normalizePlatformVideoResolution(candidate) === expected);
}

export function platformVideoSupportsRatio(capabilities: PlatformVideoMediaCapabilities | undefined, value: string) {
    if (!capabilities || !capabilities.supportedRatios.length) return true;
    const expected = platformAspectRatio(value);
    return Boolean(expected) && capabilities.supportedRatios.some((candidate) => platformAspectRatio(candidate) === expected);
}

export function platformVideoSupportsDuration(capabilities: PlatformVideoMediaCapabilities | undefined, value: number) {
    if (!capabilities || !capabilities.supportedDurations.length) return true;
    return capabilities.supportedDurations.includes(value);
}

export function platformImageRequestIssue(capabilities: PlatformImageMediaCapabilities | undefined, { operation, size, referenceImages }: { operation: "create" | "edit"; size: string; referenceImages: number }) {
    if (!capabilities) return "";
    if (!platformImageSupportsOperation(capabilities, operation)) return operation === "edit" ? "当前模型未声明图片编辑能力，不能使用参考图" : "当前模型未声明图片生成功能";
    if (referenceImages > 0 && capabilities.maxReferenceImages === 0) return "当前模型不支持参考图";
    if (capabilities.maxReferenceImages !== undefined && referenceImages > capabilities.maxReferenceImages) return `当前模型最多支持 ${capabilities.maxReferenceImages} 张参考图`;
    if (!platformImageSupportsSize(capabilities, size)) return "当前模型不支持所选图片尺寸或宽高比";
    return "";
}

export function platformVideoRequestIssue(
    capabilities: PlatformVideoMediaCapabilities | undefined,
    {
        operation = "generate",
        resolution,
        ratio,
        duration,
        imageReferences,
        videoReferences,
        audioReferences,
        generateAudio,
        watermark,
    }: {
        operation?: string;
        resolution: string;
        ratio: string;
        duration: number;
        imageReferences: number;
        videoReferences: number;
        audioReferences: number;
        generateAudio: boolean;
        watermark: boolean;
    },
) {
    if (!capabilities) return "";
    if (!platformVideoSupportsOperation(capabilities, operation)) return "当前模型未声明视频生成功能";
    if (!platformVideoSupportsResolution(capabilities, resolution)) return "当前模型不支持所选视频分辨率";
    if (!platformVideoSupportsRatio(capabilities, ratio)) return "当前模型不支持所选视频宽高比";
    if (!platformVideoSupportsDuration(capabilities, duration)) return "当前模型不支持所选视频时长";
    if (capabilities.maxReferenceImages !== undefined && imageReferences > capabilities.maxReferenceImages) return `当前模型最多支持 ${capabilities.maxReferenceImages} 张参考图`;
    if (capabilities.maxReferenceVideos !== undefined && videoReferences > capabilities.maxReferenceVideos) return `当前模型最多支持 ${capabilities.maxReferenceVideos} 个参考视频`;
    if (capabilities.maxReferenceAudios !== undefined && audioReferences > capabilities.maxReferenceAudios) return `当前模型最多支持 ${capabilities.maxReferenceAudios} 个参考音频`;
    const references = imageReferences + videoReferences + audioReferences;
    if (capabilities.maxReferenceAssets !== undefined && references > capabilities.maxReferenceAssets) return `当前模型最多支持 ${capabilities.maxReferenceAssets} 个参考素材`;
    if (generateAudio && capabilities.generateAudio !== true) return "当前模型不支持生成音频";
    if (watermark && capabilities.watermark !== true) return "当前模型不支持水印参数";
    return "";
}

function workspaceGroups(workspace: PlatformWorkspace | undefined): PlatformWorkspaceGroup[] {
    return Array.isArray(workspace?.groups) ? (workspace.groups.filter(isRecord) as PlatformWorkspaceGroup[]) : [];
}

function platformVideoUnavailableMessage(groups: PlatformWorkspaceGroup[]) {
    const code = groups
        .map((group) => stringValue(group.video_unavailable_code).toLowerCase())
        .find(Boolean);
    switch (code) {
        case "not_mapped":
            return "当前视频分组尚未完成模型映射，请稍后重试";
        case "capability_not_declared":
            return "当前视频分组尚未声明可执行的视频能力，请稍后重试";
        case "price_missing":
            return "当前视频分组暂未完成价格配置，请稍后重试";
        case "adapter_unsupported":
            return "当前视频分组暂不支持所选视频能力，请稍后重试";
        case "no_schedulable_account":
            return "当前视频分组暂时没有可用账号，请稍后重试";
        case "group_permission_denied":
            return "当前账号暂无该视频分组权限，请稍后重试";
        case "subscription_reservation_unsupported":
            return "当前视频分组暂不支持此计费方式，请稍后重试";
        default:
            return "当前视频分组暂不可用，请稍后重试";
    }
}

function platformModelHasCapabilityDeclaration(model: PlatformModel) {
    return ["modalities", "capabilities", "image_capabilities", "video_capabilities"].some((key) => Object.prototype.hasOwnProperty.call(model, key));
}

function capabilityLabel(capability: ModelCapability) {
    switch (capability) {
        case "image":
            return "图片";
        case "video":
            return "视频";
        case "audio":
            return "音频";
        default:
            return "文本";
    }
}

function uniqueStrings(value: unknown): PlatformModel[] {
    return Array.isArray(value) ? (value.filter(isRecord) as PlatformModel[]) : [];
}

function modelID(model: PlatformModel) {
    return stringValue(model.id) || stringValue(model.name);
}

function positiveID(value: unknown) {
    const id = String(value ?? "").trim();
    return /^\d+$/.test(id) && Number(id) > 0 ? id : "";
}

function contractStrings(value: unknown) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => stringValue(item).toLowerCase()).filter(Boolean)));
}

function contractNumbers(value: unknown) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(positiveInteger).filter((item): item is number => item !== undefined)));
}

function positiveInteger(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
    return Number.isInteger(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
    return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function positiveNumber(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
}

function greatestCommonDivisor(a: number, b: number) {
    let left = Math.round(Math.abs(a));
    let right = Math.round(Math.abs(b));
    while (right) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }
    return left || 1;
}

function parsePlatformDimensions(value: string) {
    const match = value.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

function normalizePlatformVideoResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return "";
    if (/^\d+$/.test(normalized)) return `${normalized}p`;
    return normalized;
}

function capabilityValues(value: unknown): ModelCapability[] {
    if (typeof value === "string") {
        const mapped = capabilityAliases[value.trim().toLowerCase()];
        return mapped ? [mapped] : [];
    }
    if (Array.isArray(value)) return value.flatMap(capabilityValues);
    if (!isRecord(value)) return [];
    const result: ModelCapability[] = [];
    for (const key of ["modalities", "capabilities"] as const) {
        for (const capability of capabilityValues(value[key])) {
            if (!result.includes(capability)) result.push(capability);
        }
    }
    for (const [key, capability] of Object.entries(capabilityAliases)) {
        if (featureEnabled(value[key]) && !result.includes(capability)) result.push(capability);
    }
    return result;
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

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
