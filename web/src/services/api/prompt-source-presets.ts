import { nanoid } from "nanoid";

export type PromptMediaType = "image" | "video" | "canvas";

export type PromptSource = {
    id: string;
    name: string;
    url: string;
    homepage: string;
    mediaType: PromptMediaType;
    bundled: boolean;
    enabled: boolean;
    builtIn: boolean;
};

export const PROMPT_REGISTRY_HOMEPAGE = "https://github.com/yukkcat/image-prompts";
const PROMPT_REGISTRY_SOURCE_BASE = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "",
        url: source?.url?.trim() || "",
        homepage: source?.homepage?.trim() || "",
        mediaType: source?.mediaType || "image",
        bundled: source?.bundled ?? false,
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    registrySource("banana-prompt-quicker", "Banana Prompt Quicker", "https://glidea.github.io/banana-prompt-quicker/"),
    registrySource("davidwu-gpt-image2-prompts", "DavidWu GPT Image 2", "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts"),
    registrySource("freestylefly-gpt-image-2", "Freestylefly GPT Image 2", "https://github.com/freestylefly/awesome-gpt-image-2"),
    registrySource("awesome-gpt-image", "Awesome GPT Image", "https://github.com/ZeroLu/awesome-gpt-image"),
    registrySource("awesome-gpt4o-image-prompts", "Awesome GPT-4o", "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts"),
    registrySource("youmind-gpt-image-2", "YouMind GPT Image 2", "https://github.com/YouMind-OpenLab/awesome-gpt-image-2"),
    registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts"),
    bundledSource("image-zh-CN", "Jisudeng 中文生图", "https://www.jisudeng.com", "image"),
    bundledSource("video-zh-CN", "Jisudeng 中文视频", "https://www.jisudeng.com", "video"),
    bundledSource("canvas-zh-CN", "Jisudeng 中文幕布", "https://www.jisudeng.com", "canvas"),
];

function registrySource(id: string, name: string, homepage: string): PromptSource {
    return { id, name, url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`, homepage, mediaType: "image", bundled: true, enabled: true, builtIn: true };
}

function bundledSource(id: string, name: string, homepage: string, mediaType: PromptMediaType): PromptSource {
    return { id, name, url: "", homepage, mediaType, bundled: true, enabled: true, builtIn: true };
}
