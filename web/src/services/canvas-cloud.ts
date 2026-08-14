import { CANVAS_MANAGED_MODE, CANVAS_PLATFORM_WEB_URL } from "@/constant/runtime-config";
import { create } from "zustand";

export type CanvasCloudUser = {
    id: number | string;
    username?: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
    role?: string;
    is_admin?: boolean;
};

export type CanvasCloudSession = {
    authenticated: boolean;
    user?: CanvasCloudUser;
    models?: unknown;
    api_key_id?: number;
    expires_at?: string;
    login_url?: string;
    register_url?: string;
};

export type CloudUsage = {
    used_bytes: number;
    max_bytes: number;
    available_bytes: number;
    object_count: number;
    state_count: number;
};

let sessionPromise: Promise<CanvasCloudSession> | null = null;
let session: CanvasCloudSession | null = null;
let sessionRequestId = 0;
const CLOUD_STATE_TIMEOUT_MS = 60_000;
const CLOUD_OBJECT_TIMEOUT_MS = 10 * 60_000;

type CanvasSessionStore = {
    session: CanvasCloudSession | null;
    loading: boolean;
    usage: CloudUsage | null;
    refresh: (force?: boolean) => Promise<CanvasCloudSession>;
    refreshUsage: () => Promise<CloudUsage | null>;
};

export const useCanvasSessionStore = create<CanvasSessionStore>((set) => ({
    session: null,
    loading: CANVAS_MANAGED_MODE,
    usage: null,
    refresh: async (force = false) => {
        set({ loading: true });
        try {
            const nextSession = await getCanvasSession(force);
            set({ session: nextSession });
            return nextSession;
        } finally {
            set({ loading: false });
        }
    },
    refreshUsage: async () => {
        const nextUsage = await getCloudUsage();
        set({ usage: nextUsage });
        return nextUsage;
    },
}));

export function isCanvasManagedMode() {
    return CANVAS_MANAGED_MODE;
}

export function isCanvasAuthenticated() {
    return !CANVAS_MANAGED_MODE || session?.authenticated === true;
}

export function canCanvasWrite() {
    return isCanvasAuthenticated();
}

export function isCanvasAdminSession(value: CanvasCloudSession | null | undefined = session) {
    if (!value?.authenticated) return false;
    const role = String(value.user?.role || "").trim().toLowerCase();
    if (role === "admin") return true;
    return value.user?.is_admin === true;
}

export function useCanvasCanWrite() {
    const current = useCanvasSessionStore((state) => state.session);
    return !CANVAS_MANAGED_MODE || current?.authenticated === true;
}

export async function getCanvasSession(force = false): Promise<CanvasCloudSession> {
    if (!CANVAS_MANAGED_MODE) return { authenticated: true };
    if (session && !force) return session;
    if (sessionPromise && !force) return sessionPromise;
    const requestId = ++sessionRequestId;
    let request: Promise<CanvasCloudSession>;
    request = fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
            const value = (await response.json().catch(() => ({}))) as CanvasCloudSession;
            if (!response.ok) throw new Error("CANVAS_SESSION_FAILED");
            // A launch-token exchange can supersede an anonymous request that
            // was already in flight during the initial render. Let that
            // request observe the current result instead of restoring stale
            // anonymous state after authentication succeeds.
            if (requestId !== sessionRequestId) {
                if (sessionPromise && sessionPromise !== request) return sessionPromise;
                return session || value;
            }
            session = value;
            useCanvasSessionStore.setState({ session: value });
            return value;
        })
        .finally(() => {
            if (sessionPromise === request) sessionPromise = null;
        });
    sessionPromise = request;
    return request;
}

export function currentCanvasSession() {
    return session;
}

export async function exchangeCanvasLaunchToken(token: string) {
    const response = await fetch("/api/auth/exchange", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ launch_token: token }),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || "CANVAS_AUTH_EXCHANGE_FAILED");
    sessionRequestId += 1;
    session = null;
    useCanvasSessionStore.setState({ session: null, loading: true });
    return getCanvasSession(true);
}

export async function logoutCanvasSession() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    session = { authenticated: false };
    useCanvasSessionStore.setState({ session, usage: null });
}

export function canvasLoginUrl() {
    return session?.login_url || `${CANVAS_PLATFORM_WEB_URL}/login?redirect=${encodeURIComponent("/ai-creation-space")}`;
}

export function canvasRegisterUrl() {
    return session?.register_url || `${CANVAS_PLATFORM_WEB_URL}/register?redirect=${encodeURIComponent("/ai-creation-space")}`;
}

export async function requireCanvasWriteAccess() {
    const value = await getCanvasSession();
    if (CANVAS_MANAGED_MODE && !value.authenticated) throw new Error("CANVAS_AUTH_REQUIRED");
    return value;
}

export async function getCloudState(domain: string) {
    if (!CANVAS_MANAGED_MODE) return null;
    const value = await getCanvasSession();
    if (!value.authenticated) return null;
    const response = await cloudFetch(`/api/storage/state/${encodeURIComponent(domain)}`, { credentials: "same-origin", cache: "no-store" }, CLOUD_STATE_TIMEOUT_MS);
    if (response.status === 401) return null;
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "CANVAS_STATE_READ_FAILED");
    const payload = (await response.json()) as { state?: string | null };
    return typeof payload.state === "string" ? payload.state : null;
}

export async function putCloudState(domain: string, state: string) {
    if (!CANVAS_MANAGED_MODE) return null;
    await requireCanvasWriteAccess();
    const response = await cloudFetch(`/api/storage/state/${encodeURIComponent(domain)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: state,
    }, CLOUD_STATE_TIMEOUT_MS);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "CANVAS_STATE_WRITE_FAILED");
    return response.json() as Promise<CloudUsage & { ok: boolean }>;
}

export async function putCloudObject(storageKey: string, blob: Blob) {
    if (!CANVAS_MANAGED_MODE) return;
    await requireCanvasWriteAccess();
    const response = await cloudFetch(`/api/storage/objects/${encodeURIComponent(storageKey)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": blob.type || "application/octet-stream" },
        body: blob,
    }, CLOUD_OBJECT_TIMEOUT_MS);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "CANVAS_OBJECT_WRITE_FAILED");
}

export async function getCloudObject(storageKey: string) {
    if (!CANVAS_MANAGED_MODE) return null;
    if (!isCanvasAuthenticated()) return null;
    const response = await cloudFetch(`/api/storage/objects/${encodeURIComponent(storageKey)}`, { credentials: "same-origin", cache: "no-store" }, CLOUD_OBJECT_TIMEOUT_MS);
    if (!response.ok) return null;
    return response.blob();
}

export async function deleteCloudObject(storageKey: string) {
    if (!CANVAS_MANAGED_MODE) return;
    const response = await fetch(`/api/storage/objects/${encodeURIComponent(storageKey)}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok && response.status !== 404) throw new Error("CANVAS_OBJECT_DELETE_FAILED");
}

export async function getCloudUsage() {
    if (!CANVAS_MANAGED_MODE) return null;
    if (!isCanvasAuthenticated()) return null;
    const response = await fetch("/api/storage/usage", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as CloudUsage & { ok: boolean };
}

async function cloudFetch(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        window.clearTimeout(timer);
        init.signal?.removeEventListener("abort", onAbort);
    }
}
