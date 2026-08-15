type BundledPromptLoader = () => Promise<unknown>;

const bundledPromptLoaders: Record<string, BundledPromptLoader> = {
    "banana-prompt-quicker": () => import("@/data/prompts/image/banana-prompt-quicker.json").then((module) => module.default),
    "davidwu-gpt-image2-prompts": () => import("@/data/prompts/image/davidwu-gpt-image2-prompts.json").then((module) => module.default),
    "freestylefly-gpt-image-2": () => import("@/data/prompts/image/freestylefly-gpt-image-2.json").then((module) => module.default),
    "awesome-gpt-image": () => import("@/data/prompts/image/awesome-gpt-image.json").then((module) => module.default),
    "awesome-gpt4o-image-prompts": () => import("@/data/prompts/image/awesome-gpt4o-image-prompts.json").then((module) => module.default),
    "youmind-gpt-image-2": () => import("@/data/prompts/image/youmind-gpt-image-2.json").then((module) => module.default),
    "youmind-nano-banana-pro": () => import("@/data/prompts/image/youmind-nano-banana-pro.json").then((module) => module.default),
    "image-zh-CN": () => import("@/data/prompts/image.zh-CN.json").then((module) => module.default),
    "video-zh-CN": () => import("@/data/prompts/video.zh-CN.json").then((module) => module.default),
    "canvas-zh-CN": () => import("@/data/prompts/canvas.zh-CN.json").then((module) => module.default),
};

export function hasBundledPromptSource(sourceId: string) {
    return Boolean(bundledPromptLoaders[sourceId]);
}

export async function loadBundledPromptSource(sourceId: string) {
    const loader = bundledPromptLoaders[sourceId];
    if (!loader) throw new Error(`Unknown bundled prompt source: ${sourceId}`);
    return loader();
}
