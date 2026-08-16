/**
 * Image Studio Mirror Worker
 * 
 * Canvas服务端后台Worker，负责：
 * 1. 定期检查Image Studio已完成的任务
 * 2. 自动镜像文件到 /data/infinite-canvas
 * 3. 更新镜像状态
 * 
 * 这样浏览器不需要轮询和中转大文件
 */

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MIRROR_STATE_FILE = "/data/infinite-canvas/.image-studio-mirror-state.json";
const CHECK_INTERVAL_MS = 5000; // 5秒检查一次
const PLATFORM_API_BASE = process.env.PLATFORM_API_BASE_URL || "http://localhost:3009";

export class ImageStudioMirrorWorker {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.state = { jobs: {} }; // { jobId: { status, assets: [...] } }
        this.running = false;
        this.timer = null;
    }

    async start() {
        if (this.running) return;
        this.running = true;
        
        await this.loadState();
        console.log("[ImageStudioWorker] Started");
        
        this.timer = setInterval(() => {
            this.checkPendingJobs().catch(err => {
                console.error("[ImageStudioWorker] Check failed:", err);
            });
        }, CHECK_INTERVAL_MS);
        
        // 立即执行一次
        await this.checkPendingJobs();
    }

    async stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log("[ImageStudioWorker] Stopped");
    }

    async loadState() {
        try {
            const content = await readFile(MIRROR_STATE_FILE, "utf-8");
            this.state = JSON.parse(content);
        } catch {
            this.state = { jobs: {} };
        }
    }

    async saveState() {
        try {
            await writeFile(MIRROR_STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
        } catch (err) {
            console.error("[ImageStudioWorker] Save state failed:", err);
        }
    }

    async checkPendingJobs() {
        // 查询用户的活跃任务（需要用户的session token）
        // 这里简化处理：检查最近的任务
        
        // TODO: 需要维护一个"待镜像任务队列"
        // 当前先跳过，因为需要用户session才能调用Image Studio API
        
        console.log("[ImageStudioWorker] Check cycle (simplified)");
    }

    /**
     * 镜像单个任务的所有资产
     */
    async mirrorJob(userId, jobId, assets, sessionToken) {
        const jobState = this.state.jobs[jobId] || {
            status: "pending",
            userId,
            assets: {},
            createdAt: new Date().toISOString(),
        };

        for (const asset of assets) {
            if (jobState.assets[asset.id]?.status === "completed") {
                continue; // 已镜像，跳过
            }

            try {
                const localPath = await this.mirrorAsset(userId, asset, sessionToken);
                jobState.assets[asset.id] = {
                    status: "completed",
                    localPath,
                    mirroredAt: new Date().toISOString(),
                    bytes: asset.bytes,
                };
                console.log(`[ImageStudioWorker] Mirrored asset ${asset.id} -> ${localPath}`);
            } catch (err) {
                jobState.assets[asset.id] = {
                    status: "failed",
                    error: String(err),
                    attemptedAt: new Date().toISOString(),
                };
                console.error(`[ImageStudioWorker] Mirror asset ${asset.id} failed:`, err);
            }
        }

        // 检查是否所有资产都已镜像
        const allCompleted = assets.every(a => jobState.assets[a.id]?.status === "completed");
        jobState.status = allCompleted ? "completed" : "partial";
        jobState.updatedAt = new Date().toISOString();

        this.state.jobs[jobId] = jobState;
        await this.saveState();

        return jobState;
    }

    /**
     * 镜像单个资产文件
     */
    async mirrorAsset(userId, asset, sessionToken) {
        // 1. 从Image Studio下载文件
        const url = `${PLATFORM_API_BASE}/api/v1/nextchat/image-studio/assets/${asset.id}/content`;
        const response = await fetch(url, {
            headers: {
                Authorization: sessionToken,
            },
        });

        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // 2. 计算hash作为文件名
        const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
        const ext = asset.mimeType === "image/png" ? ".png" : ".jpg";
        const fileName = `${hash}${ext}`;

        // 3. 保存到用户目录
        const userDir = join(this.dataDir, "users", userId, "image-studio-mirrors");
        await mkdir(userDir, { recursive: true, mode: 0o700 });

        const localPath = join(userDir, fileName);
        await writeFile(localPath, buffer, { mode: 0o600 });

        // 4. 验证文件
        const stats = await stat(localPath);
        if (stats.size !== buffer.length) {
            throw new Error("File size mismatch after write");
        }

        return `users/${userId}/image-studio-mirrors/${fileName}`;
    }

    /**
     * 获取任务镜像状态
     */
    getJobMirrorState(jobId) {
        return this.state.jobs[jobId] || null;
    }

    /**
     * 手动触发镜像（API调用）
     */
    async triggerMirror(userId, jobId, assets, sessionToken) {
        console.log(`[ImageStudioWorker] Manual trigger for job ${jobId}`);
        return this.mirrorJob(userId, jobId, assets, sessionToken);
    }
}

// 单例实例
let workerInstance = null;

export function getImageStudioWorker(dataDir) {
    if (!workerInstance) {
        workerInstance = new ImageStudioMirrorWorker(dataDir);
    }
    return workerInstance;
}
