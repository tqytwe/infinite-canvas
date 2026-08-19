import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import HomePage from "@/pages/home";

const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const DocsPage = lazy(() => import("@/pages/docs"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));
const AdminStoragePage = lazy(() => import("@/pages/admin/storage"));

function PageLoading() {
    return <div className="flex h-full items-center justify-center bg-background text-sm text-stone-500 dark:text-stone-400">正在加载页面...</div>;
}

function LazyPage({ children }: { children: ReactNode }) {
    return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <LazyPage><ImagePage /></LazyPage> },
            { path: "/video", element: <LazyPage><VideoPage /></LazyPage> },
            { path: "/assets", element: <LazyPage><AssetsPage /></LazyPage> },
            { path: "/prompts", element: <LazyPage><PromptsPage /></LazyPage> },
            { path: "/canvas", element: <LazyPage><CanvasPage /></LazyPage> },
            { path: "/canvas/:id", element: <LazyPage><CanvasProjectPage /></LazyPage> },
            { path: "/config", element: <LazyPage><ConfigPage /></LazyPage> },
            { path: "/docs", element: <LazyPage><DocsPage /></LazyPage> },
            { path: "/docs/user", element: <LazyPage><DocsPage mode="user" /></LazyPage> },
            { path: "/docs/admin", element: <LazyPage><DocsPage mode="admin" /></LazyPage> },
            { path: "/admin/storage", element: <LazyPage><AdminStoragePage /></LazyPage> },
        ],
    },
    { path: "*", element: <LazyPage><NotFound /></LazyPage> },
]);
