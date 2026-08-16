/**
 * Image Studio BFF Client
 * 
 * 使用主平台Image Studio BFF而非直接调用async接口
 * 优势：
 * - 任务持久化到数据库
 * - 服务端管理队列和历史
 * - 浏览器不需要轮询
 */

export interface ImageStudioAsset {
    id: string;
    url: string;
    thumbnailUrl?: string;
    width: number;
    height: number;
    mimeType: string;
    bytes?: number;
}

export interface ImageStudioJob {
    id: string;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    model: string;
    prompt: string;
    assets: ImageStudioAsset[];
    error?: string;
    createdAt: string;
    completedAt?: string;
    params?: {
        n?: number;
        quality?: string;
        size?: string;
        background?: string;
    };
}

export interface GenerateImageStudioParams {
    model: string;
    prompt: string;
    n?: number;
    quality?: string;
    size?: string;
    background?: string;
    references?: Array<{ dataUrl: string }>;
}

/**
 * 生成图片 - 提交到Image Studio
 * 返回job ID，不再由浏览器轮询
 */
export async function generateImageStudio(params: GenerateImageStudioParams): Promise<string> {
    const endpoint = params.references?.length 
        ? "/api/platform/image-studio/generate-with-references"
        : "/api/platform/image-studio/generate";
    
    const body: Record<string, unknown> = {
        model: params.model,
        prompt: params.prompt,
        n: params.n || 1,
    };
    
    if (params.quality) body.quality = params.quality;
    if (params.size) body.size = params.size;
    if (params.background) body.background = params.background;
    if (params.references?.length) {
        body.references = params.references.map(ref => ({ image: ref.dataUrl }));
    }
    
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Image Studio generate failed: ${error}`);
    }
    
    const result = await response.json() as { job_id?: string; id?: string };
    const jobId = result.job_id || result.id;
    
    if (!jobId) {
        throw new Error("No job ID returned from Image Studio");
    }
    
    return jobId;
}

/**
 * 查询单个任务状态
 */
export async function getImageStudioJob(jobId: string): Promise<ImageStudioJob> {
    const response = await fetch(`/api/platform/image-studio/jobs/${encodeURIComponent(jobId)}`);
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Get Image Studio job failed: ${error}`);
    }
    
    const job = await response.json() as ImageStudioJob;
    return normalizeImageStudioJob(job);
}

/**
 * 查询任务列表
 */
export async function getImageStudioJobs(options?: {
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<ImageStudioJob[]> {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    
    const url = `/api/platform/image-studio/jobs${params.toString() ? `?${params}` : ""}`;
    const response = await fetch(url);
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Get Image Studio jobs failed: ${error}`);
    }
    
    const result = await response.json() as { jobs?: ImageStudioJob[]; data?: ImageStudioJob[] };
    const jobs = result.jobs || result.data || [];
    
    return jobs.map(normalizeImageStudioJob);
}

/**
 * 获取活跃任务列表
 */
export async function getActiveImageStudioJobs(): Promise<ImageStudioJob[]> {
    const response = await fetch("/api/platform/image-studio/jobs/active");
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Get active jobs failed: ${error}`);
    }
    
    const result = await response.json() as { jobs?: ImageStudioJob[]; data?: ImageStudioJob[] };
    const jobs = result.jobs || result.data || [];
    
    return jobs.map(normalizeImageStudioJob);
}

/**
 * 下载资产内容（通过Canvas代理）
 */
export async function getImageStudioAssetContent(assetId: string): Promise<Blob> {
    const response = await fetch(`/api/platform/image-studio/assets/${encodeURIComponent(assetId)}/content`);
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Get asset content failed: ${error}`);
    }
    
    return response.blob();
}

/**
 * 获取资产缩略图
 */
export async function getImageStudioAssetThumbnail(assetId: string): Promise<Blob> {
    const response = await fetch(`/api/platform/image-studio/assets/${encodeURIComponent(assetId)}/thumbnail`);
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Get asset thumbnail failed: ${error}`);
    }
    
    return response.blob();
}

/**
 * 取消任务
 */
export async function cancelImageStudioJob(jobId: string): Promise<void> {
    const response = await fetch(`/api/platform/image-studio/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
    });
    
    if (!response.ok) {
        const error = await response.text().catch(() => "Request failed");
        throw new Error(`Cancel job failed: ${error}`);
    }
}

/**
 * 规范化Job对象（处理不同的字段命名）
 */
function normalizeImageStudioJob(job: any): ImageStudioJob {
    return {
        id: job.id || job.job_id || "",
        status: normalizeStatus(job.status),
        model: job.model || "",
        prompt: job.prompt || "",
        assets: (job.assets || job.results || job.images || []).map(normalizeAsset),
        error: job.error || job.error_message,
        createdAt: job.createdAt || job.created_at || new Date().toISOString(),
        completedAt: job.completedAt || job.completed_at,
        params: {
            n: job.n || job.count,
            quality: job.quality,
            size: job.size || job.dimensions,
            background: job.background,
        },
    };
}

function normalizeStatus(status: string): ImageStudioJob["status"] {
    const lower = String(status || "").toLowerCase();
    if (["completed", "success", "succeeded", "done"].includes(lower)) return "completed";
    if (["failed", "error"].includes(lower)) return "failed";
    if (["processing", "running", "in_progress"].includes(lower)) return "processing";
    if (["cancelled", "canceled"].includes(lower)) return "cancelled";
    return "pending";
}

function normalizeAsset(asset: any): ImageStudioAsset {
    return {
        id: asset.id || asset.asset_id || "",
        url: asset.url || asset.content_url || "",
        thumbnailUrl: asset.thumbnailUrl || asset.thumbnail_url,
        width: asset.width || 1024,
        height: asset.height || 1024,
        mimeType: asset.mimeType || asset.mime_type || "image/png",
        bytes: asset.bytes || asset.size,
    };
}
