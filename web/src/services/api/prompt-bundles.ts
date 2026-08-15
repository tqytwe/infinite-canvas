import type { RawPrompt } from "./prompt-source-runtime";
import type { PromptLocalBundleKey } from "./prompt-source-presets";

const localBundles: Record<PromptLocalBundleKey, () => Promise<{ default: RawPrompt[] }>> = {
    "image.zh-CN": () => import("@/data/prompts/image.zh-CN.json"),
    "video.zh-CN": () => import("@/data/prompts/video.zh-CN.json"),
    "canvas.zh-CN": () => import("@/data/prompts/canvas.zh-CN.json"),
};

export async function loadLocalPromptBundle(bundle: PromptLocalBundleKey | undefined) {
    const loader = bundle ? localBundles[bundle] : undefined;
    if (!loader) return [];
    const module = await loader();
    return module.default;
}
