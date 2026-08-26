"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { App } from "antd";

import { fetchUserConfig } from "@/services/api/user-config";
import { exchangePlatformLaunchToken } from "@/services/api/auth";
import { defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const setSession = useUserStore((state) => state.setSession);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";
    const platformAuthEnabled = publicSettings?.auth?.platform?.enabled === true;
    const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
    const adminRemoteTokenRef = useRef("");
    const platformLaunchHandledRef = useRef(false);

    const launchErrorCode = (error: unknown): string => {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("未配置") || message.includes("配置")) return "launch_config_missing";
        if (message.includes("暂时不可用") || message.includes("服务") || message.includes("连接失败")) return "launch_platform_unavailable";
        return "launch_token_invalid";
    };

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        const launchToken = new URLSearchParams(window.location.search).get("launch_token")?.trim();
        if (launchToken && !isLoginPage && !platformLaunchHandledRef.current) {
            platformLaunchHandledRef.current = true;
            void exchangePlatformLaunchToken(launchToken)
                .then((session) => {
                    setSession(session.token, session.user);
                    const url = new URL(window.location.href);
                    url.searchParams.delete("launch_token");
                    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
                })
                .catch((error) => {
                    const url = new URL(window.location.href);
                    url.searchParams.delete("launch_token");
                    url.searchParams.delete("launch_error");
                    url.searchParams.set("launch_error", launchErrorCode(error));
                    url.pathname = "/login";
                    url.searchParams.set("redirect", pathname || "/");
                    window.location.replace(`${url.pathname}?${url.searchParams.toString()}`);
                });
            return;
        }
        if (!isLoginPage && !launchToken) void hydrateUser();
    }, [hydrateUser, isLoginPage, pathname, setSession]);

    useEffect(() => {
        if (!platformAuthEnabled || !isReady || user || isLoginPage || isAdminPath) return;
        const redirectTarget = `${pathname}${window.location.search}`;
        window.location.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
    }, [isAdminPath, isLoginPage, isReady, pathname, platformAuthEnabled, user]);

    useEffect(() => {
        if (!token || platformAuthEnabled || user?.role !== "admin" || adminRemoteTokenRef.current === token) return;
        adminRemoteTokenRef.current = token;
        if (channelMode !== "remote") updateConfig("channelMode", "remote");
    }, [channelMode, platformAuthEnabled, token, updateConfig, user?.role]);

    useEffect(() => {
        if (!token || !user?.id) return;
        void fetchUserConfig(token)
            .then((payload) => {
                const syncS3 = payload.modelConfig?.syncStorageConfig === true;
                const syncWebDAV = payload.modelConfig?.syncWebDAVStorageConfig === true;
                if (payload.modelConfig) {
                    Object.entries(payload.modelConfig)
                        .forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
                }
                updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    saveUserStorageProvider({
                        ...defaultUserStorageProvider(),
                        ...payload.storageProvider.s3,
                        type: "s3",
                    });
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    saveUserWebDAVStorageProvider({
                        ...defaultUserWebDAVStorageProvider(),
                        ...payload.storageProvider.webdav,
                        type: "webdav",
                    });
                }
            })
            .catch(() => {});
    }, [token, updateConfig, user?.id]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!publicSettings.modelChannel.allowCustomChannel) {
            openConfigDialog(false);
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    return <>{children}</>;
}
