import { apiGet, apiPost } from "@/services/api/request";

export async function createStorageSession(baseUrl: string, apiKey: string) {
    return apiPost<{ storage_ready: boolean }>("/api/auth/storage-session", { baseUrl, apiKey });
}

export async function getStorageSessionStatus() {
    return apiGet<{ storage_ready: boolean }>("/api/auth/storage-session");
}
