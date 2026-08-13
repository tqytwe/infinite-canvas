import { Alert, Button, Progress, Space } from "antd";
import { LogIn, UserPlus } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { canvasLoginUrl, canvasRegisterUrl, isCanvasManagedMode, useCanvasSessionStore } from "@/services/canvas-cloud";

function formatBytes(bytes: number) {
    if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function CanvasAccessBanner() {
    const { t } = useTranslation();
    const session = useCanvasSessionStore((state) => state.session);
    const usage = useCanvasSessionStore((state) => state.usage);
    const refreshUsage = useCanvasSessionStore((state) => state.refreshUsage);

    useEffect(() => {
        if (!isCanvasManagedMode() || !session?.authenticated) return;
        void refreshUsage();
        const timer = window.setInterval(() => void refreshUsage(), 30_000);
        return () => window.clearInterval(timer);
    }, [refreshUsage, session?.authenticated]);

    if (!isCanvasManagedMode()) return null;
    if (!session?.authenticated) {
        return (
            <div className="border-b border-amber-200 bg-amber-50 px-6 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-sm text-amber-950 dark:text-amber-100">
                    <span>{t("managedWorkspace.readOnlyHint")}</span>
                    <Space size="small">
                        <Button size="small" icon={<LogIn className="size-3.5" />} href={canvasLoginUrl()}>
                            {t("managedWorkspace.login")}
                        </Button>
                        <Button size="small" type="primary" icon={<UserPlus className="size-3.5" />} href={canvasRegisterUrl()}>
                            {t("managedWorkspace.register")}
                        </Button>
                    </Space>
                </div>
            </div>
        );
    }

    if (!usage) return null;
    const percent = usage.max_bytes ? Math.min(100, (usage.used_bytes / usage.max_bytes) * 100) : 0;
    return (
        <div className="border-b border-stone-200 bg-background px-6 py-1.5 dark:border-stone-800">
            <div className="mx-auto flex max-w-7xl items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
                <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t("managedWorkspace.storage")}</span>
                <Progress percent={percent} showInfo={false} size="small" className="max-w-44 min-w-24" />
                <span className="shrink-0">
                    {formatBytes(usage.used_bytes)} / {formatBytes(usage.max_bytes)}
                </span>
                <span className="hidden truncate sm:inline">{t("managedWorkspace.storagePolicy")}</span>
            </div>
        </div>
    );
}
