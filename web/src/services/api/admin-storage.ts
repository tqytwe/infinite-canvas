export type AdminStorageSnapshot = {
    filesystem: { total_bytes: number | null; used_bytes: number | null; free_bytes: number | null };
    media_pool: { indexed_bytes: number; max_bytes: number; cleanup_threshold_bytes: number; reserve_bytes: number; available_bytes: number; object_count: number };
    temporary: { files: number; bytes: number };
    orphan: { files: number; bytes: number };
    quarantine: { files: number; bytes: number };
    users: Array<{ user_id: number; bytes: number; object_count: number; state_count: number }>;
    policy: { unreferenced_retention_hours: number; temporary_retention_hours: number; referenced_files_auto_delete: boolean };
};

export type AdminStorageObject = { storage_key: string; user_id: number; bytes: number; pinned: boolean; reclaimable: boolean; references: Array<{ user_id: string; domain: string; path: string; storage_key: string }> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", ...(init?.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `ADMIN_STORAGE_${response.status}`);
    return payload as T;
}

export const fetchAdminStorageStatus = () => request<AdminStorageSnapshot & { ok: true }>("/api/admin/storage");
export const fetchAdminStorageObjects = () => request<{ ok: true; items: AdminStorageObject[]; total: number }>("/api/admin/storage/objects?page=1&page_size=100");
export const reconcileAdminStorage = () => request("/api/admin/storage/reconcile", { method: "POST", body: "{}" });
export const reclaimAdminStorage = () => request("/api/admin/storage/reclaim", { method: "POST", body: "{}" });
export const purgeAdminStorageQuarantine = () => request("/api/admin/storage/quarantine/purge", { method: "POST", body: JSON.stringify({ confirm: true }) });
export const deleteAdminStorageObject = (storageKey: string, userId: number) => request(`/api/admin/storage/objects/${encodeURIComponent(storageKey)}?user_id=${userId}`, { method: "DELETE" });
