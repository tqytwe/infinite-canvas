import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GenerationLog } from "@/types/workbench";

type GenerationHistoryPanelProps = {
    logs: GenerationLog[];
    onSelectLog: (log: GenerationLog) => void;
    onClose: () => void;
};

export function GenerationHistoryPanel({ logs, onSelectLog, onClose }: GenerationHistoryPanelProps) {
    const { t } = useTranslation();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const recentLogs = useMemo(() => {
        return logs
            .filter((log) => log.status === "success" && log.results?.length)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 50);
    }, [logs]);

    if (!mounted) return null;

    return (
        <div className="fixed right-6 top-20 z-[60] flex h-[calc(100vh-160px)] w-80 flex-col rounded-2xl border border-border/70 bg-background/95 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                <div className="flex items-center gap-2">
                    <ImageIcon className="size-4 opacity-60" />
                    <span className="text-sm font-medium">{t("canvas.history.title")}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {recentLogs.length}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("common.close")}
                >
                    <X className="size-4" />
                </button>
            </div>

            <div className="thin-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
                {recentLogs.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                        <ImageIcon className="size-8 opacity-30" />
                        <p>{t("canvas.history.empty")}</p>
                    </div>
                ) : (
                    recentLogs.map((log) => (
                        <HistoryCard key={log.id} log={log} onClick={() => onSelectLog(log)} />
                    ))
                )}
            </div>
        </div>
    );
}

function HistoryCard({ log, onClick }: { log: GenerationLog; onClick: () => void }) {
    const { t } = useTranslation();
    const firstResult = log.results?.[0];
    const thumbnail = firstResult?.url || firstResult?.content;
    const resultCount = log.results?.length || 0;
    const date = new Date(log.createdAt);
    const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return (
        <button
            type="button"
            onClick={onClick}
            className="group relative w-full overflow-hidden rounded-xl border border-border/40 bg-card transition-all hover:border-primary/40 hover:shadow-lg"
        >
            {thumbnail ? (
                <div className="relative aspect-square w-full overflow-hidden bg-muted">
                    <img
                        src={thumbnail}
                        alt={log.prompt || ""}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                    />
                    {resultCount > 1 ? (
                        <div className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
                            {t("canvas.history.images", { count: resultCount })}
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted">
                    <ImageIcon className="size-12 opacity-20" />
                </div>
            )}

            <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-left text-xs leading-relaxed text-foreground/90">
                    {log.prompt || t("canvas.history.noPrompt")}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{timeStr}</span>
                    {log.model ? (
                        <span className="truncate font-mono text-[10px]">{log.model}</span>
                    ) : null}
                </div>
            </div>
        </button>
    );
}

