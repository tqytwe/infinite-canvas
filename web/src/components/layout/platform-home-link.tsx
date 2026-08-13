import { Home } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { CANVAS_PLATFORM_WEB_URL } from "@/constant/runtime-config";
import { cn } from "@/lib/utils";

type PlatformHomeLinkProps = {
    className?: string;
    style?: CSSProperties;
};

export function PlatformHomeLink({ className, style }: PlatformHomeLinkProps) {
    const { t } = useTranslation();
    const label = t("topNav.returnPlatform");

    return (
        <a
            className={cn("inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4", className)}
            style={style}
            href={CANVAS_PLATFORM_WEB_URL}
            aria-label={label}
            title={label}
        >
            <Home className="size-4" />
        </a>
    );
}
