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

export type PlatformManagedChannel = {
    id: string;
    name: string;
    protocol: "openai";
    baseUrl: "/api";
    apiKey: "";
    models: string[];
    modelCapabilities: ModelCapabilities;
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
            const groupID = positiveID(group.id);
            if (!groupID) continue;
            const capabilities: ModelCapabilities = {};
            const models = uniqueStrings(group.models)
                .map((model) => ({ id: modelID(model), capabilities: platformWorkspaceModelCapabilities(model, purpose) }))
                .filter((model) => Boolean(model.id) && model.capabilities.includes(purposeCapability[purpose]));
            if (!models.length) continue;
            for (const model of models) capabilities[model.id] = model.capabilities;
            channels.push({
                id: `platform-managed:${purpose}:${groupID}`,
                name: stringValue(group.name) || `极速蹬 ${purpose}`,
                protocol: "openai",
                baseUrl: "/api",
                apiKey: "",
                models: models.map((model) => model.id),
                modelCapabilities: capabilities,
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

    const models = groups.flatMap((group) => uniqueStrings(group.models));
    if (!models.length) return `当前${capabilityLabel(capability)}分组没有可调度模型，请检查分组、映射和权限`;
    if (!models.some(platformModelHasCapabilityDeclaration)) {
        return `服务端未声明模型${capabilityLabel(capability)}能力，请升级服务端后重试`;
    }
    if (!models.some((model) => platformModelCapabilities(model).includes(capability))) {
        return `当前分组没有可用的${capabilityLabel(capability)}模型，请检查能力声明和适配器`;
    }
    if ((purpose === "image" || purpose === "video") && !models.some((model) => platformModelDeclaresModality(model, purpose) && platformModelSupportsCanonicalOperation(model, purpose))) {
        return `服务端未声明模型${capabilityLabel(capability)}可执行操作，请升级服务端后重试`;
    }
    if ((purpose === "image" || purpose === "video") && !models.some(platformModelHasExecutableAdapter)) {
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
    if ((purpose === "image" || purpose === "video") && (!capabilities.includes(purpose) || !platformModelDeclaresModality(model, purpose) || !platformModelSupportsCanonicalOperation(model, purpose) || !platformModelHasExecutableAdapter(model))) {
        return [];
    }
    return capabilities;
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

function workspaceGroups(workspace: PlatformWorkspace | undefined): PlatformWorkspaceGroup[] {
    return Array.isArray(workspace?.groups) ? (workspace.groups.filter(isRecord) as PlatformWorkspaceGroup[]) : [];
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
