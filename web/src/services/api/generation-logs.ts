import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export async function fetchVideoGenerationLogs<T>(token?: string) {
    return apiGet<T[]>("/api/storage/generation-logs/videos", undefined, token);
}

export async function saveVideoGenerationLogs<T>(token: string | undefined, logs: T[]) {
    return apiPost<T[]>("/api/storage/generation-logs/videos", { logs }, token);
}

export async function deleteVideoGenerationLog(token: string | undefined, id: string) {
    return apiDelete<{ deleted: boolean }>(`/api/storage/generation-logs/videos/${encodeURIComponent(id)}`, token);
}

export async function deleteVideoGenerationLogs(token: string | undefined, ids: string[]) {
    return apiPost<{ deleted: boolean }>("/api/storage/generation-logs/videos/delete", { ids }, token);
}

export async function fetchImageGenerationLogs<T>(token?: string) {
    return apiGet<T[]>("/api/storage/generation-logs/images", undefined, token);
}

export async function saveImageGenerationLogs<T>(token: string | undefined, logs: T[]) {
    return apiPost<T[]>("/api/storage/generation-logs/images", { logs }, token);
}

export async function deleteImageGenerationLogs(token: string | undefined, ids: string[]) {
    return apiPost<{ deleted: boolean }>("/api/storage/generation-logs/images/delete", { ids }, token);
}
