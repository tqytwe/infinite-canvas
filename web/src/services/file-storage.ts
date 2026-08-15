import localforage from "localforage";
import { nanoid } from "nanoid";
import { canCanvasWrite, deleteCloudObject, getCloudObject, isCanvasAuthenticated, isCanvasManagedMode, putCloudObject, requireCanvasWriteAccess } from "@/services/canvas-cloud";

export type UploadedFile = { url: string; sourceUrl?: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; cloudStatus?: "stored" | "pending"; cloudError?: string };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();
const CLOUD_SAVE_WAIT_MS = 3000;

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    if (isCanvasManagedMode()) await requireCanvasWriteAccess();
    const blob = typeof input === "string" ? await readBlobResponse(await fetchWithTimeout(input, 10 * 60_000)) : input;
    const storageKey = `${prefix}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const cloud = await putCloudObjectBestEffort(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    const sourceUrl = typeof input === "string" && !input.startsWith("data:") && !input.startsWith("blob:") ? input : undefined;
    return { url, sourceUrl, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, cloudStatus: cloud.cloudStatus, ...(cloud.cloudError ? { cloudError: cloud.cloudError } : {}) };
}

// Deduplicates concurrent resolves for the same media key.
const resolveMediaInflight = new Map<string, Promise<string>>();

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isCanvasManagedMode() && !isCanvasAuthenticated()) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const existing = resolveMediaInflight.get(storageKey);
    if (existing) return existing.then((url) => url || fallback);
    const promise = (async () => {
        const localBlob = await store.getItem<Blob>(storageKey);
        const blob = localBlob || (await getCloudObject(storageKey));
        if (!blob) return fallback;
        if (!localBlob && isCanvasManagedMode()) await store.setItem(storageKey, blob);
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        return url;
    })().finally(() => resolveMediaInflight.delete(storageKey));
    resolveMediaInflight.set(storageKey, promise);
    return promise;
}

/** Warm the local blob cache for multiple media files in parallel (max 4 concurrent). */
export async function prefetchMedia(keys: string[]): Promise<void> {
    const CONCURRENCY = 4;
    const unique = [...new Set(keys.filter(Boolean))].filter((k) => !objectUrls.has(k));
    for (let i = 0; i < unique.length; i += CONCURRENCY) {
        await Promise.all(unique.slice(i, i + CONCURRENCY).map((k) => resolveMediaUrl(k).catch(() => undefined)));
    }
}

export async function getMediaBlob(storageKey: string) {
    if (isCanvasManagedMode() && !isCanvasAuthenticated()) return null;
    const localBlob = await store.getItem<Blob>(storageKey);
    if (localBlob) return localBlob;
    const cloudBlob = await getCloudObject(storageKey);
    if (cloudBlob) await store.setItem(storageKey, cloudBlob);
    return cloudBlob;
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (isCanvasManagedMode()) await requireCanvasWriteAccess();
    await store.setItem(storageKey, blob);
    if (isCanvasManagedMode()) await putCloudObject(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
            if (canCanvasWrite()) {
                try {
                    await deleteCloudObject(key);
                } catch (error) {
                    console.warn("[canvas-cloud] media delete failed", key, error);
                }
            }
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredMedia(unused);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

async function fetchWithTimeout(input: RequestInfo | URL, timeoutMs: number) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { credentials: "same-origin", signal: controller.signal });
    } finally {
        window.clearTimeout(timer);
    }
}

async function readBlobResponse(response: Response) {
    if (!response.ok) throw new Error(`MEDIA_FETCH_FAILED_${response.status}`);
    return response.blob();
}

async function putCloudObjectBestEffort(storageKey: string, blob: Blob): Promise<Pick<UploadedFile, "cloudStatus" | "cloudError">> {
    if (!isCanvasManagedMode()) return {};
    const upload = putCloudObject(storageKey, blob)
        .then(() => ({ cloudStatus: "stored" as const }))
        .catch((error) => {
            console.warn("[canvas-cloud] media upload pending", storageKey, error);
            return { cloudStatus: "pending" as const, cloudError: error instanceof Error ? error.message : "CANVAS_OBJECT_WRITE_FAILED" };
        });
    const settled = await Promise.race([upload, delay(CLOUD_SAVE_WAIT_MS).then(() => null)]);
    if (settled) return settled;
    void upload;
    return { cloudStatus: "pending" };
}

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
