/**
 * Generation Parameters Floating Panel
 *
 * Phase 2.4: 生图参数悬浮面板
 * - 显示当前生成任务的参数
 * - 悬浮/固定/最小化
 * - 实时更新进度
 */

import { useState } from "react";
import { X, Minimize2, Maximize2, Pin } from "lucide-react";

export interface GenerationParams {
    model: string;
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    sampler?: string;
    batchSize?: number;
    [key: string]: any;
}

export interface GenerationProgress {
    status: "pending" | "running" | "completed" | "failed";
    progress?: number; // 0-100
    currentStep?: number;
    totalSteps?: number;
    elapsedTime?: number; // 秒
    estimatedTime?: number; // 秒
}

export interface GenerationParamsPanelProps {
    params: GenerationParams;
    progress?: GenerationProgress;
    onClose?: () => void;
    initialPosition?: { x: number; y: number };
    initialPinned?: boolean;
}

export function GenerationParamsPanel({
    params,
    progress,
    onClose,
    initialPosition = { x: 20, y: 100 },
    initialPinned = false,
}: GenerationParamsPanelProps) {
    const [position, setPosition] = useState(initialPosition);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isMinimized, setIsMinimized] = useState(false);
    const [isPinned, setIsPinned] = useState(initialPinned);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isPinned) return;
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y,
        });
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging || isPinned) return;
        setPosition({
            x: e.clientX - dragOffset.x,
            y: e.clientY - dragOffset.y,
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // 注册全局鼠标事件
    useState(() => {
        document.addEventListener("mousemove", handleMouseMove as any);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove as any);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    });

    const statusColors = {
        pending: "#6b7280",
        running: "#3b82f6",
        completed: "#10b981",
        failed: "#ef4444",
    };

    const statusLabels = {
        pending: "等待中",
        running: "生成中",
        completed: "已完成",
        failed: "失败",
    };

    return (
        <div
            style={{
                position: "fixed",
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: "320px",
                backgroundColor: "white",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                zIndex: 1000,
                border: "1px solid #e5e7eb",
            }}
        >
            {/* 标题栏 */}
            <div
                style={{
                    padding: "0.75rem 1rem",
                    backgroundColor: "#f9fafb",
                    borderBottom: "1px solid #e5e7eb",
                    borderRadius: "8px 8px 0 0",
                    cursor: isPinned ? "default" : "move",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
                onMouseDown={handleMouseDown}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div
                        style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: progress ? statusColors[progress.status] : "#6b7280",
                        }}
                    />
                    <span style={{ fontSize: "14px", fontWeight: "600", color: "#374151" }}>
                        生成参数
                    </span>
                    {progress && (
                        <span style={{ fontSize: "12px", color: "#6b7280" }}>
                            {statusLabels[progress.status]}
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", gap: "0.25rem" }}>
                    <button
                        onClick={() => setIsPinned(!isPinned)}
                        style={{
                            padding: "0.25rem",
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: isPinned ? "#3b82f6" : "#6b7280",
                        }}
                        title={isPinned ? "取消固定" : "固定"}
                    >
                        <Pin size={14} />
                    </button>
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        style={{
                            padding: "0.25rem",
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: "#6b7280",
                        }}
                        title={isMinimized ? "展开" : "最小化"}
                    >
                        {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "0.25rem",
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: "#6b7280",
                        }}
                        title="关闭"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* 内容区域 */}
            {!isMinimized && (
                <div style={{ padding: "1rem", maxHeight: "500px", overflowY: "auto" }}>
                    {/* 进度条 */}
                    {progress && progress.status === "running" && progress.progress !== undefined && (
                        <div style={{ marginBottom: "1rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                                <span style={{ fontSize: "12px", color: "#6b7280" }}>进度</span>
                                <span style={{ fontSize: "12px", color: "#374151", fontWeight: "500" }}>
                                    {progress.progress.toFixed(0)}%
                                </span>
                            </div>
                            <div
                                style={{
                                    width: "100%",
                                    height: "6px",
                                    backgroundColor: "#e5e7eb",
                                    borderRadius: "3px",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        width: `${progress.progress}%`,
                                        height: "100%",
                                        backgroundColor: "#3b82f6",
                                        transition: "width 0.3s ease",
                                    }}
                                />
                            </div>
                            {progress.currentStep !== undefined && progress.totalSteps !== undefined && (
                                <div style={{ marginTop: "0.25rem", fontSize: "11px", color: "#9ca3af" }}>
                                    Step {progress.currentStep} / {progress.totalSteps}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 参数列表 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <ParamItem label="模型" value={params.model} />
                        <ParamItem label="提示词" value={params.prompt} multiline />
                        {params.negativePrompt && (
                            <ParamItem label="负面提示词" value={params.negativePrompt} multiline />
                        )}
                        <ParamItem label="尺寸" value={`${params.width} × ${params.height}`} />
                        {params.steps !== undefined && <ParamItem label="步数" value={params.steps} />}
                        {params.cfgScale !== undefined && <ParamItem label="CFG Scale" value={params.cfgScale} />}
                        {params.seed !== undefined && <ParamItem label="种子" value={params.seed} />}
                        {params.sampler && <ParamItem label="采样器" value={params.sampler} />}
                        {params.batchSize !== undefined && params.batchSize > 1 && (
                            <ParamItem label="批次大小" value={params.batchSize} />
                        )}
                    </div>

                    {/* 时间信息 */}
                    {progress && (progress.elapsedTime !== undefined || progress.estimatedTime !== undefined) && (
                        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #e5e7eb" }}>
                            {progress.elapsedTime !== undefined && (
                                <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "0.25rem" }}>
                                    已用时间: {formatTime(progress.elapsedTime)}
                                </div>
                            )}
                            {progress.estimatedTime !== undefined && progress.status === "running" && (
                                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                                    预计剩余: {formatTime(progress.estimatedTime)}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

interface ParamItemProps {
    label: string;
    value: string | number;
    multiline?: boolean;
}

function ParamItem({ label, value, multiline = false }: ParamItemProps) {
    return (
        <div>
            <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "0.25rem", fontWeight: "500" }}>
                {label}
            </div>
            <div
                style={{
                    fontSize: "13px",
                    color: "#374151",
                    wordBreak: "break-word",
                    ...(multiline && {
                        maxHeight: "60px",
                        overflowY: "auto",
                        lineHeight: "1.4",
                    }),
                }}
            >
                {value}
            </div>
        </div>
    );
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
}
