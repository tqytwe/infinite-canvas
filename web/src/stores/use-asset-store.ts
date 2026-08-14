import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { canCanvasWrite, getCanvasSession, getCloudState, isCanvasAuthenticated, isCanvasManagedMode, putCloudState } from "@/services/canvas-cloud";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; sourceUrl?: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; sourceUrl?: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let managedAssetStorageReady = !isCanvasManagedMode();
let managedAssetStateDirty = !isCanvasManagedMode();

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        if (isCanvasManagedMode()) {
            const session = await getCanvasSession();
            if (!session.authenticated) return null;
            const cloudValue = await getCloudState("assets");
            if (cloudValue) {
                await localForageStorage.setItem(name, cloudValue);
                const parsed = JSON.parse(cloudValue) as StorageValue<AssetStore>;
                parsed.state.assets = await hydrateAssets(parsed.state.assets);
                managedAssetStorageReady = true;
                return parsed;
            }
            managedAssetStorageReady = true;
            return null;
        }
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await hydrateAssets(parsed.state.assets);
        return parsed;
    },
    setItem: async (name, value) => {
        if (isCanvasManagedMode() && (!managedAssetStorageReady || !isCanvasAuthenticated())) return;
        const serialized = JSON.stringify(value);
        await localForageStorage.setItem(name, serialized);
        if (isCanvasManagedMode() && managedAssetStateDirty) {
            managedAssetStateDirty = false;
            void putCloudState("assets", serialized).catch((error) => console.warn("[canvas-cloud] asset save failed", error));
        }
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

async function hydrateAssets(assets: Asset[]) {
    return Promise.all(
        assets.map(async (asset) => {
            if (asset.kind === "video" && asset.data.storageKey)
                return {
                    ...asset,
                    data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url?.startsWith("blob:") ? asset.data.sourceUrl || asset.data.url : asset.data.url || asset.data.sourceUrl || "") },
                };
            if (asset.kind !== "image") return asset;
            if (asset.data.storageKey)
                return {
                    ...asset,
                    coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl || asset.data.sourceUrl || asset.coverUrl) : asset.coverUrl,
                    data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl?.startsWith("blob:") ? asset.data.sourceUrl || asset.data.dataUrl : asset.data.dataUrl || asset.data.sourceUrl || "") },
                };
            if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
            const image = await uploadImage(asset.data.dataUrl);
            return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
        }),
    );
}

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                if (!canCanvasWrite()) return "";
                managedAssetStateDirty = true;
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                canCanvasWrite() &&
                ((managedAssetStateDirty = true),
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                }))),
            removeAsset: (id) =>
                canCanvasWrite() &&
                ((managedAssetStateDirty = true),
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                })),
            replaceAssets: (assets) => canCanvasWrite() && ((managedAssetStateDirty = true), set({ assets })),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
