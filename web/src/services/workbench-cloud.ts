import { getCanvasSession, getCloudState, isCanvasManagedMode, putCloudState } from "@/services/canvas-cloud";

type WorkbenchState<T> = {
    version: 1;
    items: T[];
};

type WorkbenchLog = { id?: string };
const writeQueues = new Map<string, Promise<void>>();

export async function readCloudWorkbenchLogs<T>(domain: "image-workbench" | "video-workbench") {
    if (!isCanvasManagedMode()) return null;
    const session = await getCanvasSession();
    if (!session.authenticated) return null;
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
    if (!isCanvasManagedMode()) return;
    const session = await getCanvasSession();
    if (!session.authenticated) return;
    const state: WorkbenchState<T> = { version: 1, items };
    await putCloudState(domain, JSON.stringify(state));
}

export async function upsertCloudWorkbenchLog<T extends WorkbenchLog>(domain: "image-workbench" | "video-workbench", log: T, fallback: T[] = []) {
    if (!isCanvasManagedMode()) return;
    const session = await getCanvasSession();
    if (!session.authenticated) return;
    await enqueueWorkbenchWrite(domain, async () => {
        const existing = (await readCloudWorkbenchLogs<T>(domain)) || fallback;
        await writeCloudWorkbenchLogs(domain, [...existing.filter((item) => item.id !== log.id), log]);
    });
}

export async function replaceCloudWorkbenchLogs<T>(domain: "image-workbench" | "video-workbench", items: T[]) {
    if (!isCanvasManagedMode()) return;
    const session = await getCanvasSession();
    if (!session.authenticated) return;
    await enqueueWorkbenchWrite(domain, () => writeCloudWorkbenchLogs(domain, items));
}

async function enqueueWorkbenchWrite(domain: string, operation: () => Promise<void>) {
    const previous = writeQueues.get(domain) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    writeQueues.set(domain, next);
    try {
        await next;
    } finally {
        if (writeQueues.get(domain) === next) writeQueues.delete(domain);
    }
}
