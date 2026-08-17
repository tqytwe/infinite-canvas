import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = {
    id?: string;
    request_id?: string;
    task_id?: string;
    video_id?: string;
    status?: string;
    error?: { message?: string } | string;
    url?: string;
    result_url?: string;
    video_url?: string;
    content?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    [key: string]: unknown;
};
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationProvider = "openai" | "agnes" | "grok" | "seedance" | "seedance-openai" | "plugin";
export type VideoGenerationTask = { id: string; provider: VideoGenerationProvider; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

class VideoRequestError extends Error {
    readonly retryable: boolean;

    constructor(message: string, retryable: boolean) {
        super(message);
        this.name = "VideoRequestError";
        this.retryable = retryable;
    }
}

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const delayMs = task.provider === "seedance" || task.provider === "agnes" ? 5000 : 2500;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(apiText("videoTimeout", { provider: videoProviderLabel(task.provider) }));
        await delay(delayMs, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = selectVideoModel(config);
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    const provider = videoProviderForModel(selectedModel, requestConfig.apiFormat);
    if (provider === "seedance-openai") return createSeedanceOpenAIVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    if (videoReferences.length || audioReferences.length) {
        throw new Error(apiText("videoReferencesUnsupported"));
    }
    if (provider === "agnes") return createAgnesVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (provider === "grok") return createGrokVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export function selectVideoModel(config: Pick<AiConfig, "model" | "videoModel">) {
    return (config.videoModel?.trim() || config.model?.trim() || "").trim();
}

export function videoProviderForModel(model: string, apiFormat: AiConfig["apiFormat"] = "openai"): Exclude<VideoGenerationProvider, "plugin"> {
    if (apiFormat === "ark") return "seedance";
    const normalized = modelOptionName(model).trim().toLowerCase();
    if (isSeedanceOpenAIModel(normalized)) return "seedance-openai";
    if (normalized.startsWith("agnes-") || normalized === "agnes") return "agnes";
    if (normalized.startsWith("grok-") || normalized === "grok") return "grok";
    return "openai";
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "seedance") return pollSeedanceTask(requestConfig, task, options);
    if (task.provider === "seedance-openai") return pollOpenAIVideoTask(requestConfig, task, options);
    if (task.provider === "agnes") return pollAgnesVideoTask(requestConfig, task, options);
    if (task.provider === "grok") return pollGrokVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) {
        try {
            const stored = await uploadMediaFile(result.blob, "video");
            return { ...stored, sourceUrl: result.url || stored.sourceUrl };
        } catch {
            return {
                url: URL.createObjectURL(result.blob),
                sourceUrl: result.url,
                storageKey: "",
                bytes: result.blob.size,
                mimeType: result.mimeType || result.blob.type || "video/mp4",
            };
        }
    }
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, sourceUrl: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

export function previewGeneratedVideo(result: VideoGenerationResult): UploadedFile {
    if (result.blob) {
        const url = URL.createObjectURL(result.blob);
        return {
            url,
            sourceUrl: result.url,
            storageKey: "",
            bytes: result.blob.size,
            mimeType: result.mimeType || result.blob.type || "video/mp4",
            width: 1280,
            height: 720,
            cloudStatus: "pending",
        };
    }
    if (result.url) {
        return {
            url: result.url,
            sourceUrl: result.url,
            storageKey: "",
            bytes: 0,
            mimeType: result.mimeType || "video/mp4",
            width: 1280,
            height: 720,
            cloudStatus: "pending",
        };
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createAgnesVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const image = references[0] ? await imageToDataUrl(references[0]) : "";
    const payload = {
        model: modelOptionName(model),
        prompt: withSystemPrompt(config, prompt),
        dimensions: normalizeVideoSize(config.size) || "1280x720",
        num_frames: normalizeAgnesFrameCount(config.videoSeconds),
        frame_rate: AGNES_FRAME_RATE,
        ...(image ? { image } : {}),
    };
    try {
        const created = unwrapVideoResponse(
            (
                await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), payload, {
                    headers: aiHeaders(config, "application/json"),
                    signal: options?.signal,
                    timeout: 30_000,
                })
            ).data,
        );
        const id = videoTaskId(created);
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "agnes", model };
    } catch (error) {
        throw readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

async function pollAgnesVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const response = await axios.get<ApiVideoResponse>(aiApiUrl(config, `/agnesapi?video_id=${encodeURIComponent(task.id)}`), {
            headers: aiHeaders(config),
            signal: options?.signal,
            timeout: 30_000,
        });
        const video = unwrapVideoResponse(response.data);
        const errorMessage = readApiErrorMessage(video.error);
        if (errorMessage) return { status: "failed", error: errorMessage };
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(config, normalizeVideoResultUrl(config, url), options) };
        const status = normalizeVideoStatus(video.status);
        if (isVideoFailureStatus(status)) return { status: "failed", error: readApiErrorMessage(video.error) || apiText("videoGenerationFailed") };
        if (isVideoSuccessStatus(status)) return { status: "failed", error: apiText("noPlayableVideo") };
        return { status: "pending" };
    } catch (error) {
        throw readAxiosError(error, apiText("videoTaskQueryFailed"));
    }
}

async function createGrokVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const image = references[0] ? await imageToDataUrl(references[0]) : "";
    const payload = {
        model: modelOptionName(model),
        prompt: withSystemPrompt(config, prompt),
        duration: normalizeGrokVideoSeconds(config.videoSeconds),
        resolution: normalizeVideoResolution(config.vquality),
        ...(image ? { image: { url: image } } : {}),
    };
    try {
        const created = unwrapVideoResponse(
            (
                await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos/generations"), payload, {
                    headers: aiHeaders(config, "application/json"),
                    signal: options?.signal,
                    timeout: 30_000,
                })
            ).data,
        );
        const id = videoTaskId(created);
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "grok", model };
    } catch (error) {
        throw readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

async function createSeedanceOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error(apiText("seedanceAudioRequiresVisual"));
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildOpenAISeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.prompt && !content.content?.length) throw new Error(apiText("videoPromptRequired"));
    const payload = {
        model: modelOptionName(model),
        size: normalizeVideoSize(config.size) || "1280x720",
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeOpenAISeedanceResolution(config.vquality),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        ...(isSeedance25Model(model) ? { seconds: String(normalizeOpenAISeedanceSeconds(config.videoSeconds)) } : { duration: normalizeSeedanceDuration(config.videoSeconds) }),
        ...(content.content?.length ? { content: content.content } : { prompt: content.prompt }),
    };
    try {
        const created = unwrapVideoResponse(
            (
                await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), payload, {
                    headers: aiHeaders(config, "application/json"),
                    signal: options?.signal,
                    timeout: 30_000,
                })
            ).data,
        );
        const id = videoTaskId(created);
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "seedance-openai", model };
    } catch (error) {
        throw readAxiosError(error, apiText("seedanceTaskCreateFailed"));
    }
}

async function pollGrokVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const response = await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${encodeURIComponent(task.id)}`), {
            headers: aiHeaders(config),
            signal: options?.signal,
            timeout: 30_000,
            params: { model: modelOptionName(task.model) },
        });
        const video = unwrapVideoResponse(response.data);
        const errorMessage = readApiErrorMessage(video.error);
        if (errorMessage) return { status: "failed", error: errorMessage };
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(config, normalizeVideoResultUrl(config, url), options) };
        const status = normalizeVideoStatus(video.status);
        if (isVideoFailureStatus(status)) return { status: "failed", error: readApiErrorMessage(video.error) || apiText("videoGenerationFailed") };
        if (isVideoSuccessStatus(status)) {
            const contentUrl = aiApiUrl(config, `/videos/${encodeURIComponent(task.id)}/content`);
            return { status: "completed", result: await videoResultFromUrl(config, `${contentUrl}?model=${encodeURIComponent(modelOptionName(task.model))}`, options) };
        }
        return { status: "pending" };
    } catch (error) {
        throw readAxiosError(error, apiText("videoTaskQueryFailed"));
    }
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.slice(0, 2).map((image) => imageToDataUrl(image)));
    const payload = {
        model: modelOptionName(model),
        prompt: withSystemPrompt(config, prompt),
        duration: normalizeOpenAIVideoDuration(config.videoSeconds),
        ...(normalizeVideoSize(config.size) ? { size: normalizeVideoSize(config.size)! } : {}),
        ...(images.length ? { images } : {}),
    };
    try {
        const created = unwrapVideoResponse(
            (
                await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), payload, {
                    headers: aiHeaders(config, "application/json"),
                    signal: options?.signal,
                    timeout: 30_000,
                })
            ).data,
        );
        const id = videoTaskId(created);
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model };
    } catch (error) {
        throw readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse(
            (
                await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), {
                    headers: aiHeaders(config),
                    signal: options?.signal,
                    timeout: 30_000,
                    params: { model: modelOptionName(task.model) },
                })
            ).data,
        );
        const errorMessage = readApiErrorMessage(video.error);
        if (errorMessage) return { status: "failed", error: errorMessage };
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(config, normalizeVideoResultUrl(config, url), options) };
        if (isVideoSuccessStatus(normalizeVideoStatus(video.status))) {
            return { status: "completed", result: await videoResultFromUrl(config, `${aiApiUrl(config, `/videos/${task.id}/content`)}?model=${encodeURIComponent(modelOptionName(task.model))}`, options) };
        }
        if (isVideoFailureStatus(normalizeVideoStatus(video.status))) return { status: "failed", error: readApiErrorMessage(video.error) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw readAxiosError(error, apiText("videoTaskQueryFailed"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error(apiText("seedanceAudioRequiresVisual"));
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error(apiText("videoPromptRequired"));
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask(
            (
                await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, {
                    headers: aiHeaders(config, "application/json"),
                    signal: options?.signal,
                    timeout: 30_000,
                })
            ).data,
        );
        if (!created.id) throw new Error(apiText("seedanceNoTaskId"));
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw readAxiosError(error, apiText("seedanceTaskCreateFailed"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask(
            (
                await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), {
                    headers: aiHeaders(config),
                    signal: options?.signal,
                    timeout: 30_000,
                    params: { model: modelOptionName(task.model) },
                })
            ).data,
        );
        const errorMessage = readApiErrorMessage(state.error);
        if (errorMessage) return { status: "failed", error: errorMessage };
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(config, normalizeVideoResultUrl(config, url), options) };
        const status = normalizeVideoStatus(state.status);
        if (isVideoSuccessStatus(status)) return { status: "failed", error: apiText("seedanceNoVideoUrl") };
        if (isVideoFailureStatus(status)) return { status: "failed", error: readApiErrorMessage(state.error) || apiText(status === "expired" ? "seedanceVideoTimeout" : "seedanceVideoFailed") };
        return { status: "pending" };
    } catch (error) {
        throw readAxiosError(error, apiText("seedanceTaskQueryFailed"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error(apiText("seedanceVideoDuration"));
        total += video.durationMs;
    }
    if (total > 15000) throw new Error(apiText("seedanceVideoTotalDuration"));
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error(apiText("seedanceAudioDuration"));
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error(apiText("seedanceAudioTotalDuration"));
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function buildOpenAISeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    if (!references.length && !videoReferences.length && !audioReferences.length) {
        return { prompt: withSystemPrompt(config, prompt) };
    }
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(withSystemPrompt(config, prompt), references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, 30)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) } });
    }
    for (const video of videoReferences.slice(0, 10)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) } });
    }
    for (const audio of audioReferences.slice(0, 10)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) } });
    }
    return { content };
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(apiText("referenceImageReadFailed"));
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetchWithTimeout(video.url, 10 * 60_000)).blob();
    if (!blob) throw new Error(apiText("invalidReferenceVideo"));
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetchWithTimeout(audio.url, 10 * 60_000)).blob();
    if (!blob) throw new Error(apiText("invalidReferenceAudio"));
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(config: AiConfig, url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (!requiresAuthenticatedVideoDownload(config, url)) return { url, mimeType: "video/mp4" };
    try {
        const response = await axios.get<Blob>(url, {
            headers: aiHeaders(config),
            responseType: "blob",
            signal: options?.signal,
            timeout: 10 * 60_000,
        });
        await assertVideoBlob(response.data);
        return { blob: response.data, url, mimeType: response.data.type || "video/mp4" };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        throw readAxiosError(error, apiText("videoDownloadFailed"));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (config.apiFormat === "gemini") throw new Error(apiText("geminiVideoUnsupported"));
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeOpenAIVideoDuration(value: string) {
    const seconds = Math.floor(Number(value) || 8);
    return [4, 6, 8].reduce((best, option) => (Math.abs(option - seconds) < Math.abs(best - seconds) ? option : best), 8);
}

function normalizeOpenAISeedanceSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 4);
    return Math.max(4, Math.min(30, seconds));
}

function normalizeOpenAISeedanceResolution(value: string) {
    const resolution = normalizeVideoResolution(value);
    return resolution === "480p" ? "480p" : "720p";
}

function isSeedance25Model(model: string) {
    return /^(?:seedance[-_ ]?2(?:\.5|_5))(?:$|[-_ :])/.test(modelOptionName(model).trim().toLowerCase());
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    const value = unwrapEnvelope(payload, apiText("noVideoTask"));
    if (!isRecord(value)) throw new Error(apiText("noVideoTask"));
    return value;
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, apiText("seedanceNoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: unknown) {
    const candidates: string[] = [];
    const preferredKeys = new Set(["url", "video_url", "result_url", "download_url", "content_url", "metadata", "content", "video", "result", "output", "data"]);
    const visit = (value: unknown, key = "") => {
        if (typeof value === "string") {
            if (preferredKeys.has(key) && isVideoResourceUrl(value)) candidates.push(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, key));
            return;
        }
        if (!isRecord(value)) return;
        const entries = Object.entries(value);
        entries
            .filter(([entryKey]) => preferredKeys.has(entryKey))
            .forEach(([entryKey, entryValue]) => visit(entryValue, entryKey));
        entries
            .filter(([entryKey]) => !preferredKeys.has(entryKey))
            .forEach(([entryKey, entryValue]) => visit(entryValue, entryKey));
    };
    visit(payload);
    return candidates.find((url) => isVideoResourceUrl(url));
}

function normalizeVideoResultUrl(config: AiConfig, value: string) {
    if (value.startsWith("/v1/")) return buildApiUrl(config.baseUrl, value.slice(3));
    if (/^https?:\/\//i.test(value)) {
        try {
            const parsed = new URL(value);
            if (parsed.pathname.startsWith("/v1/")) return buildApiUrl(config.baseUrl, `${parsed.pathname.slice(3)}${parsed.search}`);
        } catch {}
    }
    return value;
}

function isVideoResourceUrl(value: string) {
    return isPublicMediaUrl(value) || value.startsWith("/") || /\.mp4(\?|#|$)/i.test(value);
}

function videoTaskId(payload: unknown): string {
    if (!isRecord(payload)) return "";
    for (const key of ["video_id", "request_id", "task_id", "id"]) {
        const value = payload[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    for (const key of ["data", "result", "response"]) {
        const nested = videoTaskId(payload[key]);
        if (nested) return nested;
    }
    return "";
}

function normalizeVideoStatus(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function isVideoSuccessStatus(value: string) {
    return ["completed", "succeeded", "success", "done", "finished"].includes(value);
}

function isVideoFailureStatus(value: string) {
    return ["failed", "failure", "cancelled", "canceled", "expired", "error"].includes(value);
}

function videoProviderLabel(provider: VideoGenerationProvider) {
    if (provider === "seedance" || provider === "seedance-openai") return "Seedance ";
    if (provider === "agnes") return "Agnes ";
    if (provider === "grok") return "Grok ";
    return "";
}

function isSeedanceOpenAIModel(model: string) {
    return /^seedance[-_ ]?2(?:\.5|_5)?(?:$|[-_ :])/.test(model);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const AGNES_FRAME_RATE = 24;

function normalizeAgnesFrameCount(value: string) {
    const seconds = Math.max(1, Math.min(18, Math.floor(Number(value) || 6)));
    const target = Math.max(9, Math.round(seconds * AGNES_FRAME_RATE));
    return Math.min(441, Math.floor((target - 1) / 8) * 8 + 1);
}

function normalizeGrokVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 8);
    return Math.max(1, Math.min(15, seconds));
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { code?: unknown; msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        (payload.code !== undefined && String(payload.code) !== "0" ? String(payload.code) : "") ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string): VideoRequestError {
    if (axios.isCancel(error)) return new VideoRequestError(apiText("requestCanceled"), false);
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        const responseData = error.response?.data;
        const status = error.response?.status;
        return new VideoRequestError(readApiErrorMessage(responseData) || statusMessage(status, fallback), isRetryableStatus(status));
    }
    if (error instanceof DOMException && error.name === "AbortError") return new VideoRequestError(apiText("requestCanceled"), false);
    if (error instanceof VideoRequestError) return error;
    if (error instanceof Error) return new VideoRequestError(readApiErrorMessage(error.message) || error.message, false);
    return new VideoRequestError(fallback, false);
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

function isRetryableStatus(status: number | undefined) {
    return status === undefined || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isRetryableVideoTaskError(error: unknown) {
    return error instanceof VideoRequestError && error.retryable;
}

function requiresAuthenticatedVideoDownload(config: AiConfig, value: string) {
    if (!value || value.startsWith("blob:") || value.startsWith("data:")) return false;
    if (value.startsWith("/api/platform/gateway") || value.startsWith("/api/platform/asset-proxy") || value.startsWith("/api/storage/objects/")) return false;
    if (value.startsWith("/v1/")) return true;
    try {
        const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
        const parsed = new URL(value, origin);
        const base = new URL(config.baseUrl, origin);
        return parsed.origin === base.origin && (parsed.pathname.startsWith("/v1/") || parsed.pathname.startsWith("/api/v3/") || parsed.pathname.startsWith("/api/plan/v3/"));
    } catch {
        return false;
    }
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

async function fetchWithTimeout(input: RequestInfo | URL, timeoutMs: number) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { credentials: "same-origin", signal: controller.signal });
    } finally {
        window.clearTimeout(timer);
    }
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(apiText("localAssetReadFailed")));
        reader.readAsDataURL(blob);
    });
}
