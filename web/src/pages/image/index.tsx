import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, Image as ImageIcon, ImagePlus, LoaderCircle, PenLine, Plus, RefreshCw, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Select, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { GenerationHistoryPanel } from "@/components/canvas/generation-history-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { decodeChannelModel, encodeChannelModel, modelMatchesCapability, modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { createManagedImageGenerationTask, isRetryableManagedImageTaskError, pollManagedImageGenerationTask, requestEdit, requestGeneration, type ManagedImageGenerationTask } from "@/services/api/image";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { readCloudWorkbenchLogs, replaceCloudWorkbenchLogs, upsertCloudWorkbenchLog } from "@/services/workbench-cloud";
import { getCanvasSession, isCanvasAuthenticated, isCanvasManagedMode, switchCanvasImageGroup, useCanvasCanWrite, useCanvasSessionStore } from "@/services/canvas-cloud";
import { takeImagePromptHandoff } from "@/services/creation-intent";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    sourceUrl?: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    deliveryError?: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "pending" | "success" | "failed";
    task?: ManagedImageGenerationTask;
    error?: string;
    images: GeneratedImage[];
    thumbnails: string[];
    deliveryStatus?: "stored" | "pending";
    deliveryError?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

function resultsForLog(log: GenerationLog): GenerationResult[] {
    if (log.status === "pending" && log.task) {
        return Array.from({ length: Math.max(1, Number(log.config.count) || log.imageCount || 1) }, () => ({ id: nanoid(), status: "pending" }));
    }
    return log.images.map((image) =>
        image.dataUrl || !image.storageKey ? { id: image.id, status: "success" as const, image } : { id: image.id, status: "pending" as const },
    );
}

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export default function ImagePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const logsRefreshIdRef = useRef(0);
    const logSaveQueueRef = useRef(Promise.resolve());
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const canWrite = useCanvasCanWrite();
    const sessionAuthenticated = useCanvasSessionStore((state) => state.session?.authenticated);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const currentLogIdRef = useRef<string | undefined>(undefined);

    const imageModelOptions = selectableModelsByCapability(effectiveConfig, "image");
    const model = effectiveConfig.imageModel && modelMatchesCapability(effectiveConfig, effectiveConfig.imageModel, "image") ? effectiveConfig.imageModel : imageModelOptions[0] || "";
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionAuthenticated]);

    useEffect(() => {
        const handoff = takeImagePromptHandoff();
        if (!handoff) return;
        setPrompt(handoff.prompt_text);
        const recommendedModel = handoff.models?.find((value) => value.trim());
        const recommendedSize = handoff.sizes?.find((value) => value.trim());
        if (recommendedModel) updateConfig("imageModel", recommendedModel);
        if (recommendedSize) updateConfig("size", recommendedSize);
        message.success(t("imageWorkbench.promptLoaded"));
    }, [message, t, updateConfig]);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("imageWorkbench.clipboardEmpty"));
        }
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        try {
            const managedTask = await createManagedImageGenerationTask(snapshot.config, snapshot.text, snapshot.references);
            if (managedTask) {
                const log = buildLog({
                    prompt: snapshot.text,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    durationMs: 0,
                    successCount: 0,
                    failCount: 0,
                    status: "pending",
                    task: managedTask,
                    images: [],
                });
                currentLogIdRef.current = log.id;
                await saveLog(log, false);
                void pollGenerationLog(log, snapshot.config, agentTaskId);
                return;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: generationCount, error: errorMessage });
            await saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    durationMs: performance.now() - batchStartedAt,
                    successCount: 0,
                    failCount: generationCount,
                    status: "failed",
                    error: errorMessage,
                    images: [],
                }),
                false,
            );
            message.error(errorMessage);
            setRunning(false);
            return;
        }

        const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));

        const result = await Promise.allSettled(tasks);
        const successImages = result.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
        const successCount = successImages.length;
        const failCount = generationCount - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            const logImages = await deliverImageResults(successImages);
            const deliveryFailed = logImages.some((image) => image.deliveryError);
            setResults([
                ...logImages.map((image) => ({ id: image.id, status: "success" as const, image })),
                ...Array.from({ length: failCount }, () => ({ id: nanoid(), status: "failed" as const, error: error || t("workbench.generationFailed") })),
            ]);
            const finalLog = buildLog({
                prompt: text,
                model,
                config: snapshot.config,
                references: snapshot.references,
                durationMs: performance.now() - batchStartedAt,
                successCount,
                failCount,
                status: successCount ? "success" : "failed",
                images: logImages,
            });
            const finalLogWithDelivery = {
                ...finalLog,
                deliveryStatus: deliveryFailed ? ("pending" as const) : finalLog.deliveryStatus,
                deliveryError: deliveryFailed ? t("imageWorkbench.deliveryPending") : undefined,
            };
            currentLogIdRef.current = finalLogWithDelivery.id;
            await saveLog(finalLogWithDelivery);
            if (!successCount) {
                message.error(error || t("workbench.generationFailed"));
            } else if (deliveryFailed) {
                message.warning(t("imageWorkbench.deliveryPending"));
            } else {
                message.success(t("imageWorkbench.generated"));
            }
        } finally {
            setRunning(false);
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        const timestamp = new Date().getTime();
        const filename = `image-${timestamp}-${index + 1}.png`;
        saveAs(image.dataUrl, filename);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        try {
            // If already uploaded (has storageKey), reuse it directly
            if (image.storageKey) {
                console.log("[Canvas] Reusing existing storageKey:", image.storageKey);
                setReferences((value) => [...value, { 
                    id: nanoid(), 
                    name: `result-${index + 1}.png`, 
                    type: image.mimeType, 
                    dataUrl: image.dataUrl, 
                    storageKey: image.storageKey 
                }]);
                message.success(t("imageWorkbench.addedReference"));
                return;
            }

            console.log("[Canvas] addResultToReferences:", { hasDataUrl: !!image.dataUrl, index });
            if (!image.dataUrl) {
                console.error("[Canvas] No dataUrl in image");
                message.error("图片数据缺失");
                return;
            }
            const stored = await uploadImage(image.dataUrl);
            console.log("[Canvas] Upload complete:", { url: stored.url, storageKey: stored.storageKey });
            setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
            message.success(t("imageWorkbench.addedReference"));
        } catch (error) {
            console.error("[Canvas] addResultToReferences failed:", error);
            message.error("添加参考图失败: " + (error instanceof Error ? error.message : String(error)));
        }
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        try {
            // If already uploaded (has storageKey), reuse it directly
            if (image.storageKey) {
                console.log("[Canvas] Reusing existing storageKey for assets:", image.storageKey);
                addAsset({
                    kind: "image",
                    title: t("imageWorkbench.resultTitle", { count: index + 1 }),
                    coverUrl: image.dataUrl,
                    tags: [],
                    source: t("imageWorkbench.source"),
                    data: { dataUrl: image.dataUrl, sourceUrl: image.sourceUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                    metadata: { source: "image-page", prompt },
                });
                message.success(t("imageWorkbench.savedAsset"));
                return;
            }

            console.log("[Canvas] saveResultToAssets:", { hasDataUrl: !!image.dataUrl, index });
            if (!image.dataUrl) {
                message.error("图片数据缺失");
                return;
            }
            const stored = await uploadImage(image.dataUrl);
            addAsset({
                kind: "image",
                title: t("imageWorkbench.resultTitle", { count: index + 1 }),
                coverUrl: stored.url,
                tags: [],
                source: t("imageWorkbench.source"),
                data: { dataUrl: stored.url, sourceUrl: stored.sourceUrl || image.sourceUrl, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "image-page", prompt },
            });
            message.success(t("common.addedToAssets"));
        } catch (error) {
            console.error("[Canvas] saveResultToAssets failed:", error);
            message.error("保存到资产失败: " + (error instanceof Error ? error.message : String(error)));
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning(t("imageWorkbench.unsupportedAsset"));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = async () => {
        const imageKeys = logs.filter((log) => selectedLogIds.includes(log.id)).flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        const nextLogs = logs.filter((log) => !selectedLogIds.includes(log.id));
        await Promise.all([deleteStoredImages(imageKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]);
        if (isCanvasManagedMode() && isCanvasAuthenticated()) await replaceCloudWorkbenchLogs("image-workbench", nextLogs.map(serializeLog));
        await refreshLogs();
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        const previous = logSaveQueueRef.current;
        const current = previous
            .catch(() => undefined)
            .then(async () => {
                const serialized = serializeLog({ ...log, updatedAt: Math.max(Date.now(), (log.updatedAt || 0) + 1) });
                try {
                    await logStore.setItem(log.id, serialized);
                } catch (error) {
                    console.warn("[canvas-local] image workbench log save failed", log.id, error);
                }
                if (isCanvasManagedMode() && isCanvasAuthenticated()) {
                    try {
                        await upsertCloudWorkbenchLog("image-workbench", serialized, logs.map(serializeLog));
                        logTaskEvent("cloud-state-saved", serialized, { imageCount: serialized.images.length });
                    } catch (error) {
                        console.warn("[canvas-cloud] image workbench log save pending", log.id, error);
                        logTaskEvent("cloud-state-save-failed", serialized, { error: error instanceof Error ? error.message : String(error) });
                    }
                }
                try {
                    await refreshLogs(resumePending);
                } catch (error) {
                    console.warn("[canvas-cloud] image workbench refresh failed", error);
                }
            });
        logSaveQueueRef.current = current;
        await current;
    };

    const refreshLogs = async (resumePending = true) => {
        const refreshId = ++logsRefreshIdRef.current;
        const managedSession = isCanvasManagedMode() ? await getCanvasSession() : null;
        if (isCanvasManagedMode() && !managedSession?.authenticated) {
            if (refreshId !== logsRefreshIdRef.current) return [];
            setLogs([]);
            return [];
        }
        let cloudLogs: GenerationLog[] | null = null;
        let cloudReadFailed = false;
        try {
            cloudLogs = await readCloudWorkbenchLogs<GenerationLog>("image-workbench");
        } catch (error) {
            cloudReadFailed = true;
            console.warn("[canvas-cloud] image workbench log read failed", error);
        }
        const localLogs = await readStoredLogs(false);
        const remoteLogs = cloudLogs ? await Promise.all(cloudLogs.map((log) => normalizeLog(log, false))) : null;
        const nextLogs = remoteLogs ? mergeLogs(remoteLogs, localLogs) : localLogs;
        if (refreshId !== logsRefreshIdRef.current) return nextLogs;
        setLogs(nextLogs);
        // A non-empty cloud state is authoritative for existing IDs. Replacing it
        // from a browser's local snapshot can roll a completed task back to
        // pending when another refresh or tab is still finishing delivery.
        if (!cloudLogs && !cloudReadFailed && isCanvasManagedMode() && isCanvasAuthenticated() && nextLogs.length) {
            await replaceCloudWorkbenchLogs("image-workbench", nextLogs.map(serializeLog));
        }
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status !== "pending") continue;
            if (log.task) {
                void pollGenerationLog(log);
            } else {
                void saveLog({ ...log, status: "failed", error: t("workbench.generationFailed"), failCount: Math.max(1, log.failCount), imageCount: Math.max(1, log.imageCount) }, false);
            }
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        logTaskEvent("poll-start", log);
        const expectedCount = Math.max(1, Number(log.config.count) || log.imageCount || 1);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        if (currentLogIdRef.current === log.id) {
            setResults((value) => (value.length ? value : Array.from({ length: expectedCount }, () => ({ id: nanoid(), status: "pending" }))));
        }
        const taskConfig = {
            ...effectiveConfig,
            ...log.config,
            model: log.task.model,
            imageModel: log.task.model,
            count: String(expectedCount),
        };
        let generatedImages: GeneratedImage[] = [];
        let lastTransientError: Error | undefined;
        try {
            for (let attempt = 0; attempt < 160; attempt += 1) {
                let state: Awaited<ReturnType<typeof pollManagedImageGenerationTask>>;
                try {
                    state = await pollManagedImageGenerationTask(configOverride || taskConfig, log.task);
                    lastTransientError = undefined;
                } catch (error) {
                    if (!isRetryableManagedImageTaskError(error) || attempt === 159) throw error;
                    lastTransientError = error instanceof Error ? error : new Error(t("workbench.generationFailed"));
                    await delay(3000);
                    continue;
                }
                if (state.status === "completed") {
                    logTaskEvent("provider-completed", log, { imageCount: state.images.length, attempt: attempt + 1 });
                    const providerImages = state.images.map((image) => ({
                        id: image.id,
                        dataUrl: image.dataUrl,
                        sourceUrl: image.dataUrl,
                        durationMs: Date.now() - log.createdAt,
                        width: 1024,
                        height: 1024,
                        bytes: 0,
                        mimeType: "image/png",
                    }));
                    generatedImages = providerImages;
                    const successCount = providerImages.length;
                    const failCount = Math.max(0, expectedCount - successCount);
                    const providerLog: GenerationLog = {
                        ...log,
                        status: successCount ? "success" : "failed",
                        durationMs: Date.now() - log.createdAt,
                        successCount,
                        failCount,
                        imageCount: expectedCount,
                        images: providerImages,
                        thumbnails: providerImages.map((image) => image.dataUrl),
                        deliveryStatus: successCount ? "pending" : undefined,
                        error: successCount ? undefined : t("imageWorkbench.missingResult"),
                    };
                    if (currentLogIdRef.current === log.id) {
                        setResults([
                            ...providerImages.map((image) => ({ id: image.id, status: "success" as const, image })),
                            ...Array.from({ length: failCount }, () => ({ id: nanoid(), status: "failed" as const, error: t("imageWorkbench.missingResult") })),
                        ]);
                    }
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : t("imageWorkbench.missingResult") });
                    await saveLog(providerLog, false);
                    logTaskEvent("provider-state-saved", providerLog, { imageCount: successCount });
                    if (!successCount) {
                        message.error(t("imageWorkbench.missingResult"));
                        return;
                    }
                    generatedImages = await deliverImageResults(providerImages);
                    logTaskEvent("delivery-finished", log, {
                        imageCount: generatedImages.length,
                        storedCount: generatedImages.filter((image) => image.storageKey && !image.deliveryError).length,
                        pendingCount: generatedImages.filter((image) => image.deliveryError).length,
                    });
                    const deliveryFailed = generatedImages.some((image) => image.deliveryError);
                    const finalLog: GenerationLog = {
                        ...providerLog,
                        images: generatedImages,
                        thumbnails: generatedImages.map((image) => image.dataUrl),
                        deliveryStatus: deliveryFailed ? "pending" : "stored",
                        deliveryError: deliveryFailed ? t("imageWorkbench.deliveryPending") : undefined,
                    };
                    if (currentLogIdRef.current === log.id) {
                        setResults([
                            ...generatedImages.map((image) => ({ id: image.id, status: "success" as const, image })),
                            ...Array.from({ length: failCount }, () => ({ id: nanoid(), status: "failed" as const, error: t("imageWorkbench.missingResult") })),
                        ]);
                    }
                    await saveLog(finalLog, false);
                    logTaskEvent("final-state-saved", finalLog, { imageCount: generatedImages.length });
                    deliveryFailed ? message.warning(t("imageWorkbench.deliveryPending")) : message.success(t("imageWorkbench.generated"));
                    return;
                }
                if (state.status === "failed") {
                    throw new Error(state.error);
                }
                if (attempt === 159) throw lastTransientError || new Error(t("workbench.generationFailed"));
                await delay(3000);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            logTaskEvent("poll-failed", log, { error: errorMessage });
            const successCount = generatedImages.length;
            const failCount = Math.max(0, expectedCount - successCount);
            if (currentLogIdRef.current === log.id) {
                setResults([
                    ...generatedImages.map((image) => ({ id: image.id, status: "success" as const, image })),
                    ...Array.from({ length: Math.max(1, failCount) }, () => ({ id: nanoid(), status: "failed" as const, error: errorMessage })),
                ]);
            }
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount, failCount, error: errorMessage });
            await saveLog(
                {
                    ...log,
                    status: "failed",
                    durationMs: Date.now() - log.createdAt,
                    successCount,
                    failCount,
                    imageCount: expectedCount,
                    images: generatedImages,
                    thumbnails: generatedImages.map((image) => image.dataUrl),
                    error: errorMessage,
                },
                false,
            );
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = async (log: GenerationLog) => {
        currentLogIdRef.current = log.id;
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults(resultsForLog(log));
        if (log.status === "pending" || !log.images.some((image) => image.storageKey && !image.dataUrl)) return;
        try {
            const hydrated = await normalizeLog(log, true);
            if (currentLogIdRef.current !== hydrated.id || activeLogIdsRef.current.has(hydrated.id)) return;
            setPreviewLog(hydrated);
            setResults(resultsForLog(hydrated));
            // Auto-retry cloud upload in background if a previous upload timed out.
            if (log.deliveryStatus === "pending" && !activeLogIdsRef.current.has(hydrated.id)) {
                retryDelivery(hydrated).catch((e) =>
                    console.warn("[canvas-cloud] auto-retry delivery failed", hydrated.id, e),
                );
            }
        } catch (error) {
            console.warn("[canvas-cloud] selected image preview hydration failed", log.id, error);
        }
    };

    const retryDelivery = async (log: GenerationLog) => {
        const images = await deliverImageResults(log.images);
        const failed = images.some((image) => image.deliveryError);
        const nextLog: GenerationLog = {
            ...log,
            images,
            thumbnails: images.map((image) => image.dataUrl),
            deliveryStatus: failed ? "pending" : "stored",
            deliveryError: failed ? t("imageWorkbench.deliveryPending") : undefined,
        };
        await saveLog(nextLog, false);
        if (currentLogIdRef.current === log.id) {
            setPreviewLog(nextLog);
            setResults(images.map((image) => ({ id: image.id, status: "success" as const, image })));
        }
        failed ? message.warning(t("imageWorkbench.deliveryPending")) : message.success(t("imageWorkbench.deliveryRecovered"));
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, imageModel: model, count: String(generationCount) }, references: [...references] };
    };

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
        const itemStartedAt = performance.now();
        try {
            const requestConfig = { ...snapshot.config, count: "1" };
            const result = snapshot.references.length ? await requestEdit(requestConfig, snapshot.text, snapshot.references) : await requestGeneration(requestConfig, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const nextImage = {
                id: image.id,
                dataUrl: image.dataUrl,
                sourceUrl: image.dataUrl || undefined,
                durationMs: performance.now() - itemStartedAt,
                width: 1024,
                height: 1024,
                bytes: 0,
                mimeType: "image/png",
            };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            return nextImage;
        } catch (error) {
            setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (index: number) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPreviewLog(null);
        setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        const retryStartedAt = performance.now();
        try {
            const image = await runGenerationSlot(index, snapshot);
            const logImage = (await deliverImageResults([image]))[0];
            setResults((value) => updateResultAt(value, index, { image: logImage }));
            await saveLog({
                ...buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: "1" },
                    references: snapshot.references,
                    durationMs: performance.now() - retryStartedAt,
                    successCount: 1,
                    failCount: 0,
                    status: "success",
                    images: [logImage],
                }),
                deliveryStatus: logImage.deliveryError ? "pending" : "stored",
                deliveryError: logImage.deliveryError ? t("imageWorkbench.deliveryPending") : undefined,
            });
            logImage.deliveryError ? message.warning(t("imageWorkbench.deliveryPending")) : message.success(t("workbench.retrySuccess"));
        } catch {
            // runGenerationSlot has already marked the result as failed.
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("imageWorkbench.title")}</h1>
                                </div>
                                <div className="flex shrink-0 gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        {t("workbench.logs")}
                                    </Button>
                                    <Button icon={<ImageIcon className="size-4" />} onClick={() => setHistoryOpen(true)}>
                                        {t("canvas.generationHistory.title")}
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        {t("workbench.settings")}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("imageWorkbench.references")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} disabled={!canWrite} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} disabled={!canWrite} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`hover-scrollbar hover-scrollbar-hint relative flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${isReferenceDragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current += 1;
                                        if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                        if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = 0;
                                        setIsReferenceDragActive(false);
                                        void addReferences(event.dataTransfer.files);
                                    }}
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label={t("imageWorkbench.removeReference")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {effectiveConfig.size} · {effectiveConfig.quality}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("workbench.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canWrite || !canGenerate} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            </div>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard
                                            key={result.id}
                                            image={result.image}
                                            index={index}
                                            onEdit={addResultToReferences}
                                            onDownload={downloadImage}
                                            onSaveAsset={saveResultToAssets}
                                            onRetryDelivery={
                                                (previewLog || logs.find((item) => item.id === currentLogIdRef.current))?.deliveryStatus === "pending"
                                                    ? () => void retryDelivery(previewLog || logs.find((item) => item.id === currentLogIdRef.current)!)
                                                    : undefined
                                            }
                                        />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={() => retryResult(index)} />
                                    ) : (
                                        <PendingImageCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("imageWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <Drawer title={t("workbench.settings")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} mediaType="image" />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            {historyOpen ? <GenerationHistoryPanel logs={logs} onSelectLog={(log) => { setPrompt(log.prompt || ""); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} /> : null}
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={() => void deleteSelectedLogs()} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const imageChannels = config.channels.filter((channel) => channel.models.some((entry) => entry.capability === "image"));
    const decoded = decodeChannelModel(model);
    const currentChannelId = decoded?.channelId ?? (imageChannels[0]?.id || "");
    const initialGroupBootstrappedRef = useRef(false);
    const initialImageGroupId = imageChannels.find((channel) => channel.id === currentChannelId)?.groupId ?? imageChannels[0]?.groupId;

    useEffect(() => {
        if (!isCanvasManagedMode() || initialGroupBootstrappedRef.current || !initialImageGroupId) return;
        initialGroupBootstrappedRef.current = true;
        void switchCanvasImageGroup(initialImageGroupId).catch(() => {
            initialGroupBootstrappedRef.current = false;
        });
    }, [initialImageGroupId]);

    const handleChannelChange = async (channelId: string) => {
        const channel = config.channels.find((item) => item.id === channelId);
        const firstImageModel = channel?.models.find((entry) => entry.capability === "image");
        if (isCanvasManagedMode() && channel?.groupId) {
            try {
                await switchCanvasImageGroup(channel.groupId);
            } catch {
                message.error(t("apiErrors.requestFailed"));
                return;
            }
        }
        if (firstImageModel) updateConfig("imageModel", encodeChannelModel(channelId, firstImageModel.name));
    };

    return (
        <>
            {imageChannels.length > 0 ? (
                <label className="col-span-2 block min-w-0 sm:col-span-1">
                    <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("videoWorkbench.accountGroup")}</span>
                    <Select
                        value={currentChannelId}
                        onChange={(value) => void handleChannelChange(value)}
                        className="w-full"
                        options={imageChannels.map((channel) => ({ value: channel.id, label: channel.name }))}
                    />
                </label>
            ) : null}
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />
            </div>
        </>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
    onRetryDelivery,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
    onRetryDelivery?: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <Image src={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-square object-cover" />
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className={`grid min-w-0 gap-2 ${onRetryDelivery ? "grid-cols-4" : "grid-cols-3"}`}>
                    <Tooltip title={t("common.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("common.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                    {onRetryDelivery ? (
                        <Tooltip title={t("imageWorkbench.retryDelivery")}>
                            <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRetryDelivery}>
                                {t("imageWorkbench.retryDelivery")}
                            </Button>
                        </Tooltip>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function PendingImageCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                </div>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);

    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <img key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <div className="flex gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                            {t("workbench.successCount", { count: log.successCount ?? log.imageCount })}
                        </Tag>
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                {t("workbench.failCount", { count: log.failCount })}
                            </Tag>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{t("workbench.itemCount", { count: log.imageCount })}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs(hydrateImages = true) {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map((value) => normalizeLog(value, hydrateImages)));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function deliverImageResults(images: GeneratedImage[]) {
    return Promise.all(
        images.map(async (image) => {
            if (image.storageKey && !image.deliveryError) return image;
            const sourceUrl = image.sourceUrl || image.dataUrl;
            if (!sourceUrl) return { ...image, deliveryError: i18n.t("imageWorkbench.deliveryPending") };
            try {
                const stored = await uploadImage(sourceUrl);
                const pending = isCanvasManagedMode() && stored.cloudStatus === "pending";
                return {
                    ...image,
                    dataUrl: stored.url,
                    sourceUrl,
                    storageKey: stored.storageKey,
                    width: stored.width,
                    height: stored.height,
                    bytes: stored.bytes,
                    mimeType: stored.mimeType,
                    deliveryError: pending ? stored.cloudError || i18n.t("imageWorkbench.deliveryPending") : undefined,
                };
            } catch (error) {
                return {
                    ...image,
                    dataUrl: sourceUrl,
                    sourceUrl,
                    deliveryError: error instanceof Error ? error.message : i18n.t("imageWorkbench.deliveryPending"),
                };
            }
        }),
    );
}

async function normalizeLog(log: Partial<GenerationLog>, hydrateImages = true): Promise<GenerationLog> {
    const references = hydrateImages
        ? await Promise.all(
              (log.references || []).map(async (item) => ({
                  ...item,
                  dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
              })),
          )
        : [...(log.references || [])];
    const images = hydrateImages
        ? await Promise.all(
              (log.images || []).map(async (item) => ({
                  ...item,
                  dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl?.startsWith("blob:") ? item.sourceUrl || item.dataUrl : item.dataUrl || item.sourceUrl || ""),
              })),
          )
        : [...(log.images || [])];
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        updatedAt: log.updatedAt || log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        task: log.task,
        error: log.error,
        deliveryStatus: log.deliveryStatus,
        deliveryError: log.deliveryError,
        images,
        thumbnails: (hydrateImages ? images.map((image) => image.dataUrl) : log.thumbnails || images.map((image) => image.dataUrl)).filter(Boolean),
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        updatedAt: log.updatedAt || Date.now(),
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

function logTaskEvent(event: string, log: Pick<GenerationLog, "id" | "task" | "status" | "images">, details: Record<string, unknown> = {}) {
    console.info("[canvas-image-task]", {
        event,
        logId: log.id,
        taskId: log.task?.id,
        status: log.status,
        imageCount: log.images.length,
        ...details,
    });
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
    task,
    error,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    task?: ManagedImageGenerationTask;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        task,
        error,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        deliveryStatus: images.length ? (images.some((image) => image.deliveryError) ? "pending" : "stored") : undefined,
    };
}

function mergeLogs(remote: GenerationLog[], local: GenerationLog[]) {
    const merged = new Map(remote.map((log) => [log.id, log]));
    for (const log of local) {
        const current = merged.get(log.id);
        if (!current || (current.status === "pending" && log.status !== "pending" && (log.images.length || log.error))) merged.set(log.id, log);
    }
    return Array.from(merged.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
