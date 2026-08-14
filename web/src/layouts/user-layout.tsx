import { lazy, Suspense, type ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { CanvasAccessBanner } from "@/components/layout/canvas-access-banner";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <CanvasAccessBanner />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <Suspense fallback={null}>
                <AgentPanel />
            </Suspense>
        </div>
    );
}
