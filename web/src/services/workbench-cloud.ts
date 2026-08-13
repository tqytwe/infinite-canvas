import { getCloudState, isCanvasAuthenticated, isCanvasManagedMode, putCloudState } from "@/services/canvas-cloud";

type WorkbenchState<T> = {
    version: 1;
    items: T[];
};

export async function readCloudWorkbenchLogs<T>(domain: "image-workbench" | "video-workbench") {
    if (!isCanvasManagedMode() || !isCanvasAuthenticated()) return null;
    const value = await getCloudState(domain);
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as WorkbenchState<T> | T[];
        return Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
        return [];
    }
}

export async function writeCloudWorkbenchLogs<T>(domain: "image-workbench" | "video-workbench", items: T[]) {
    if (!isCanvasManagedMode() || !isCanvasAuthenticated()) return;
    const state: WorkbenchState<T> = { version: 1, items };
    await putCloudState(domain, JSON.stringify(state));
}
