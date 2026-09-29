export function isMissingVideoModelError(payload: unknown) {
    if (!payload || typeof payload !== "object") return false;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== "object") return false;
    const detail = error as { message?: unknown; type?: unknown };
    return detail.type === "invalid_request_error" && typeof detail.message === "string" && detail.message.trim().toLowerCase() === "model is required";
}

export function videoFormDataToJson(form: FormData): Record<string, string | string[]> | null {
    const body: Record<string, string | string[]> = {};
    for (const [key, value] of form.entries()) {
        if (typeof value !== "string") return null;
        const current = body[key];
        if (current === undefined) body[key] = value;
        else if (Array.isArray(current)) current.push(value);
        else body[key] = [current, value];
    }
    return body;
}

export function videoPollParams(model: string) {
    return { model };
}

export async function postVideoWithModelFallback<T>(body: FormData | Record<string, unknown>, allowFallback: boolean, send: (requestBody: FormData | Record<string, unknown>) => Promise<T>): Promise<T> {
    try {
        return await send(body);
    } catch (error) {
        const responseBody = (error as { response?: { data?: unknown } } | null)?.response?.data;
        if (!allowFallback || !(body instanceof FormData) || !isMissingVideoModelError(responseBody)) throw error;
        const jsonBody = videoFormDataToJson(body);
        if (!jsonBody) throw error;
        return send(jsonBody);
    }
}
