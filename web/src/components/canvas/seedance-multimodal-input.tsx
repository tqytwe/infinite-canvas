/**
 * Seedance Multimodal Reference Support
 *
 * Phase 2.7: Seedance多模态参考
 * - 支持图片+音频/视频作为参考
 * - 多模态输入组合
 * - Seedance模型专用参数
 */

import { useState } from "react";
import { Image, Music, Video, X, Upload } from "lucide-react";

export interface SeedanceReference {
    image?: {
        dataUrl: string;
        weight?: number;
    };
    audio?: {
        dataUrl: string;
        weight?: number;
    };
    video?: {
        dataUrl: string;
        weight?: number;
    };
}

export interface SeedanceMultimodalInputProps {
    value: SeedanceReference;
    onChange: (value: SeedanceReference) => void;
    className?: string;
}

export function SeedanceMultimodalInput({
    value,
    onChange,
    className = "",
}: SeedanceMultimodalInputProps) {
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith("image/")) return;

        const dataUrl = await fileToDataUrl(file);
        onChange({
            ...value,
            image: { dataUrl, weight: value.image?.weight || 1.0 },
        });
    };

    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith("audio/")) return;

        const dataUrl = await fileToDataUrl(file);
        onChange({
            ...value,
            audio: { dataUrl, weight: value.audio?.weight || 1.0 },
        });
    };

    const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith("video/")) return;

        const dataUrl = await fileToDataUrl(file);
        onChange({
            ...value,
            video: { dataUrl, weight: value.video?.weight || 1.0 },
        });
    };

    const handleWeightChange = (type: "image" | "audio" | "video", weight: number) => {
        onChange({
            ...value,
            [type]: value[type] ? { ...value[type], weight } : undefined,
        });
    };

    const handleRemove = (type: "image" | "audio" | "video") => {
        const newValue = { ...value };
        delete newValue[type];
        onChange(newValue);
    };

    return (
        <div className={className} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ fontSize: "14px", fontWeight: "500", color: "#374151", marginBottom: "0.5rem" }}>
                Seedance 多模态参考
            </div>

            {/* 图片参考 */}
            <div
                style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "1rem",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <Image size={18} color="#3b82f6" />
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "#374151" }}>图片参考</span>
                </div>

                {value.image ? (
                    <div>
                        <div style={{ position: "relative", marginBottom: "0.75rem" }}>
                            <img
                                src={value.image.dataUrl}
                                alt="参考图片"
                                style={{
                                    width: "100%",
                                    maxHeight: "200px",
                                    objectFit: "contain",
                                    borderRadius: "6px",
                                }}
                            />
                            <button
                                onClick={() => handleRemove("image")}
                                style={{
                                    position: "absolute",
                                    top: "0.5rem",
                                    right: "0.5rem",
                                    padding: "0.25rem",
                                    backgroundColor: "rgba(0,0,0,0.7)",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div>
                            <label style={{ fontSize: "12px", color: "#6b7280", marginBottom: "0.25rem", display: "block" }}>
                                权重: {value.image.weight?.toFixed(1) || "1.0"}
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="2"
                                step="0.1"
                                value={value.image.weight || 1.0}
                                onChange={(e) => handleWeightChange("image", parseFloat(e.target.value))}
                                style={{ width: "100%" }}
                            />
                        </div>
                    </div>
                ) : (
                    <label
                        style={{
                            display: "block",
                            padding: "2rem",
                            border: "2px dashed #d1d5db",
                            borderRadius: "6px",
                            textAlign: "center",
                            cursor: "pointer",
                            backgroundColor: "#f9fafb",
                        }}
                    >
                        <Upload size={24} style={{ margin: "0 auto 0.5rem", color: "#9ca3af" }} />
                        <span style={{ fontSize: "13px", color: "#6b7280" }}>点击上传图片</span>
                        <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={handleImageUpload}
                        />
                    </label>
                )}
            </div>

            {/* 音频参考 */}
            <div
                style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "1rem",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <Music size={18} color="#10b981" />
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "#374151" }}>音频参考</span>
                    <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "auto" }}>可选</span>
                </div>

                {value.audio ? (
                    <div>
                        <div style={{ marginBottom: "0.75rem", position: "relative" }}>
                            <audio
                                src={value.audio.dataUrl}
                                controls
                                style={{ width: "100%", height: "40px" }}
                            />
                            <button
                                onClick={() => handleRemove("audio")}
                                style={{
                                    position: "absolute",
                                    top: "0.5rem",
                                    right: "0.5rem",
                                    padding: "0.25rem",
                                    backgroundColor: "rgba(0,0,0,0.7)",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div>
                            <label style={{ fontSize: "12px", color: "#6b7280", marginBottom: "0.25rem", display: "block" }}>
                                权重: {value.audio.weight?.toFixed(1) || "1.0"}
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="2"
                                step="0.1"
                                value={value.audio.weight || 1.0}
                                onChange={(e) => handleWeightChange("audio", parseFloat(e.target.value))}
                                style={{ width: "100%" }}
                            />
                        </div>
                    </div>
                ) : (
                    <label
                        style={{
                            display: "block",
                            padding: "1.5rem",
                            border: "2px dashed #d1d5db",
                            borderRadius: "6px",
                            textAlign: "center",
                            cursor: "pointer",
                            backgroundColor: "#f9fafb",
                        }}
                    >
                        <Upload size={20} style={{ margin: "0 auto 0.5rem", color: "#9ca3af" }} />
                        <span style={{ fontSize: "13px", color: "#6b7280" }}>点击上传音频</span>
                        <input
                            type="file"
                            accept="audio/*"
                            style={{ display: "none" }}
                            onChange={handleAudioUpload}
                        />
                    </label>
                )}
            </div>

            {/* 视频参考 */}
            <div
                style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "1rem",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <Video size={18} color="#f59e0b" />
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "#374151" }}>视频参考</span>
                    <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "auto" }}>可选</span>
                </div>

                {value.video ? (
                    <div>
                        <div style={{ marginBottom: "0.75rem", position: "relative" }}>
                            <video
                                src={value.video.dataUrl}
                                controls
                                style={{
                                    width: "100%",
                                    maxHeight: "200px",
                                    borderRadius: "6px",
                                    backgroundColor: "#000",
                                }}
                            />
                            <button
                                onClick={() => handleRemove("video")}
                                style={{
                                    position: "absolute",
                                    top: "0.5rem",
                                    right: "0.5rem",
                                    padding: "0.25rem",
                                    backgroundColor: "rgba(0,0,0,0.7)",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div>
                            <label style={{ fontSize: "12px", color: "#6b7280", marginBottom: "0.25rem", display: "block" }}>
                                权重: {value.video.weight?.toFixed(1) || "1.0"}
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="2"
                                step="0.1"
                                value={value.video.weight || 1.0}
                                onChange={(e) => handleWeightChange("video", parseFloat(e.target.value))}
                                style={{ width: "100%" }}
                            />
                        </div>
                    </div>
                ) : (
                    <label
                        style={{
                            display: "block",
                            padding: "1.5rem",
                            border: "2px dashed #d1d5db",
                            borderRadius: "6px",
                            textAlign: "center",
                            cursor: "pointer",
                            backgroundColor: "#f9fafb",
                        }}
                    >
                        <Upload size={20} style={{ margin: "0 auto 0.5rem", color: "#9ca3af" }} />
                        <span style={{ fontSize: "13px", color: "#6b7280" }}>点击上传视频</span>
                        <input
                            type="file"
                            accept="video/*"
                            style={{ display: "none" }}
                            onChange={handleVideoUpload}
                        />
                    </label>
                )}
            </div>

            <div
                style={{
                    padding: "0.75rem",
                    backgroundColor: "#eff6ff",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "#1e40af",
                }}
            >
                💡 Seedance 支持多模态参考输入，可组合图片、音频、视频来指导生成
            </div>
        </div>
    );
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
