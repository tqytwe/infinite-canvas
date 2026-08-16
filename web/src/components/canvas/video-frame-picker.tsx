/**
 * Video Frame Picker Component
 *
 * Phase 2.3: 视频帧提取UI
 * - 上传视频文件
 * - 显示帧缩略图网格
 * - 选择帧作为参考图
 */

import { useState } from "react";
import { Upload, Loader2, Check } from "lucide-react";
import { extractFramesFromVideo, formatTimestamp, type VideoFrame } from "@/utils/video-frame-extractor";

export interface VideoFramePickerProps {
    onFrameSelect: (frame: VideoFrame) => void;
    onClose?: () => void;
    maxFrames?: number;
}

export function VideoFramePicker({
    onFrameSelect,
    onClose,
    maxFrames = 12,
}: VideoFramePickerProps) {
    const [isExtracting, setIsExtracting] = useState(false);
    const [frames, setFrames] = useState<VideoFrame[]>([]);
    const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("video/")) {
            setError("请选择视频文件");
            return;
        }

        setIsExtracting(true);
        setError(null);
        setFrames([]);
        setSelectedFrameId(null);

        try {
            const extractedFrames = await extractFramesFromVideo(file, {
                mode: "uniform",
                count: maxFrames,
                maxWidth: 512,
                maxHeight: 512,
            });

            setFrames(extractedFrames);
        } catch (err) {
            setError(err instanceof Error ? err.message : "提取帧失败");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleFrameClick = (frame: VideoFrame) => {
        setSelectedFrameId(frame.id);
    };

    const handleConfirm = () => {
        const selectedFrame = frames.find((f) => f.id === selectedFrameId);
        if (selectedFrame) {
            onFrameSelect(selectedFrame);
            onClose?.();
        }
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    backgroundColor: "white",
                    borderRadius: "12px",
                    padding: "2rem",
                    width: "90%",
                    maxWidth: "900px",
                    maxHeight: "90vh",
                    overflowY: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 style={{ marginBottom: "1.5rem", fontSize: "20px", fontWeight: "600" }}>
                    视频帧提取
                </h2>

                {/* 上传区域 */}
                {frames.length === 0 && !isExtracting && (
                    <div
                        style={{
                            border: "2px dashed #d1d5db",
                            borderRadius: "8px",
                            padding: "3rem",
                            textAlign: "center",
                            cursor: "pointer",
                            backgroundColor: "#f9fafb",
                        }}
                        onClick={() => document.getElementById("video-file-input")?.click()}
                    >
                        <Upload size={48} style={{ margin: "0 auto 1rem", color: "#9ca3af" }} />
                        <p style={{ marginBottom: "0.5rem", color: "#374151" }}>
                            点击或拖拽上传视频文件
                        </p>
                        <p style={{ fontSize: "14px", color: "#6b7280" }}>
                            支持 MP4, MOV, AVI 等格式
                        </p>
                        <input
                            id="video-file-input"
                            type="file"
                            accept="video/*"
                            style={{ display: "none" }}
                            onChange={handleFileSelect}
                        />
                    </div>
                )}

                {/* 提取中 */}
                {isExtracting && (
                    <div style={{ textAlign: "center", padding: "3rem" }}>
                        <Loader2 size={48} style={{ margin: "0 auto 1rem", color: "#3b82f6", animation: "spin 1s linear infinite" }} />
                        <p style={{ color: "#6b7280" }}>正在提取视频帧...</p>
                    </div>
                )}

                {/* 错误提示 */}
                {error && (
                    <div
                        style={{
                            padding: "1rem",
                            backgroundColor: "#fef2f2",
                            color: "#dc2626",
                            borderRadius: "8px",
                            marginBottom: "1rem",
                        }}
                    >
                        {error}
                    </div>
                )}

                {/* 帧网格 */}
                {frames.length > 0 && (
                    <>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                                gap: "1rem",
                                marginBottom: "1.5rem",
                            }}
                        >
                            {frames.map((frame) => (
                                <div
                                    key={frame.id}
                                    style={{
                                        position: "relative",
                                        cursor: "pointer",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        border: selectedFrameId === frame.id ? "3px solid #3b82f6" : "1px solid #e5e7eb",
                                        transition: "all 0.2s",
                                    }}
                                    onClick={() => handleFrameClick(frame)}
                                >
                                    <img
                                        src={frame.dataUrl}
                                        alt={`Frame at ${formatTimestamp(frame.timestamp)}`}
                                        style={{
                                            width: "100%",
                                            height: "auto",
                                            display: "block",
                                        }}
                                    />

                                    {/* 时间戳 */}
                                    <div
                                        style={{
                                            position: "absolute",
                                            bottom: "0.5rem",
                                            right: "0.5rem",
                                            padding: "0.25rem 0.5rem",
                                            backgroundColor: "rgba(0, 0, 0, 0.7)",
                                            color: "white",
                                            fontSize: "12px",
                                            borderRadius: "4px",
                                        }}
                                    >
                                        {formatTimestamp(frame.timestamp)}
                                    </div>

                                    {/* 选中标记 */}
                                    {selectedFrameId === frame.id && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: "0.5rem",
                                                left: "0.5rem",
                                                backgroundColor: "#3b82f6",
                                                color: "white",
                                                borderRadius: "50%",
                                                padding: "0.25rem",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <Check size={16} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* 操作按钮 */}
                        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: "0.5rem 1rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                    backgroundColor: "white",
                                    cursor: "pointer",
                                }}
                            >
                                取消
                            </button>
                            <button
                                onClick={() => document.getElementById("video-file-input")?.click()}
                                style={{
                                    padding: "0.5rem 1rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                    backgroundColor: "white",
                                    cursor: "pointer",
                                }}
                            >
                                选择其他视频
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={!selectedFrameId}
                                style={{
                                    padding: "0.5rem 1rem",
                                    borderRadius: "6px",
                                    border: "none",
                                    backgroundColor: selectedFrameId ? "#3b82f6" : "#e5e7eb",
                                    color: selectedFrameId ? "white" : "#9ca3af",
                                    cursor: selectedFrameId ? "pointer" : "not-allowed",
                                }}
                            >
                                使用选中帧
                            </button>
                        </div>
                    </>
                )}
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
