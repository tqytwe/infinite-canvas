import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { readImageMeta } from "@/lib/image-utils";
import { canCanvasWrite, deleteCloudObject, getCloudObject, isCanvasAuthenticated, isCanvasManagedMode, putCloudObject, requireCanvasWriteAccess } from "@/services/canvas-cloud";

export type UploadedImage = {
    url: string;
    sourceUrl?: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    cloudStatus?: "stored" | "pending";
    cloudError?: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();
const CLOUD_SAVE_WAIT_MS = 30_000; // large images (2-10 MB) need > 3 s to upload

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    console.log("[Canvas] uploadImage called:", { 
    console.log("[Canvas] uploadImage version: 2024-08-16-v3 - supports relative paths");
        inputType: typeof input, 
        isString: typeof input === "string",
        startsWithData: typeof input === "string" ? input.startsWith("data:") : false,
        isManaged: isCanvasManagedMode(),
        first50: typeof input === "string" ? input.substring(0, 50) : "Blob"
    });
    if (isCanvasManagedMode()) await requireCanvasWriteAccess();
    const storageKey = `image:${nanoid()}`;
    
    // For managed mode with URL input: server-side ingest (intranet → disk, fast & reliable)
    // But data URLs and relative paths must be converted to Blob first (server ingest only supports full CDN URLs)
    console.log("[Canvas] Checking ingest branch:", {
        isManaged: isCanvasManagedMode(),
        isString: typeof input === "string",
        notDataUrl: typeof input === "string" && !input.startsWith("data:"),
        notRelativePath: typeof input === "string" && !input.startsWith("/"),
        willUseIngest: isCanvasManagedMode() && typeof input === "string" && !input.startsWith("data:") && !input.startsWith("/")
    });
    if (isCanvasManagedMode() && typeof input === "string" && !input.startsWith("data:") && !input.startsWith("/")) {
        console.log("[Canvas] Using server-side ingest for:", typeof input === "string" ? input.substring(0, 100) : input);
        const response = await fetch("/api/storage/ingest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: input, storageKey }),
        });
        const result: { ok: boolean; storage_key?: string; bytes?: number; mime_type?: string; error?: string } = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "Server-side ingest failed");
        
        // Fetch back from server to populate local IndexedDB cache
        const blob = await (await fetch(`/api/storage/objects/${encodeURIComponent(storageKey)}`)).blob();
        await store.setItem(storageKey, blob);
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        const meta = await readImageMeta(url);
        const sourceUrl = !input.startsWith("data:") && !input.startsWith("blob:") ? input : undefined;
        return { url, sourceUrl, storageKey, width: meta.width, height: meta.height, bytes: result.bytes || blob.size, mimeType: result.mime_type || blob.type || meta.mimeType, cloudStatus: "stored" };
    }
    
    // For Blob input or non-managed mode: original client-side upload path
    console.log("[Canvas] Using client-side Blob upload path");
    const blob = typeof input === "string" ? await readBlobResponse(await fetchWithTimeout(input, 5 * 60_000)) : input;
    await store.setItem(storageKey, blob);
    const cloud = await putCloudObjectBestEffort(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    const sourceUrl = typeof input === "string" && !input.startsWith("data:") && !input.startsWith("blob:") ? input : undefined;
    return { url, sourceUrl, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType, cloudStatus: cloud.cloudStatus, ...(cloud.cloudError ? { cloudError: cloud.cloudError } : {}) };
}

// Deduplicates concurrent resolves for the same key (same image in multiple nodes).
const resolveImageInflight = new Map<string, Promise<string>>();

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isCanvasManagedMode() && !isCanvasAuthenticated()) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const existing = resolveImageInflight.get(storageKey);
    if (existing) return existing.then((url) => url || fallback);
    const promise = (async () => {
        const localBlob = await store.getItem<Blob>(storageKey);
        const blob = localBlob || (await getCloudObject(storageKey));
        if (!blob) return fallback;
        if (!localBlob && isCanvasManagedMode()) await store.setItem(storageKey, blob);
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        return url;
    })().finally(() => resolveImageInflight.delete(storageKey));
    resolveImageInflight.set(storageKey, promise);
    return promise;
}

/** Warm the local blob cache for multiple images in parallel (max 6 concurrent).
 *  Call this after loading canvas state so images appear without sequential waterfall. */
export async function prefetchImages(keys: string[]): Promise<void> {
    const CONCURRENCY = 6;
    const unique = [...new Set(keys.filter(Boolean))].filter((k) => !objectUrls.has(k));
    for (let i = 0; i < unique.length; i += CONCURRENCY) {
        await Promise.all(unique.slice(i, i + CONCURRENCY).map((k) => resolveImageUrl(k).catch(() => undefined)));
    }
}

export async function getImageBlob(storageKey: string) {
    if (isCanvasManagedMode() && !isCanvasAuthenticated()) return null;
    const localBlob = await store.getItem<Blob>(storageKey);
    if (localBlob) return localBlob;
    const cloudBlob = await getCloudObject(storageKey);
    if (cloudBlob) await store.setItem(storageKey, cloudBlob);
    return cloudBlob;
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (isCanvasManagedMode()) await requireCanvasWriteAccess();
    await store.setItem(storageKey, blob);
    if (isCanvasManagedMode()) await putCloudObject(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
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
                    console.warn("[canvas-cloud] image delete failed", key, error);
                }
            }
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
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

async function putCloudObjectBestEffort(storageKey: string, blob: Blob): Promise<Pick<UploadedImage, "cloudStatus" | "cloudError">> {
    if (!isCanvasManagedMode()) return {};
    const upload = putCloudObject(storageKey, blob)
        .then(() => ({ cloudStatus: "stored" as const }))
        .catch((error) => {
            console.warn("[canvas-cloud] image upload pending", storageKey, error);
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
