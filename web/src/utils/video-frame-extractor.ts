/**
 * Video Frame Extractor
 *
 * Phase 2.3: 视频帧提取
 * - 支持上传视频文件
 * - 提取关键帧/均匀采样
 * - 生成缩略图预览
 * - 选择帧作为参考图
 */

export interface VideoFrame {
    id: string;
    dataUrl: string;
    timestamp: number; // 秒
    width: number;
    height: number;
}

export interface ExtractFramesOptions {
    mode: "uniform" | "keyframes";
    count?: number; // uniform模式：提取帧数
    interval?: number; // uniform模式：间隔秒数
    maxWidth?: number; // 缩略图最大宽度
    maxHeight?: number; // 缩略图最大高度
}

/**
 * 从视频文件提取帧
 */
export async function extractFramesFromVideo(
    file: File,
    options: ExtractFramesOptions = { mode: "uniform", count: 10 }
): Promise<VideoFrame[]> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;

        const url = URL.createObjectURL(file);
        video.src = url;

        video.onloadedmetadata = async () => {
            try {
                const duration = video.duration;
                const frames: VideoFrame[] = [];

                if (options.mode === "uniform") {
                    const count = options.count || 10;
                    const interval = duration / count;

                    for (let i = 0; i < count; i++) {
                        const timestamp = i * interval;
                        const frame = await extractFrameAtTime(video, timestamp, options);
                        frames.push(frame);
                    }
                } else {
                    // keyframes模式暂时降级为uniform
                    const count = options.count || 10;
                    const interval = duration / count;

                    for (let i = 0; i < count; i++) {
                        const timestamp = i * interval;
                        const frame = await extractFrameAtTime(video, timestamp, options);
                        frames.push(frame);
                    }
                }

                URL.revokeObjectURL(url);
                resolve(frames);
            } catch (error) {
                URL.revokeObjectURL(url);
                reject(error);
            }
        };

        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load video"));
        };
    });
}

/**
 * 在指定时间点提取帧
 */
async function extractFrameAtTime(
    video: HTMLVideoElement,
    timestamp: number,
    options: ExtractFramesOptions
): Promise<VideoFrame> {
    return new Promise((resolve, reject) => {
        const seekHandler = () => {
            try {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Failed to get canvas context"));
                    return;
                }

                // 计算缩略图尺寸
                const { width, height } = calculateThumbnailSize(
                    video.videoWidth,
                    video.videoHeight,
                    options.maxWidth || 512,
                    options.maxHeight || 512
                );

                canvas.width = width;
                canvas.height = height;

                ctx.drawImage(video, 0, 0, width, height);

                const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

                resolve({
                    id: `frame-${timestamp.toFixed(3)}`,
                    dataUrl,
                    timestamp,
                    width,
                    height,
                });

                video.removeEventListener("seeked", seekHandler);
            } catch (error) {
                reject(error);
            }
        };

        video.addEventListener("seeked", seekHandler);
        video.currentTime = timestamp;
    });
}

/**
 * 计算缩略图尺寸（保持宽高比）
 */
function calculateThumbnailSize(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number } {
    const aspectRatio = originalWidth / originalHeight;

    let width = originalWidth;
    let height = originalHeight;

    if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
    }

    if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
    }

    return {
        width: Math.round(width),
        height: Math.round(height),
    };
}

/**
 * 格式化时间戳为 MM:SS
 */
export function formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
