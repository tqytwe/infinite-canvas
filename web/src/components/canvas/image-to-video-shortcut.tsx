/**
 * Image to Video Shortcut
 *
 * Phase 2.6: 图转视频快捷入口
 * - 从画布图片节点快速启动视频生成
 * - 自动提取图片作为首帧
 * - 预填充参数
 */

import { useState } from "react";
import { Video, Sparkles, X } from "lucide-react";

export interface ImageToVideoShortcutProps {
    imageUrl: string;
    onGenerate: (params: VideoGenerationParams) => void;
    onClose: () => void;
}

export interface VideoGenerationParams {
    firstFrameImage: string;
    prompt: string;
    duration: number; // 秒
    fps: number;
    motion: "low" | "medium" | "high";
    model?: string;
}

export function ImageToVideoShortcut({
    imageUrl,
    onGenerate,
    onClose,
}: ImageToVideoShortcutProps) {
    const [prompt, setPrompt] = useState("");
    const [duration, setDuration] = useState(4);
    const [fps, setFps] = useState(24);
    const [motion, setMotion] = useState<"low" | "medium" | "high">("medium");

    const handleGenerate = () => {
        onGenerate({
            firstFrameImage: imageUrl,
            prompt,
            duration,
            fps,
            motion,
        });
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
                    maxWidth: "600px",
                    maxHeight: "90vh",
                    overflowY: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 标题 */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Video size={24} color="#3b82f6" />
                        <h2 style={{ fontSize: "20px", fontWeight: "600" }}>图片转视频</h2>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "0.5rem",
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: "#6b7280",
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 预览图 */}
                <div style={{ marginBottom: "1.5rem" }}>
                    <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "0.5rem", color: "#374151" }}>
                        首帧图片
                    </label>
                    <div
                        style={{
                            width: "100%",
                            maxHeight: "300px",
                            borderRadius: "8px",
                            overflow: "hidden",
                            border: "1px solid #e5e7eb",
                        }}
                    >
                        <img
                            src={imageUrl}
                            alt="首帧"
                            style={{
                                width: "100%",
                                height: "auto",
                                display: "block",
                            }}
                        />
                    </div>
                </div>

                {/* 提示词 */}
                <div style={{ marginBottom: "1.5rem" }}>
                    <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "0.5rem", color: "#374151" }}>
                        运动描述
                    </label>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="描述视频中的运动和变化..."
                        style={{
                            width: "100%",
                            minHeight: "100px",
                            padding: "0.75rem",
                            borderRadius: "6px",
                            border: "1px solid #d1d5db",
                            fontSize: "14px",
                            resize: "vertical",
                        }}
                    />
                    <div style={{ marginTop: "0.5rem", fontSize: "12px", color: "#6b7280" }}>
                        💡 提示: 描述相机运动、物体动作、环境变化等
                    </div>
                </div>

                {/* 参数设置 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
                    {/* 时长 */}
                    <div>
                        <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "0.5rem", color: "#374151" }}>
                            视频时长
                        </label>
                        <select
                            value={duration}
                            onChange={(e) => setDuration(Number(e.target.value))}
                            style={{
                                width: "100%",
                                padding: "0.5rem",
                                borderRadius: "6px",
                                border: "1px solid #d1d5db",
                                fontSize: "14px",
                            }}
                        >
                            <option value={2}>2 秒</option>
                            <option value={4}>4 秒</option>
                            <option value={6}>6 秒</option>
                            <option value={8}>8 秒</option>
                            <option value={10}>10 秒</option>
                        </select>
                    </div>

                    {/* 帧率 */}
                    <div>
                        <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "0.5rem", color: "#374151" }}>
                            帧率
                        </label>
                        <select
                            value={fps}
                            onChange={(e) => setFps(Number(e.target.value))}
                            style={{
                                width: "100%",
                                padding: "0.5rem",
                                borderRadius: "6px",
                                border: "1px solid #d1d5db",
                                fontSize: "14px",
                            }}
                        >
                            <option value={12}>12 FPS</option>
                            <option value={24}>24 FPS</option>
                            <option value={30}>30 FPS</option>
                            <option value={60}>60 FPS</option>
                        </select>
                    </div>
                </div>

                {/* 运动幅度 */}
                <div style={{ marginBottom: "2rem" }}>
                    <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "0.75rem", color: "#374151" }}>
                        运动幅度
                    </label>
                    <div style={{ display: "flex", gap: "0.75rem" }}>
                        {(["low", "medium", "high"] as const).map((level) => (
                            <button
                                key={level}
                                onClick={() => setMotion(level)}
                                style={{
                                    flex: 1,
                                    padding: "0.75rem",
                                    borderRadius: "6px",
                                    border: motion === level ? "2px solid #3b82f6" : "1px solid #d1d5db",
                                    backgroundColor: motion === level ? "#eff6ff" : "white",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    color: motion === level ? "#3b82f6" : "#374151",
                                    fontWeight: motion === level ? "600" : "400",
                                }}
                            >
                                {level === "low" && "低 (稳定)"}
                                {level === "medium" && "中 (平衡)"}
                                {level === "high" && "高 (动感)"}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 操作按钮 */}
                <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "0.75rem 1.5rem",
                            borderRadius: "6px",
                            border: "1px solid #d1d5db",
                            backgroundColor: "white",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: "500",
                        }}
                    >
                        取消
                    </button>
                    <button
                        onClick={handleGenerate}
                        style={{
                            padding: "0.75rem 1.5rem",
                            borderRadius: "6px",
                            border: "none",
                            backgroundColor: "#3b82f6",
                            color: "white",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: "500",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                        }}
                    >
                        <Sparkles size={16} />
                        生成视频
                    </button>
                </div>
            </div>
        </div>
    );
}
