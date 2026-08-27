"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { createStorageSession, getStorageSessionStatus } from "@/services/api/storage-session";
import { JISUDENG_API_BASE_URL, normalizeLocalChannels, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

// Canvas creation is browser-direct. Canvas account hydration remains only for
// the existing administrator area and never redirects regular visitors.
export function ClientRootInit({ children }: { children: ReactNode }) {
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const apiKey = useConfigStore((state) => normalizeLocalChannels(state.config)[0]?.apiKey || "");
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const restoredKeyRef = useRef("");

    useEffect(() => {
        void loadPublicSettings();
        void hydrateUser();
    }, [hydrateUser, loadPublicSettings]);

    useEffect(() => {
        const key = apiKey.trim();
        if (!key || restoredKeyRef.current === key) return;
        let cancelled = false;
        restoredKeyRef.current = key;
        void getStorageSessionStatus()
            .catch(() => createStorageSession(JISUDENG_API_BASE_URL, key))
            .catch(() => {
                // Settings is the explicit retry path. Never redirect a normal
                // Canvas visitor when an API Key no longer validates.
                if (!cancelled) restoredKeyRef.current = "";
            });
        return () => {
            cancelled = true;
        };
    }, [apiKey]);

    return <>{children}</>;
}
