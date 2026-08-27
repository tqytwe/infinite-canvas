import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { apiGet, apiPost } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

export async function listCanvasProjects(token?: string) {
    return apiGet<CanvasProject[]>("/api/storage/canvas/projects", undefined, token);
}

export async function saveCanvasProject(token: string | undefined, project: CanvasProject) {
    return apiPost<CanvasProject>("/api/storage/canvas/projects", { data: project }, token);
}

export async function syncCanvasProjects(token: string | undefined, projects: CanvasProject[]) {
    return apiPost<CanvasProject[]>("/api/storage/canvas/projects/sync", { projects }, token);
}

export async function deleteCanvasTasks(sourceId: string, nodeIds: string[] = []) {
    const token = useUserStore.getState().token;
    const source = sourceId.trim();
    if (!token || !source) return;
    return apiPost<{ deleted: boolean }>(
        "/api/v1/canvas/tasks/delete",
        {
            source_id: source,
            node_ids: Array.from(new Set(nodeIds.map((id) => id.trim()).filter(Boolean))),
        },
        token,
    );
}

export async function deleteCanvasProjects(ids: string[]) {
    const projectIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!projectIds.length) return;
    return apiPost<{ deleted: boolean }>("/api/storage/canvas/projects/delete", { ids: projectIds }, useUserStore.getState().token);
}
