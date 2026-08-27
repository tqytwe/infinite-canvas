"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { App, Button } from "antd";

import { fetchUserConfig } from "@/services/api/user-config";
import { exchangePlatformLaunchToken } from "@/services/api/auth";
import { defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type PlatformLaunchErrorCode = "launch_config_missing" | "launch_platform_unavailable" | "launch_token_invalid";

function platformLaunchErrorCode(error: unknown): PlatformLaunchErrorCode {
    const text = error instanceof Error ? error.message : "";
    if (text.includes("未配置") || text.includes("配置")) return "launch_config_missing";
    if (text.includes("暂时不可用") || text.includes("服务") || text.includes("连接失败")) return "launch_platform_unavailable";
    return "launch_token_invalid";
}

function parsePlatformLaunchError(value: string | null): PlatformLaunchErrorCode | "" {
    switch (value) {
        case "launch_config_missing":
        case "launch_platform_unavailable":
        case "launch_token_invalid":
            return value;
        default:
            return "";
    }
}

function platformLaunchErrorMessage(code: PlatformLaunchErrorCode): string {
    switch (code) {
        case "launch_config_missing":
            return "创作空间统一登录尚未配置，请联系管理员。";
        case "launch_platform_unavailable":
            return "统一登录服务暂时不可用，请稍后重试。";
        default:
            return "登录链接无效、已过期或已使用，请从极速蹬重新进入 AI 创作空间。";
    }
}

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
    const loadPlatformBootstrap = useConfigStore((state) => state.loadPlatformBootstrap);
    const clearPlatformBootstrap = useConfigStore((state) => state.clearPlatformBootstrap);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";
    const platformAuthEnabled = publicSettings?.auth?.platform?.enabled === true;
    const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
    const adminRemoteTokenRef = useRef("");
    const platformLaunchHandledRef = useRef(false);
    const platformBootstrapTokenRef = useRef("");
    const [platformLaunchError, setPlatformLaunchError] = useState<PlatformLaunchErrorCode | "">("");

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const launchToken = searchParams.get("launch_token")?.trim();
        if (launchToken && !isLoginPage && !platformLaunchHandledRef.current) {
            platformLaunchHandledRef.current = true;
            void exchangePlatformLaunchToken(launchToken)
                .then((session) => {
                    setSession(session.token, session.user);
                    const url = new URL(window.location.href);
                    url.searchParams.delete("launch_token");
                    url.searchParams.delete("launch_error");
                    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
                })
                .catch((error) => {
                    const code = platformLaunchErrorCode(error);
                    const url = new URL(window.location.href);
                    url.searchParams.delete("launch_token");
                    url.searchParams.set("launch_error", code);
                    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
                    setPlatformLaunchError(code);
                });
            return;
        }
        const persistedError = parsePlatformLaunchError(searchParams.get("launch_error"));
        if (persistedError && !isLoginPage) {
            setPlatformLaunchError(persistedError);
            return;
        }
        if (!isLoginPage && !launchToken) void hydrateUser();
    }, [hydrateUser, isLoginPage, pathname, setSession]);

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        if (!platformAuthEnabled || !isReady || user || isLoginPage || isAdminPath || platformLaunchError || searchParams.has("launch_token") || parsePlatformLaunchError(searchParams.get("launch_error"))) return;
        const redirectTarget = `${pathname}${window.location.search}`;
        window.location.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
    }, [isAdminPath, isLoginPage, isReady, pathname, platformAuthEnabled, platformLaunchError, user]);

    useEffect(() => {
        if (!platformAuthEnabled || !token || !user || user.role === "admin") {
            platformBootstrapTokenRef.current = "";
            clearPlatformBootstrap();
            return;
        }
        if (platformBootstrapTokenRef.current === token) return;
        platformBootstrapTokenRef.current = token;
        void loadPlatformBootstrap(token);
    }, [clearPlatformBootstrap, loadPlatformBootstrap, platformAuthEnabled, token, user]);

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
                    Object.entries(payload.modelConfig).forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
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

    if (platformLaunchError) {
        const entryURL = publicSettings?.auth?.platform?.entryUrl || publicSettings?.auth?.platform?.loginUrl || "";
        return (
            <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-10">
                <section className="w-full max-w-[420px] text-center">
                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">未能进入 AI 创作空间</h1>
                    <p className="mt-3 text-stone-500 dark:text-stone-400">{platformLaunchErrorMessage(platformLaunchError)}</p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        {entryURL ? (
                            <Button type="primary" onClick={() => window.location.assign(entryURL)}>
                                重新进入 AI 创作空间
                            </Button>
                        ) : null}
                        <Button
                            onClick={() => {
                                const url = new URL(window.location.href);
                                url.searchParams.delete("launch_error");
                                window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
                                setPlatformLaunchError("");
                            }}
                        >
                            返回 Canvas
                        </Button>
                    </div>
                </section>
            </main>
        );
    }

    return <>{children}</>;
}
