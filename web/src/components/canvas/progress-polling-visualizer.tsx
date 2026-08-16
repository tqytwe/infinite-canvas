/**
 * Progress Polling Visualization
 *
 * Phase 2.5: 进度轮询可视化
 * - 显示后台生成任务队列
 * - 实时更新任务状态
 * - 支持取消任务
 */

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Clock, X } from "lucide-react";

export interface QueuedTask {
    id: string;
    type: "image" | "video";
    model: string;
    prompt: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    progress?: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
}

export interface ProgressPollingVisualizerProps {
    tasks: QueuedTask[];
    onCancelTask?: (taskId: string) => void;
    onRetryTask?: (taskId: string) => void;
    onClearCompleted?: () => void;
    className?: string;
}

export function ProgressPollingVisualizer({
    tasks,
    onCancelTask,
    onRetryTask,
    onClearCompleted,
    className = "",
}: ProgressPollingVisualizerProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const activeTasks = tasks.filter((t) => t.status === "pending" || t.status === "running");
    const completedTasks = tasks.filter((t) => t.status === "completed");
    const failedTasks = tasks.filter((t) => t.status === "failed");

    if (tasks.length === 0) return null;

    return (
        <div
            className={className}
            style={{
                position: "fixed",
                bottom: "20px",
                right: "20px",
                width: "380px",
                backgroundColor: "white",
                borderRadius: "12px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                border: "1px solid #e5e7eb",
                zIndex: 1000,
            }}
        >
            {/* 头部 */}
            <div
                style={{
                    padding: "1rem",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div>
                    <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "0.25rem" }}>
                        生成队列
                    </h3>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                        {activeTasks.length > 0 && `${activeTasks.length} 个进行中`}
                        {activeTasks.length > 0 && completedTasks.length > 0 && " · "}
                        {completedTasks.length > 0 && `${completedTasks.length} 个已完成`}
                        {failedTasks.length > 0 && ` · ${failedTasks.length} 个失败`}
                    </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {completedTasks.length > 0 && onClearCompleted && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onClearCompleted();
                            }}
                            style={{
                                fontSize: "11px",
                                padding: "0.25rem 0.5rem",
                                border: "1px solid #d1d5db",
                                borderRadius: "4px",
                                backgroundColor: "white",
                                cursor: "pointer",
                                color: "#6b7280",
                            }}
                        >
                            清除已完成
                        </button>
                    )}
                    <span style={{ fontSize: "18px", color: "#9ca3af" }}>
                        {isExpanded ? "−" : "+"}
                    </span>
                </div>
            </div>

            {/* 任务列表 */}
            {isExpanded && (
                <div
                    style={{
                        maxHeight: "400px",
                        overflowY: "auto",
                    }}
                >
                    {tasks.map((task) => (
                        <TaskItem
                            key={task.id}
                            task={task}
                            onCancel={onCancelTask}
                            onRetry={onRetryTask}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface TaskItemProps {
    task: QueuedTask;
    onCancel?: (taskId: string) => void;
    onRetry?: (taskId: string) => void;
}

function TaskItem({ task, onCancel, onRetry }: TaskItemProps) {
    const [timeElapsed, setTimeElapsed] = useState(0);

    useEffect(() => {
        if (task.status !== "running") return;

        const startTime = task.startedAt || Date.now();
        const interval = setInterval(() => {
            setTimeElapsed(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);

        return () => clearInterval(interval);
    }, [task.status, task.startedAt]);

    const statusIcons = {
        pending: <Clock size={16} color="#6b7280" />,
        running: <Loader2 size={16} color="#3b82f6" style={{ animation: "spin 1s linear infinite" }} />,
        completed: <CheckCircle2 size={16} color="#10b981" />,
        failed: <XCircle size={16} color="#ef4444" />,
        cancelled: <XCircle size={16} color="#6b7280" />,
    };

    return (
        <div
            style={{
                padding: "1rem",
                borderBottom: "1px solid #f3f4f6",
            }}
        >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                <div style={{ marginTop: "0.125rem" }}>{statusIcons[task.status]}</div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* 任务信息 */}
                    <div style={{ marginBottom: "0.5rem" }}>
                        <div
                            style={{
                                fontSize: "13px",
                                fontWeight: "500",
                                color: "#374151",
                                marginBottom: "0.25rem",
                            }}
                        >
                            {task.model}
                        </div>
                        <div
                            style={{
                                fontSize: "12px",
                                color: "#6b7280",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                            title={task.prompt}
                        >
                            {task.prompt}
                        </div>
                    </div>

                    {/* 进度条 */}
                    {task.status === "running" && task.progress !== undefined && (
                        <div style={{ marginBottom: "0.5rem" }}>
                            <div
                                style={{
                                    width: "100%",
                                    height: "4px",
                                    backgroundColor: "#e5e7eb",
                                    borderRadius: "2px",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        width: `${task.progress}%`,
                                        height: "100%",
                                        backgroundColor: "#3b82f6",
                                        transition: "width 0.3s ease",
                                    }}
                                />
                            </div>
                            <div
                                style={{
                                    marginTop: "0.25rem",
                                    fontSize: "11px",
                                    color: "#9ca3af",
                                    display: "flex",
                                    justifyContent: "space-between",
                                }}
                            >
                                <span>{task.progress.toFixed(0)}%</span>
                                <span>{formatTime(timeElapsed)}</span>
                            </div>
                        </div>
                    )}

                    {/* 错误信息 */}
                    {task.status === "failed" && task.error && (
                        <div
                            style={{
                                fontSize: "11px",
                                color: "#ef4444",
                                marginTop: "0.25rem",
                                padding: "0.5rem",
                                backgroundColor: "#fef2f2",
                                borderRadius: "4px",
                            }}
                        >
                            {task.error}
                        </div>
                    )}

                    {/* 操作按钮 */}
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                        {task.status === "running" && onCancel && (
                            <button
                                onClick={() => onCancel(task.id)}
                                style={{
                                    fontSize: "11px",
                                    padding: "0.25rem 0.5rem",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "4px",
                                    backgroundColor: "white",
                                    cursor: "pointer",
                                    color: "#ef4444",
                                }}
                            >
                                取消
                            </button>
                        )}
                        {task.status === "failed" && onRetry && (
                            <button
                                onClick={() => onRetry(task.id)}
                                style={{
                                    fontSize: "11px",
                                    padding: "0.25rem 0.5rem",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "4px",
                                    backgroundColor: "white",
                                    cursor: "pointer",
                                    color: "#3b82f6",
                                }}
                            >
                                重试
                            </button>
                        )}
                        {task.status === "completed" && task.completedAt && (
                            <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                                {formatTime(Math.floor((task.completedAt - task.createdAt) / 1000))}
                            </span>
                        )}
                    </div>
                </div>
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

function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
}
