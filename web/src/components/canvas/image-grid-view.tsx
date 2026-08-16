/**
 * Image Grid View Component
 * 
 * 批量生图结果网格展示
 * - 自动布局（2x2, 3x3等）
 * - 悬停显示操作按钮
 * - 支持多选和批量操作
 */

import { useState } from "react";
import { Download, Trash2, Plus, Copy } from "lucide-react";

export interface ImageGridItem {
    id: string;
    dataUrl: string;
    width?: number;
    height?: number;
}

export interface ImageGridViewProps {
    images: ImageGridItem[];
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
    onAddToCanvas?: (id: string) => void;
    onDownload?: (id: string) => void;
    onCopyPrompt?: (id: string) => void;
    selectedIds?: Set<string>;
    className?: string;
}

export function ImageGridView({
    images,
    onSelect,
    onDelete,
    onAddToCanvas,
    onDownload,
    onCopyPrompt,
    selectedIds = new Set(),
    className = "",
}: ImageGridViewProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // 计算网格布局
    const gridCols = calculateGridColumns(images.length);

    return (
        <div
            className={`image-grid-view ${className}`}
            style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                gap: "1rem",
                padding: "1rem",
            }}
        >
            {images.map((image) => (
                <div
                    key={image.id}
                    className="image-grid-item"
                    style={{
                        position: "relative",
                        aspectRatio: "1",
                        borderRadius: "8px",
                        overflow: "hidden",
                        border: selectedIds.has(image.id) ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                        cursor: "pointer",
                    }}
                    onMouseEnter={() => setHoveredId(image.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                            onSelect?.(image.id);
                        }
                    }}
                >
                    {/* 图片 */}
                    <img
                        src={image.dataUrl}
                        alt="Generated"
                        style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                        }}
                    />

                    {/* 选中标记 */}
                    {selectedIds.has(image.id) && (
                        <div
                            style={{
                                position: "absolute",
                                top: "8px",
                                left: "8px",
                                width: "24px",
                                height: "24px",
                                borderRadius: "50%",
                                backgroundColor: "#3b82f6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "white",
                                fontSize: "14px",
                                fontWeight: "bold",
                            }}
                        >
                            ✓
                        </div>
                    )}

                    {/* 操作按钮组 */}
                    {hoveredId === image.id && (
                        <div
                            style={{
                                position: "absolute",
                                bottom: "0",
                                left: "0",
                                right: "0",
                                background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                                padding: "0.5rem",
                                display: "flex",
                                gap: "0.5rem",
                                justifyContent: "center",
                            }}
                        >
                            {onAddToCanvas && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAddToCanvas(image.id);
                                    }}
                                    style={actionButtonStyle}
                                    title="添加到画布"
                                >
                                    <Plus size={16} />
                                </button>
                            )}

                            {onDownload && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDownload(image.id);
                                    }}
                                    style={actionButtonStyle}
                                    title="下载"
                                >
                                    <Download size={16} />
                                </button>
                            )}

                            {onCopyPrompt && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCopyPrompt(image.id);
                                    }}
                                    style={actionButtonStyle}
                                    title="复制提示词"
                                >
                                    <Copy size={16} />
                                </button>
                            )}

                            {onDelete && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm("确定删除这张图片？")) {
                                            onDelete(image.id);
                                        }
                                    }}
                                    style={{ ...actionButtonStyle, backgroundColor: "#ef4444" }}
                                    title="删除"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

/**
 * 计算最优网格列数
 */
function calculateGridColumns(count: number): number {
    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count <= 4) return 2; // 2x2
    if (count <= 6) return 3; // 2x3 or 3x2
    if (count <= 9) return 3; // 3x3
    if (count <= 12) return 4; // 3x4 or 4x3
    return 4; // 4xN
}

const actionButtonStyle: React.CSSProperties = {
    padding: "0.5rem",
    borderRadius: "4px",
    border: "none",
    backgroundColor: "#3b82f6",
    color: "white",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.2s",
};
