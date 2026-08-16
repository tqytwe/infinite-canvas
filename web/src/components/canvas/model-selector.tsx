/**
 * Model Selector Component
 *
 * Phase 3.1: 模型选择器UI
 * - 分类展示模型
 * - 显示模型能力标签
 * - 收藏常用模型
 */

import { useState } from "react";
import { Star, Info } from "lucide-react";
import {
    AVAILABLE_MODELS,
    MODEL_CATEGORIES,
    getModelsByCategory,
    type ModelInfo,
} from "@/config/models";

export interface ModelSelectorProps {
    selectedModelId: string;
    onModelSelect: (modelId: string) => void;
    category?: "all" | "image" | "video" | "audio" | "multimodal";
    showCapabilities?: boolean;
}

export function ModelSelector({
    selectedModelId,
    onModelSelect,
    category = "all",
    showCapabilities = true,
}: ModelSelectorProps) {
    const [activeCategory, setActiveCategory] = useState(category);
    const [favorites, setFavorites] = useState<Set<string>>(
        new Set(JSON.parse(localStorage.getItem("favorite-models") || "[]"))
    );

    const models =
        activeCategory === "all"
            ? AVAILABLE_MODELS
            : getModelsByCategory(activeCategory);

    const toggleFavorite = (modelId: string) => {
        const newFavorites = new Set(favorites);
        if (newFavorites.has(modelId)) {
            newFavorites.delete(modelId);
        } else {
            newFavorites.add(modelId);
        }
        setFavorites(newFavorites);
        localStorage.setItem("favorite-models", JSON.stringify([...newFavorites]));
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* 分类标签 */}
            <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto" }}>
                {MODEL_CATEGORIES.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveCategory(cat.id as any)}
                        style={{
                            padding: "0.5rem 1rem",
                            borderRadius: "6px",
                            border: activeCategory === cat.id ? "2px solid #3b82f6" : "1px solid #d1d5db",
                            backgroundColor: activeCategory === cat.id ? "#eff6ff" : "white",
                            color: activeCategory === cat.id ? "#3b82f6" : "#374151",
                            fontSize: "14px",
                            fontWeight: activeCategory === cat.id ? "600" : "400",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {cat.icon} {cat.label}
                    </button>
                ))}
            </div>

            {/* 模型网格 */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: "1rem",
                }}
            >
                {models.map((model) => (
                    <ModelCard
                        key={model.id}
                        model={model}
                        isSelected={selectedModelId === model.id}
                        isFavorite={favorites.has(model.id)}
                        onSelect={onModelSelect}
                        onToggleFavorite={toggleFavorite}
                        showCapabilities={showCapabilities}
                    />
                ))}
            </div>
        </div>
    );
}

interface ModelCardProps {
    model: ModelInfo;
    isSelected: boolean;
    isFavorite: boolean;
    onSelect: (modelId: string) => void;
    onToggleFavorite: (modelId: string) => void;
    showCapabilities: boolean;
}

function ModelCard({
    model,
    isSelected,
    isFavorite,
    onSelect,
    onToggleFavorite,
    showCapabilities,
}: ModelCardProps) {
    const [showDetails, setShowDetails] = useState(false);

    return (
        <div
            style={{
                border: isSelected ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "1rem",
                backgroundColor: isSelected ? "#eff6ff" : "white",
                cursor: "pointer",
                transition: "all 0.2s",
            }}
            onClick={() => onSelect(model.id)}
        >
            {/* 头部 */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "15px", fontWeight: "600", color: "#374151", marginBottom: "0.25rem" }}>
                        {model.displayName}
                    </div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                        {model.provider}
                    </div>
                </div>

                <div style={{ display: "flex", gap: "0.25rem" }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(model.id);
                        }}
                        style={{
                            padding: "0.25rem",
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: isFavorite ? "#f59e0b" : "#d1d5db",
                        }}
                        title={isFavorite ? "取消收藏" : "收藏"}
                    >
                        <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowDetails(!showDetails);
                        }}
                        style={{
                            padding: "0.25rem",
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: "#6b7280",
                        }}
                        title="详细信息"
                    >
                        <Info size={16} />
                    </button>
                </div>
            </div>

            {/* 描述 */}
            <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "0.75rem", lineHeight: "1.4" }}>
                {model.description}
            </div>

            {/* 标签 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
                {model.tags.map((tag) => (
                    <span
                        key={tag}
                        style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            backgroundColor: "#f3f4f6",
                            color: "#374151",
                            fontSize: "11px",
                            fontWeight: "500",
                        }}
                    >
                        {tag}
                    </span>
                ))}
            </div>

            {/* 能力指示 */}
            {showCapabilities && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "11px", color: "#6b7280" }}>
                    {model.capabilities.supportsReferenceImage && <CapabilityBadge label="参考图" />}
                    {model.capabilities.supportsBatchGeneration && <CapabilityBadge label="批量生成" />}
                    {model.capabilities.supportsMultimodal && <CapabilityBadge label="多模态" />}
                    {model.capabilities.supportsVideoGeneration && <CapabilityBadge label="视频" />}
                </div>
            )}

            {/* 详细信息 */}
            {showDetails && (
                <div
                    style={{
                        marginTop: "0.75rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px solid #e5e7eb",
                        fontSize: "12px",
                        color: "#6b7280",
                    }}
                >
                    <div style={{ marginBottom: "0.5rem" }}>
                        最大分辨率: {model.capabilities.maxResolution.width} × {model.capabilities.maxResolution.height}
                    </div>
                    <div>
                        最大批次: {model.capabilities.maxBatchSize}
                    </div>
                </div>
            )}
        </div>
    );
}

function CapabilityBadge({ label }: { label: string }) {
    return (
        <span
            style={{
                padding: "0.125rem 0.375rem",
                borderRadius: "3px",
                backgroundColor: "#dbeafe",
                color: "#1e40af",
                fontSize: "10px",
                fontWeight: "500",
            }}
        >
            {label}
        </span>
    );
}
