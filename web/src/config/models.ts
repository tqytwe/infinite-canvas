/**
 * Model Management Enhancements
 *
 * Phase 3.1: 模型管理增强
 * - 模型分组（图片/视频/音频）
 * - 快速切换常用模型
 * - 显示模型能力和限制
 */

export interface ModelCapabilities {
    supportsReferenceImage: boolean;
    supportsNegativePrompt: boolean;
    supportsBatchGeneration: boolean;
    supportsVideoGeneration: boolean;
    supportsAudioGeneration: boolean;
    supportsMultimodal: boolean;
    maxResolution: { width: number; height: number };
    maxBatchSize: number;
}

export interface ModelInfo {
    id: string;
    name: string;
    displayName: string;
    category: "image" | "video" | "audio" | "multimodal";
    provider: string;
    description: string;
    capabilities: ModelCapabilities;
    tags: string[];
    isPopular?: boolean;
    isFavorite?: boolean;
}

// 模型定义
export const AVAILABLE_MODELS: ModelInfo[] = [
    // 图片模型
    {
        id: "flux-pro-1.1",
        name: "flux-pro-1.1",
        displayName: "FLUX Pro 1.1",
        category: "image",
        provider: "Black Forest Labs",
        description: "最新FLUX专业版，图像质量和提示词理解能力最强",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: true,
            supportsBatchGeneration: true,
            supportsVideoGeneration: false,
            supportsAudioGeneration: false,
            supportsMultimodal: false,
            maxResolution: { width: 2048, height: 2048 },
            maxBatchSize: 4,
        },
        tags: ["高质量", "快速", "推荐"],
        isPopular: true,
    },
    {
        id: "flux-dev",
        name: "flux-dev",
        displayName: "FLUX Dev",
        category: "image",
        provider: "Black Forest Labs",
        description: "FLUX开发版，平衡质量和速度",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: true,
            supportsBatchGeneration: true,
            supportsVideoGeneration: false,
            supportsAudioGeneration: false,
            supportsMultimodal: false,
            maxResolution: { width: 2048, height: 2048 },
            maxBatchSize: 4,
        },
        tags: ["平衡", "推荐"],
        isPopular: true,
    },
    {
        id: "sd-3.5-large",
        name: "sd-3.5-large",
        displayName: "Stable Diffusion 3.5 Large",
        category: "image",
        provider: "Stability AI",
        description: "SD 3.5大模型，高质量图像生成",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: true,
            supportsBatchGeneration: true,
            supportsVideoGeneration: false,
            supportsAudioGeneration: false,
            supportsMultimodal: false,
            maxResolution: { width: 1536, height: 1536 },
            maxBatchSize: 4,
        },
        tags: ["稳定", "开源"],
    },
    {
        id: "agnes",
        name: "agnes",
        displayName: "Agnes",
        category: "image",
        provider: "Custom",
        description: "定制图像模型",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: false,
            supportsBatchGeneration: false, // 不支持n参数
            supportsVideoGeneration: false,
            supportsAudioGeneration: false,
            supportsMultimodal: false,
            maxResolution: { width: 1024, height: 1024 },
            maxBatchSize: 1,
        },
        tags: ["定制"],
    },

    // 视频模型
    {
        id: "kling-v1.5",
        name: "kling-v1.5",
        displayName: "可灵 v1.5",
        category: "video",
        provider: "快手",
        description: "可灵视频生成模型，支持图转视频",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: false,
            supportsBatchGeneration: false,
            supportsVideoGeneration: true,
            supportsAudioGeneration: false,
            supportsMultimodal: false,
            maxResolution: { width: 1280, height: 720 },
            maxBatchSize: 1,
        },
        tags: ["视频", "推荐"],
        isPopular: true,
    },
    {
        id: "runway-gen3",
        name: "runway-gen3",
        displayName: "Runway Gen-3",
        category: "video",
        provider: "Runway",
        description: "Runway第三代视频生成模型",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: false,
            supportsBatchGeneration: false,
            supportsVideoGeneration: true,
            supportsAudioGeneration: false,
            supportsMultimodal: false,
            maxResolution: { width: 1280, height: 768 },
            maxBatchSize: 1,
        },
        tags: ["视频", "高质量"],
        isPopular: true,
    },

    // 多模态模型
    {
        id: "seedance",
        name: "seedance",
        displayName: "Seedance",
        category: "multimodal",
        provider: "ByteDance",
        description: "多模态生成模型，支持图片+音频+视频组合参考",
        capabilities: {
            supportsReferenceImage: true,
            supportsNegativePrompt: false,
            supportsBatchGeneration: false,
            supportsVideoGeneration: true,
            supportsAudioGeneration: true,
            supportsMultimodal: true,
            maxResolution: { width: 1280, height: 720 },
            maxBatchSize: 1,
        },
        tags: ["多模态", "音频", "视频"],
    },
];

/**
 * 按分类获取模型
 */
export function getModelsByCategory(category: ModelInfo["category"]): ModelInfo[] {
    return AVAILABLE_MODELS.filter((m) => m.category === category);
}

/**
 * 获取热门模型
 */
export function getPopularModels(): ModelInfo[] {
    return AVAILABLE_MODELS.filter((m) => m.isPopular);
}

/**
 * 根据ID获取模型信息
 */
export function getModelById(id: string): ModelInfo | undefined {
    return AVAILABLE_MODELS.find((m) => m.id === id);
}

/**
 * 检查模型是否支持某功能
 */
export function checkModelCapability(
    modelId: string,
    capability: keyof ModelCapabilities
): boolean {
    const model = getModelById(modelId);
    return model ? model.capabilities[capability] as boolean : false;
}

/**
 * 获取模型分类标签
 */
export const MODEL_CATEGORIES = [
    { id: "all", label: "全部", icon: "🎨" },
    { id: "image", label: "图片", icon: "🖼️" },
    { id: "video", label: "视频", icon: "🎬" },
    { id: "audio", label: "音频", icon: "🎵" },
    { id: "multimodal", label: "多模态", icon: "✨" },
] as const;
