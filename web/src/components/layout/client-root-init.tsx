"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import { createStorageSession } from "@/services/api/storage-session";
import { normalizeLocalChannels, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

// Canvas creation is browser-direct. Canvas account hydration remains only for
// the existing administrator area and never redirects regular visitors.
export function ClientRootInit({ children }: { children: ReactNode }) {
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const config = useConfigStore((state) => state.config);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const restoredChannelRef = useRef("");
    const storageChannel = useMemo(() => normalizeLocalChannels(config).find((channel) => Boolean(channel.baseUrl.trim() && channel.apiKey.trim())), [config]);

    useEffect(() => {
        void loadPublicSettings();
        void hydrateUser();
    }, [hydrateUser, loadPublicSettings]);

    useEffect(() => {
        if (!storageChannel) return;
        const key = `${storageChannel.baseUrl.trim()}\n${storageChannel.apiKey.trim()}`;
        if (restoredChannelRef.current === key) return;
        let cancelled = false;
        restoredChannelRef.current = key;
        void createStorageSession(storageChannel.baseUrl, storageChannel.apiKey).catch(() => {
            // Settings is the explicit retry path. Never redirect a normal
            // Canvas visitor when an API Key no longer validates.
            if (!cancelled) restoredChannelRef.current = "";
        });
        return () => {
            cancelled = true;
        };
    }, [storageChannel]);

    return <>{children}</>;
}
