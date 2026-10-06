type StarframeVideoInput = {
    model: string;
    prompt: string;
    clientTaskId: string;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    images?: string[];
    videos?: string[];
    audios?: string[];
    firstFrame?: string;
    lastFrame?: string;
};

function publicReference(value: string) {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const octets = host.split(".").map(Number);
    const privateIPv4 = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
        && (octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168 || octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
    const privateIPv6 = host.includes(":") && (!/^\[[23][0-9a-f]{0,3}:/i.test(host) || host.startsWith("[2001:db8:"));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || privateIPv4 || privateIPv6 || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
        throw new Error("StarFrame references require publicly accessible HTTP URLs");
    }
    return value;
}

export function buildStarframeVideoBody(input: StarframeVideoInput): Record<string, unknown> {
    if (!input.model.trim() || !input.prompt.trim()) throw new Error("StarFrame model and prompt are required");
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(input.clientTaskId)) throw new Error("Invalid StarFrame client_task_id");
    if (input.duration !== undefined && (!Number.isFinite(input.duration) || input.duration <= 0)) throw new Error("Invalid StarFrame duration");
    const hasFrames = Boolean(input.firstFrame || input.lastFrame);
    const hasReferences = Boolean(input.images?.length || input.videos?.length || input.audios?.length);
    if (hasFrames && (hasReferences || !input.firstFrame || !input.lastFrame)) throw new Error("StarFrame frames require first and last frames and cannot include references");
    const body: Record<string, unknown> = {
        model: input.model, prompt: input.prompt, client_task_id: input.clientTaskId,
        mode: hasFrames ? "frames" : "references",
    };
    if (input.duration !== undefined) body.duration = input.duration;
    if (input.resolution) body.resolution = input.resolution;
    if (input.aspectRatio && input.aspectRatio !== "adaptive" && input.aspectRatio !== "auto") body.aspect_ratio = input.aspectRatio;
    if (hasFrames) body.frames = { first_frame: publicReference(input.firstFrame!), last_frame: publicReference(input.lastFrame!) };
    if (hasReferences) {
        const references: Record<string, unknown> = {};
        for (const [singular, plural, values] of [["image", "images", input.images], ["video", "videos", input.videos], ["audio", "audios", input.audios]] as const) {
            const urls = (values || []).map(publicReference);
            if (urls.length === 1) references[singular] = urls[0];
            if (urls.length > 1) references[plural] = urls;
        }
        body.references = references;
    }
    return body;
}

export function normalizeStarframeVideoResult(value: unknown) {
    if (!value || typeof value !== "object") throw new Error("Invalid StarFrame video response");
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.code === "number" && envelope.code !== 0) throw new Error(typeof envelope.msg === "string" ? envelope.msg : "StarFrame request failed");
    const candidate = typeof envelope.code === "number" ? envelope.data : envelope;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid StarFrame video response");
    const record = candidate as Record<string, unknown>;
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
    const id = typeof record.id === "string" ? record.id : "";
    const taskId = typeof record.task_id === "string" && record.task_id ? record.task_id : id;
    const nativeStatus = typeof record.status === "string" ? record.status : "unknown";
    // The Canvas account proxy represents in_progress as processing.
    const status = ["queued", "in_progress", "processing", "completed", "failed", "unknown"].includes(nativeStatus) ? nativeStatus : "unknown";
    const originalError = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    let videoUrl = "";
    if (status === "completed") {
        if (!taskId || !/^[A-Za-z0-9_.-]+$/.test(taskId)) throw new Error("Invalid StarFrame task ID");
        videoUrl = `/v1/videos/${encodeURIComponent(taskId)}/content`;
        if (metadata.url !== undefined && metadata.url !== videoUrl) throw new Error("Invalid StarFrame content path");
    }
    return {
        ...record, id, status, task_id: taskId, video_url: videoUrl, url: videoUrl,
        ...(status === "failed" ? { error: { message: typeof metadata.fail_reason === "string" ? metadata.fail_reason : typeof originalError.message === "string" ? originalError.message : "Video generation failed" } } : {}),
    };
}

export function starframeRetryClientTaskId(task?: { id?: string; client_task_id?: string; request_body?: string }) {
    let clientId = task?.client_task_id || "";
    if (!clientId && task?.request_body) {
        try { clientId = JSON.parse(task.request_body).client_task_id || ""; } catch { /* Keep the persisted pending ID when no request was accepted. */ }
    }
    if (!clientId && task?.id?.startsWith("client_video_task_")) clientId = task.id;
    if (typeof clientId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(clientId)) throw new Error("原任务的幂等 ID 缺失，请先查询原任务，不要重新提交");
    return clientId;
}

export function starframePollExpired(status: string | undefined, startedAt: number, now: number) {
    return status !== "completed" && status !== "failed" && now - startedAt > 60 * 60 * 1000;
}

export function assertStarframeVideoContent(blob: Blob) {
    if (!blob.size || blob.type && !blob.type.startsWith("video/") && blob.type !== "application/octet-stream") {
        throw new Error("视频下载响应为空或不是视频文件");
    }
}

export function carryStarframeClientTaskId<T extends object>(previous: { id?: string; client_task_id?: string; request_body?: string }, next: T): T & { client_task_id?: string } {
    try {
        return { ...next, client_task_id: starframeRetryClientTaskId(previous) };
    } catch {
        return next;
    }
}
