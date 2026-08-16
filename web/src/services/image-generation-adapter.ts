/**
 * Image Generation Adapter
 * 
 * 提供统一的图片生成接口，支持：
 * 1. 旧方式：浏览器轮询 /v1/images/generations/async
 * 2. 新方式：Image Studio BFF + 服务端镜像
 * 
 * 通过feature flag控制使用哪种方式
 */

import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { requestGeneration, requestEdit } from "./api/image";
import {
    generateImageStudio,
    getImageStudioJob,
    type ImageStudioJob,
} from "./image-studio-client";
import { nanoid } from "nanoid";

export interface GenerationResult {
    images: Array<{ id: string; dataUrl: string }>;
}

/**
 * Feature flag: 是否使用Image Studio BFF
 * 默认false，保持旧行为
 */
const USE_IMAGE_STUDIO_BFF = false; // TODO: 从环境变量或配置读取

/**
 * 统一的图片生成接口
 */
export async function generateImage(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = []
): Promise<GenerationResult> {
    if (USE_IMAGE_STUDIO_BFF) {
        return generateViaImageStudio(config, prompt, references);
    } else {
        return generateViaLegacyAsync(config, prompt, references);
    }
}

/**
 * 新方式：通过Image Studio BFF
 */
async function generateViaImageStudio(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[]
): Promise<GenerationResult> {
    console.log("[ImageStudio] Generating via BFF");
    
    // 1. 提交到Image Studio
    const jobId = await generateImageStudio({
        model: config.imageModel || config.model,
        prompt,
        n: Math.max(1, Math.min(10, Math.floor(Math.abs(Number(config.count)) || 1))),
        quality: config.quality,
        size: config.size,
        background: config.background,
        references: references.map(ref => ({ dataUrl: ref.dataUrl })),
    });
    
    console.log(`[ImageStudio] Job created: ${jobId}`);
    
    // 2. 轮询任务状态（短轮询，最多2分钟）
    const result = await pollImageStudioJob(jobId, 120);
    
    // 3. 触发服务端镜像
    if (result.status === "completed" && result.assets.length > 0) {
        await triggerServerMirror(jobId, result.assets);
    }
    
    // 4. 从服务端镜像读取或直接从URL读取
    const images = await Promise.all(
        result.assets.map(async (asset) => {
            // 尝试从本地镜像读取
            const localUrl = await tryGetLocalMirror(jobId, asset.id);
            if (localUrl) {
                return { id: nanoid(), dataUrl: localUrl };
            }
            
            // 回退到直接下载
            const dataUrl = await fetchAsDataUrl(asset.url);
            return { id: nanoid(), dataUrl };
        })
    );
    
    return { images };
}

/**
 * 旧方式：使用现有的requestGeneration/requestEdit
 */
async function generateViaLegacyAsync(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[]
): Promise<GenerationResult> {
    console.log("[Legacy] Generating via existing API");
    
    const images = references.length > 0
        ? await requestEdit(config, prompt, references)
        : await requestGeneration(config, prompt);
    
    return { images };
}

/**
 * 轮询Image Studio任务
 */
async function pollImageStudioJob(
    jobId: string,
    maxWaitSeconds: number
): Promise<ImageStudioJob> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;
    
    while (true) {
        const job = await getImageStudioJob(jobId);
        
        if (job.status === "completed") {
            return job;
        }
        
        if (job.status === "failed") {
            throw new Error(job.error || "Generation failed");
        }
        
        if (Date.now() - startTime > maxWaitMs) {
            throw new Error("Generation timeout");
        }
        
        // 等待3秒再查询
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

/**
 * 触发服务端镜像
 */
async function triggerServerMirror(jobId: string, assets: any[]): Promise<void> {
    try {
        const response = await fetch("/api/image-studio/mirror", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, assets }),
        });
        
        if (!response.ok) {
            console.warn("[ImageStudio] Mirror trigger failed:", response.status);
        } else {
            console.log("[ImageStudio] Mirror triggered for job:", jobId);
        }
    } catch (err) {
        console.warn("[ImageStudio] Mirror trigger error:", err);
    }
}

/**
 * 尝试从本地镜像读取
 */
async function tryGetLocalMirror(jobId: string, assetId: string): Promise<string | null> {
    try {
        // TODO: 查询服务端镜像状态API
        return null;
    } catch {
        return null;
    }
}

/**
 * 从URL获取DataURL
 */
async function fetchAsDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
