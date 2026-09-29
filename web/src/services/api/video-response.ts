export type VideoResponseEnvelope = {
    code: number;
    data?: unknown;
    msg?: string;
    message?: string;
};

export function isVideoEnvelope(payload: unknown): payload is VideoResponseEnvelope {
    return typeof payload === "object"
        && payload !== null
        && !Array.isArray(payload)
        && "code" in payload
        && typeof (payload as { code?: unknown }).code === "number";
}

export function videoResponseFormatError(payload: unknown) {
    if (typeof payload === "string") {
        const normalized = payload.trim().toLowerCase();
        if (normalized.startsWith("<!doctype html") || normalized.startsWith("<html")) {
            return "视频接口返回了 HTML 网页，而不是 JSON（非 JSON 响应），请检查 API 地址和接口路径";
        }
        return "视频接口返回了文本，而不是 JSON（非 JSON 响应）";
    }
    return "视频接口返回格式错误";
}
