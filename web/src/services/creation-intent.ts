export type ImagePromptHandoff = {
    prompt_id: number;
    version?: number;
    title?: string;
    prompt_text: string;
    models?: string[];
    sizes?: string[];
};

const imagePromptHandoffKey = "jisudeng:creation:image-prompt";

function unwrap<T>(value: unknown): T {
    if (value && typeof value === "object" && "data" in value) return (value as { data: T }).data;
    return value as T;
}

export async function consumeImagePromptHandoff(promptId: number): Promise<ImagePromptHandoff> {
    const response = await fetch(`/api/platform/image-prompts/${encodeURIComponent(String(promptId))}/use`, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((payload as { error?: string; message?: string }).error || (payload as { message?: string }).message || "IMAGE_PROMPT_HANDOFF_FAILED");
    const handoff = unwrap<ImagePromptHandoff>(payload);
    if (!Number.isSafeInteger(Number(handoff?.prompt_id)) || !String(handoff?.prompt_text || "").trim()) throw new Error("IMAGE_PROMPT_HANDOFF_INVALID");
    return handoff;
}

export function storeImagePromptHandoff(handoff: ImagePromptHandoff) {
    sessionStorage.setItem(imagePromptHandoffKey, JSON.stringify(handoff));
}

export function takeImagePromptHandoff(): ImagePromptHandoff | null {
    const raw = sessionStorage.getItem(imagePromptHandoffKey);
    sessionStorage.removeItem(imagePromptHandoffKey);
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as ImagePromptHandoff;
        return Number.isSafeInteger(Number(value?.prompt_id)) && typeof value?.prompt_text === "string" ? value : null;
    } catch {
        return null;
    }
}
