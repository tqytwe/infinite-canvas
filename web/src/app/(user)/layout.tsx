"use client";

import { Suspense, useEffect, useRef, type ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { fetchUserConfig } from "@/services/api/user-config";
import { useUserStore } from "@/stores/use-user-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <Suspense fallback={null}>
            <UserLayoutContent>{children}</UserLayoutContent>
        </Suspense>
    );
}

function UserLayoutContent({ children }: { children: ReactNode }) {
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const wasLoggedOutRef = useRef(false);

    useEffect(() => {
        if (!isReady) return;
        if (!user) {
            wasLoggedOutRef.current = true;
            return;
        }
        const syncCanvasAfterLogin = wasLoggedOutRef.current;
        const token = useUserStore.getState().token;
        if (!token) return;
        wasLoggedOutRef.current = false;
        fetchUserConfig(token)
            .then(async (config) => {
                const syncEnabled = config.syncCapabilities?.userData === true;
                const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                const canvasStore = useCanvasStore.getState();
                canvasStore.setSyncEnabled(syncEnabled);
                if (syncCanvasAfterLogin && syncEnabled && canvasStore.hydrated) {
                    void canvasStore.syncWithRemote(token, true);
                }
                const { useAssetStore } = await import("@/stores/use-asset-store");
                void useAssetStore.getState().hydrateAccountAssets(token, syncEnabled);
            })
            .catch(() => {});
    }, [isReady, user]);

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <AppTopNav />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
