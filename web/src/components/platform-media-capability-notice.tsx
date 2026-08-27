import { AlertCircle } from "lucide-react";
import { Button } from "antd";

export function PlatformMediaCapabilityNotice({ capability, message, loading, onReload }: { capability: "图片" | "视频"; message: string; loading: boolean; onReload: () => void }) {
    return (
        <div className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100" role="status" aria-live="polite">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
                {capability}能力暂不可用：{message}
            </span>
            <Button size="small" loading={loading} onClick={onReload}>
                重新加载
            </Button>
        </div>
    );
}
