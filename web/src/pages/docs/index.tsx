import { ArrowLeft, Cloud, Database, ExternalLink, HardDrive, Lock, ShieldCheck, Sparkles, UserRoundCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { CANVAS_PLATFORM_WEB_URL } from "@/constant/runtime-config";
import { cn } from "@/lib/utils";
import { canvasLoginUrl, getCanvasSession, isCanvasAdminSession, useCanvasSessionStore } from "@/services/canvas-cloud";

type DocMode = "user" | "admin";
type AdminDocStatus = "idle" | "loading" | "ready" | "login" | "forbidden" | "error";
type DisplayDocSection = { id: string; title: string; icon: LucideIcon; body: readonly string[] };
type AdminDocSection = { id: string; title: string; icon: keyof typeof adminIconMap; body: string[] };
type DocMetric = { label: string; value: string };
type AdminDocsPayload = { title: string; subtitle: string; metrics: DocMetric[]; sections: AdminDocSection[] };

const adminIconMap = {
    userRoundCog: UserRoundCog,
    database: Database,
    shieldCheck: ShieldCheck,
    sparkles: Sparkles,
};

const userSections: readonly DisplayDocSection[] = [
    {
        id: "account",
        title: "账号与访问",
        icon: Lock,
        body: [
            "AI创作空间使用极速蹬主平台账号。未登录用户可以打开页面和查看公开界面，但不能创作、上传、保存、调用模型或写入画布。",
            "点击登录、注册或从主平台进入时，会回到极速蹬完成账号流程，再携带平台签发的 launch token 回到当前域名完成会话交换。",
        ],
    },
    {
        id: "quota",
        title: "30GB 空间规则",
        icon: HardDrive,
        body: [
            "30GB 是当前 AI创作空间全站共享容量，不是单个用户独享。所有已登录用户上传、生成、保存到空间内的素材都会计入同一个容量池。",
            "空间没有固定过期时间。接近上限时，系统先清理过期临时文件，再清理超过保留期且没有被画布、素材或生成历史引用的媒体。被引用的文件不会自动删除；仍不足时会拒绝新写入。",
        ],
    },
    {
        id: "creation",
        title: "创作流程",
        icon: Sparkles,
        body: [
            "画布、生图工作台、视频创作台、提示词库和我的资产都在 AI创作空间内使用。已登录用户可以持续上传素材、保存画布、导出结果，并把可复用内容加入资产库。",
            "图片生成和图片编辑走主平台异步任务队列；完成后的结果会通过当前域名代理读取，并在保存时转存进全站共享空间。",
        ],
    },
    {
        id: "upload-export",
        title: "上传与导出",
        icon: Cloud,
        body: [
            "上传的图片、视频、音频和画布状态会计入全站共享空间。导出画布或素材时会从已保存数据中打包，不改变线上空间占用。",
            "被画布、资产或工作台历史引用的结果不会自动清理。长期需要复用的关键成果仍建议加入我的资产或导出备份。",
        ],
    },
] as const;

const userMetrics: DocMetric[] = [
    { label: "空间规则", value: "全站共 30GB" },
    { label: "访问策略", value: "未登录只读" },
    { label: "数据建议", value: "及时导出成果" },
];

export default function DocsPage({ mode = "user" }: { mode?: DocMode }) {
    const { pathname } = useLocation();
    const activeMode: DocMode = pathname.startsWith("/docs/admin") ? "admin" : mode;
    const session = useCanvasSessionStore((state) => state.session);
    const [adminDocs, setAdminDocs] = useState<AdminDocsPayload | null>(null);
    const [adminStatus, setAdminStatus] = useState<AdminDocStatus>("idle");
    const isAdminRoute = activeMode === "admin";
    const canShowAdminTab = isCanvasAdminSession(session) || adminStatus === "ready";
    const sections = isAdminRoute && adminDocs ? adminDocs.sections.map(toDisplaySection) : userSections;
    const metrics = isAdminRoute && adminDocs ? adminDocs.metrics : userMetrics;
    const title = isAdminRoute ? adminDocs?.title || "管理员文档需要权限" : "用户使用文档";
    const subtitle = isAdminRoute ? adminDocs?.subtitle || "管理员部署和运维文档仅限极速蹬管理员查看。" : "面向普通用户，说明登录、创作、上传、保存、导出和全站共享 30GB 空间规则。";

    useEffect(() => {
        if (!isAdminRoute) return;
        let cancelled = false;
        setAdminDocs(null);
        setAdminStatus("loading");
        void (async () => {
            try {
                const nextSession = await getCanvasSession(true);
                if (cancelled) return;
                if (!nextSession.authenticated) {
                    setAdminStatus("login");
                    return;
                }
                const response = await fetch("/api/admin/docs", { credentials: "same-origin", cache: "no-store" });
                if (cancelled) return;
                if (response.status === 401) {
                    setAdminStatus("login");
                    return;
                }
                if (response.status === 403) {
                    setAdminStatus("forbidden");
                    return;
                }
                if (!response.ok) {
                    setAdminStatus("error");
                    return;
                }
                const payload = (await response.json()) as AdminDocsPayload & { ok?: boolean };
                setAdminDocs(payload);
                setAdminStatus("ready");
            } catch (error) {
                console.error("[docs] admin docs load failed", error);
                if (!cancelled) setAdminStatus("error");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAdminRoute]);

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex max-w-7xl gap-10 px-6 py-8 lg:py-10">
                <aside className="sticky top-0 hidden h-[calc(100dvh-7rem)] w-64 shrink-0 flex-col justify-between border-r border-stone-200 pr-6 lg:flex dark:border-stone-800">
                    <div>
                        <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white">
                            <ArrowLeft className="size-4" />
                            返回 AI创作空间
                        </Link>
                        <nav className="mt-8 space-y-1">
                            <DocTab to="/docs/user" active={activeMode === "user"}>
                                用户指南
                            </DocTab>
                            {canShowAdminTab ? (
                                <DocTab to="/docs/admin" active={activeMode === "admin"}>
                                    管理员与部署
                                </DocTab>
                            ) : null}
                        </nav>
                        {(!isAdminRoute || adminStatus === "ready") ? (
                            <div className="mt-8 space-y-2 text-sm">
                                {sections.map((section) => (
                                    <a key={section.id} href={`#${section.id}`} className="block rounded-md px-3 py-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100">
                                        {section.title}
                                    </a>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <a href={CANVAS_PLATFORM_WEB_URL} className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white">
                        返回极速蹬主平台
                        <ExternalLink className="size-4" />
                    </a>
                </aside>

                <section className="min-w-0 flex-1">
                    <div className="mb-7 flex flex-wrap items-center gap-2 lg:hidden">
                        <DocTab to="/docs/user" active={activeMode === "user"}>
                            用户指南
                        </DocTab>
                        {canShowAdminTab ? (
                            <DocTab to="/docs/admin" active={activeMode === "admin"}>
                                管理员与部署
                            </DocTab>
                        ) : null}
                    </div>

                    <header className="border-b border-stone-200 pb-8 dark:border-stone-800">
                        <div className="text-sm font-medium text-stone-500 dark:text-stone-400">Jisudeng AI创作空间</div>
                        <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">{title}</h1>
                        <p className="mt-4 max-w-3xl text-base leading-7 text-stone-500 dark:text-stone-400">{subtitle}</p>
                        {isAdminRoute && adminStatus === "ready" ? (
                            <Link to="/admin/storage" className="mt-5 inline-flex h-9 items-center rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950">
                                打开存储管理
                            </Link>
                        ) : null}
                    </header>

                    {!isAdminRoute || adminStatus === "ready" ? (
                        <div className="grid gap-4 py-8 md:grid-cols-3">
                            {metrics.map((metric) => (
                                <Metric key={metric.label} label={metric.label} value={metric.value} />
                            ))}
                        </div>
                    ) : null}

                    {isAdminRoute && adminStatus !== "ready" ? <AdminDocsGate status={adminStatus} /> : <DocSections sections={sections} />}
                </section>
            </div>
        </main>
    );
}

function toDisplaySection(section: AdminDocSection): DisplayDocSection {
    return { ...section, icon: adminIconMap[section.icon] || ShieldCheck };
}

function DocSections({ sections }: { sections: readonly DisplayDocSection[] }) {
    return (
        <div className="space-y-5 pb-14">
            {sections.map((section) => {
                const Icon = section.icon;
                return (
                    <section id={section.id} key={section.id} className="scroll-mt-20 border border-stone-200 bg-card p-6 dark:border-stone-800">
                        <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                                <Icon className="size-4" />
                            </span>
                            <h2 className="text-xl font-semibold tracking-normal">{section.title}</h2>
                        </div>
                        <div className="mt-4 space-y-3 text-sm leading-7 text-stone-600 dark:text-stone-300">
                            {section.body.map((item) => (
                                <p key={item}>{item}</p>
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function AdminDocsGate({ status }: { status: AdminDocStatus }) {
    const copy =
        status === "loading"
            ? { title: "正在验证管理员权限", body: "请稍候，系统正在确认当前极速蹬账号是否拥有管理员权限。" }
            : status === "login"
              ? { title: "请先登录管理员账号", body: "管理员部署和运维文档不向游客开放。请回到极速蹬主平台登录管理员账号后再进入。" }
              : status === "forbidden"
                ? { title: "当前账号没有管理员权限", body: "普通用户不能查看部署、密钥、存储路径和运维边界文档。你仍然可以查看用户指南并正常使用创作空间。" }
                : { title: "管理员文档暂时无法加载", body: "权限服务或文档接口暂时不可用，请稍后重试，或回到主平台检查管理员状态。" };

    return (
        <section className="my-8 border border-stone-200 bg-card p-6 dark:border-stone-800">
            <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                    <Lock className="size-4" />
                </span>
                <h2 className="text-xl font-semibold tracking-normal">{copy.title}</h2>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600 dark:text-stone-300">{copy.body}</p>
            <div className="mt-5 flex flex-wrap gap-2">
                {status === "login" ? (
                    <a href={canvasLoginUrl()} className="inline-flex h-9 items-center rounded-md bg-stone-950 px-3 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200">
                        登录主平台
                    </a>
                ) : null}
                <Link to="/docs/user" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100">
                    查看用户指南
                </Link>
                <a href={CANVAS_PLATFORM_WEB_URL} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100">
                    返回极速蹬主平台
                </a>
            </div>
        </section>
    );
}

function DocTab({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
    return (
        <Link className={cn("inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition", active ? "bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100")} to={to}>
            {children}
        </Link>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-stone-200 bg-card p-4 dark:border-stone-800">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-100">{value}</div>
        </div>
    );
}
