/**
 * Reference Image Slots Component
 *
 * 参考图区域固定化
 * - 左侧常驻3-5个参考图槽位
 * - 拖拽图片到槽位
 * - 持久化保存
 * - 点击槽位切换为当前参考
 */

import { useState } from "react";
import { X, Pin, Upload } from "lucide-react";
import type { ReferenceImage } from "@/types/image";

export interface ReferenceSlot {
    id: string;
    image: ReferenceImage | null;
    label?: string;
    pinned: boolean;
}

export interface ReferenceImageSlotsProps {
    slots: ReferenceSlot[];
    activeSlotId?: string;
    onSlotUpdate: (slotId: string, image: ReferenceImage | null) => void;
    onSlotActivate: (slotId: string) => void;
    onSlotPin: (slotId: string, pinned: boolean) => void;
    onSlotLabelChange: (slotId: string, label: string) => void;
    className?: string;
}

export function ReferenceImageSlots({
    slots,
    activeSlotId,
    onSlotUpdate,
    onSlotActivate,
    onSlotPin,
    onSlotLabelChange,
    className = "",
}: ReferenceImageSlotsProps) {
    const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);

    const handleDrop = async (slotId: string, e: React.DragEvent) => {
        e.preventDefault();
        setDragOverSlotId(null);

        const files = Array.from(e.dataTransfer.files);
        const imageFile = files.find(f => f.type.startsWith("image/"));

        if (imageFile) {
            const dataUrl = await fileToDataUrl(imageFile);
            onSlotUpdate(slotId, {
                id: `ref-${Date.now()}`,
                dataUrl,
                width: 0,
                height: 0,
            });
        }
    };

    const handleFileSelect = async (slotId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith("image/")) {
            const dataUrl = await fileToDataUrl(file);
            onSlotUpdate(slotId, {
                id: `ref-${Date.now()}`,
                dataUrl,
                width: 0,
                height: 0,
            });
        }
    };

    return (
        <div className={`reference-image-slots ${className}`} style={{ padding: "1rem" }}>
            <h3 style={{ marginBottom: "1rem", fontSize: "14px", fontWeight: "600", color: "#374151" }}>
                参考图槽位
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {slots.map((slot) => (
                    <div
                        key={slot.id}
                        className="reference-slot"
                        style={{
                            position: "relative",
                            width: "100%",
                            aspectRatio: "1",
                            borderRadius: "8px",
                            border: activeSlotId === slot.id ? "2px solid #3b82f6" : "1px dashed #d1d5db",
                            backgroundColor: dragOverSlotId === slot.id ? "#eff6ff" : "#f9fafb",
                            cursor: "pointer",
                            overflow: "hidden",
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverSlotId(slot.id);
                        }}
                        onDragLeave={() => setDragOverSlotId(null)}
                        onDrop={(e) => handleDrop(slot.id, e)}
                        onClick={() => {
                            if (slot.image) {
                                onSlotActivate(slot.id);
                            }
                        }}
                    >
                        {/* 图片或占位符 */}
                        {slot.image ? (
                            <img
                                src={slot.image.dataUrl}
                                alt={slot.label || "参考图"}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                }}
                            />
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    height: "100%",
                                    color: "#9ca3af",
                                    fontSize: "12px",
                                }}
                            >
                                <Upload size={24} style={{ marginBottom: "0.5rem" }} />
                                <span>拖拽图片</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        opacity: 0,
                                        cursor: "pointer",
                                    }}
                                    onChange={(e) => handleFileSelect(slot.id, e)}
                                />
                            </div>
                        )}

                        {/* 标签 */}
                        {slot.image && (
                            <div
                                style={{
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                                    padding: "0.5rem",
                                    color: "white",
                                    fontSize: "12px",
                                }}
                            >
                                {editingLabelId === slot.id ? (
                                    <input
                                        type="text"
                                        value={slot.label || ""}
                                        onChange={(e) => onSlotLabelChange(slot.id, e.target.value)}
                                        onBlur={() => setEditingLabelId(null)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") setEditingLabelId(null);
                                        }}
                                        autoFocus
                                        style={{
                                            width: "100%",
                                            background: "transparent",
                                            border: "none",
                                            color: "white",
                                            outline: "none",
                                        }}
                                    />
                                ) : (
                                    <div
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingLabelId(slot.id);
                                        }}
                                        style={{ cursor: "text" }}
                                    >
                                        {slot.label || "点击命名"}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 操作按钮 */}
                        {slot.image && (
                            <div
                                style={{
                                    position: "absolute",
                                    top: "0.5rem",
                                    right: "0.5rem",
                                    display: "flex",
                                    gap: "0.25rem",
                                }}
                            >
                                {/* 固定按钮 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSlotPin(slot.id, !slot.pinned);
                                    }}
                                    style={{
                                        padding: "0.25rem",
                                        borderRadius: "4px",
                                        border: "none",
                                        backgroundColor: slot.pinned ? "#3b82f6" : "rgba(255,255,255,0.8)",
                                        color: slot.pinned ? "white" : "#374151",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                    title={slot.pinned ? "取消固定" : "固定"}
                                >
                                    <Pin size={14} />
                                </button>

                                {/* 删除按钮 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm("确定清除这个槽位？")) {
                                            onSlotUpdate(slot.id, null);
                                        }
                                    }}
                                    style={{
                                        padding: "0.25rem",
                                        borderRadius: "4px",
                                        border: "none",
                                        backgroundColor: "rgba(255,255,255,0.8)",
                                        color: "#ef4444",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                    title="清除"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        )}

                        {/* 激活指示器 */}
                        {activeSlotId === slot.id && (
                            <div
                                style={{
                                    position: "absolute",
                                    top: "0.5rem",
                                    left: "0.5rem",
                                    padding: "0.25rem 0.5rem",
                                    borderRadius: "4px",
                                    backgroundColor: "#3b82f6",
                                    color: "white",
                                    fontSize: "10px",
                                    fontWeight: "600",
                                }}
                            >
                                当前参考
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * 文件转DataURL
 */
async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 创建默认槽位
 */
export function createDefaultSlots(count: number = 3): ReferenceSlot[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `slot-${i + 1}`,
        image: null,
        label: undefined,
        pinned: false,
    }));
}
