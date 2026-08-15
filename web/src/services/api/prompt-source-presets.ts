import { nanoid } from "nanoid";

export type PromptSource = {
    id: string;
    name: string;
    url: string;
    homepage: string;
    enabled: boolean;
    builtIn: boolean;
    mediaType: PromptMediaType;
    format: PromptSourceFormat;
    storage: PromptSourceStorage;
    localBundle?: PromptLocalBundleKey;
};

export type PromptMediaType = "image" | "video" | "canvas" | "all";
export type PromptSourceFormat = "json" | "markdown";
export type PromptSourceStorage = "local" | "remote";
export type PromptLocalBundleKey = "image.zh-CN" | "video.zh-CN" | "canvas.zh-CN";

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "",
        url: source?.url?.trim() || "",
        homepage: source?.homepage?.trim() || "",
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
        mediaType: source?.mediaType || "all",
        format: source?.format || "json",
        storage: source?.storage || "remote",
        localBundle: source?.localBundle,
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    localSource("jisudeng-image-zh", "Jisudeng 生图提示词（中文）", "image", "image.zh-CN", "https://github.com/songguoxs/gpt4o-image-prompts"),
    localSource("jisudeng-video-zh", "Jisudeng 视频提示词（中文）", "video", "video.zh-CN", "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts"),
    localSource("jisudeng-canvas-zh", "Jisudeng 幕布模板（中文）", "canvas", "canvas.zh-CN", ""),
];

function localSource(id: string, name: string, mediaType: Exclude<PromptMediaType, "all">, localBundle: PromptLocalBundleKey, homepage: string): PromptSource {
    return { id, name, url: "", homepage, enabled: true, builtIn: true, mediaType, format: "json", storage: "local", localBundle };
}
