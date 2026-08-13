import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { createModelChannel, managedWorkspaceConfig, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { CANVAS_MANAGED_MODE } from "@/constant/runtime-config";
import { exchangeCanvasLaunchToken, getCanvasSession, useCanvasSessionStore } from "@/services/canvas-cloud";
import { consumeImagePromptHandoff, storeImagePromptHandoff } from "@/services/creation-intent";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const handledManagedSession = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const setCanvasSession = useCanvasSessionStore((state) => state.refresh);

    usePromptSourceScheduler();

    useEffect(() => {
        if (!CANVAS_MANAGED_MODE || handledManagedSession.current) return;
        handledManagedSession.current = true;
        let cancelled = false;

        const cleanLaunchToken = () => {
            const url = new URL(window.location.href);
            url.searchParams.delete("launch_token");
            url.searchParams.delete("creation_prompt");
            url.searchParams.delete("creation_prompt_version");
            return `${url.pathname}${url.search}${url.hash}`;
        };

        void (async () => {
            const launchToken = new URLSearchParams(window.location.search).get("launch_token")?.trim();
            if (launchToken) {
                try {
                    await exchangeCanvasLaunchToken(launchToken);
                    const promptId = Number(new URLSearchParams(window.location.search).get("creation_prompt"));
                    if (Number.isSafeInteger(promptId) && promptId > 0) {
                        try {
                            const handoff = await consumeImagePromptHandoff(promptId);
                            storeImagePromptHandoff(handoff);
                            if (!cancelled) window.location.replace("/image");
                        } catch (error) {
                            console.error("[canvas-auth] prompt handoff failed", error);
                            if (!cancelled) window.location.replace(cleanLaunchToken());
                        }
                        return;
                    }
                    if (!cancelled) window.location.replace(cleanLaunchToken());
                    return;
                } catch (error) {
                    console.error("[canvas-auth] launch token exchange failed", error);
                }
            }

            try {
                const nextSession = await getCanvasSession();
                if (cancelled) return;
                setCanvasSession(false).catch(() => undefined);
                const managed = managedWorkspaceConfig(nextSession.models);
                if (nextSession.authenticated && nextSession.models) {
                    (Object.keys(managed) as Array<keyof typeof managed>).forEach((key) => {
                        const value = managed[key];
                        if (value !== undefined) updateConfig(key, value as never);
                    });
                } else {
                    updateConfig("baseUrl", "");
                    updateConfig("apiKey", "");
                    updateConfig("channels", []);
                    updateConfig("models", []);
                    updateConfig("model", "");
                    updateConfig("imageModel", "");
                    updateConfig("videoModel", "");
                    updateConfig("textModel", "");
                    updateConfig("audioModel", "");
                }
                await Promise.all([useCanvasStore.persist.rehydrate(), useAssetStore.persist.rehydrate()]);
            } catch (error) {
                console.error("[canvas-auth] session bootstrap failed", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [setCanvasSession, updateConfig]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: t("config.channels.defaultName"), baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success(t("config.importedDirectConfig"));
    }, [config.channels, message, openConfigDialog, t, updateConfig]);

    return <>{children}</>;
}
