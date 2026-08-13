import { ArrowLeft, Cloud, Database, ExternalLink, HardDrive, Lock, ShieldCheck, Sparkles, UserRoundCog } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { CANVAS_PLATFORM_WEB_URL } from "@/constant/runtime-config";
import { cn } from "@/lib/utils";

type DocMode = "user" | "admin";

const userSections = [
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
            "空间没有固定过期时间。全站容量不足时，系统会优先清理最久未访问、且没有被当前画布/素材/生成历史引用保护的媒体文件。完成创作后请及时导出或保存自己的成果。",
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
            "如果某个历史结果已经被滚动清理，界面仍会尽量保留画布结构和文本信息；建议把长期需要复用的关键成果加入我的资产或导出备份。",
        ],
    },
] as const;

const adminSections = [
    {
        id: "boundary",
        title: "管理边界",
        icon: UserRoundCog,
        body: [
            "当前 AI创作空间本身没有独立管理员后台，也没有内置用户管理、套餐管理、封禁、充值、模型授权等管理页面。",
            "管理员登录、用户管理、模型权限、消费统计和账号治理都由极速蹬主平台负责。Canvas 只消费平台会话、模型权限和网关能力，并保存当前用户的创作文件。",
        ],
    },
    {
        id: "deployment",
        title: "部署配置",
        icon: Database,
        body: [
            "容器必须挂载持久卷，并设置 CANVAS_DATA_DIR。当前生产约定为 /data/infinite-canvas，用户文件按 users/<userId> 分目录存放。",
            "CANVAS_MAX_STORAGE_BYTES=30GB 表示全站共享空间上限；健康检查中的 storage.scope=global、storage.max_bytes 表示当前全站容量池。PORT 使用 8080，对外域名为当前 Canvas 域名。",
        ],
    },
    {
        id: "platform",
        title: "主平台接入",
        icon: ShieldCheck,
        body: [
            "CANVAS_PLATFORM_API_BASE_URL 指向极速蹬 API，CANVAS_PLATFORM_WEB_URL 指向极速蹬网页主站。CANVAS_EXCHANGE_SECRET 必须与主平台的 NextChat/Canvas 会话交换密钥一致。",
            "用户直访 Canvas 域名时，登录和注册按钮必须跳回主平台；主平台再通过 /ai-creation-space 入口把用户带回 Canvas，保证极速蹬仍是账号与权限中枢。",
        ],
    },
    {
        id: "queue",
        title: "队列与生成",
        icon: Sparkles,
        body: [
            "图片生成和图片编辑的异步排队仍由主平台接口承担，Canvas 不在本项目内重建全局任务队列，避免把计费、限流、重试和模型权限拆成两套。",
            "视频、文本、音频请求通过主平台会话网关读取用户可用模型。后续如果要做跨用户任务后台、管理员查看任务、失败重试审计，应优先放在主平台管理端实现。",
        ],
    },
] as const;

export default function DocsPage({ mode = "user" }: { mode?: DocMode }) {
    const { pathname } = useLocation();
    const activeMode: DocMode = pathname.startsWith("/docs/admin") ? "admin" : mode;
    const sections = activeMode === "admin" ? adminSections : userSections;
    const title = activeMode === "admin" ? "管理员与部署文档" : "用户使用文档";
    const subtitle =
        activeMode === "admin"
            ? "面向极速蹬运营、部署和管理员，说明 AI创作空间与主平台之间的职责边界。"
            : "面向普通用户，说明登录、创作、上传、保存、导出和全站共享 30GB 空间规则。";

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
                            <DocTab to="/docs/admin" active={activeMode === "admin"}>
                                管理员与部署
                            </DocTab>
                        </nav>
                        <div className="mt-8 space-y-2 text-sm">
                            {sections.map((section) => (
                                <a key={section.id} href={`#${section.id}`} className="block rounded-md px-3 py-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100">
                                    {section.title}
                                </a>
                            ))}
                        </div>
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
                        <DocTab to="/docs/admin" active={activeMode === "admin"}>
                            管理员与部署
                        </DocTab>
                    </div>

                    <header className="border-b border-stone-200 pb-8 dark:border-stone-800">
                        <div className="text-sm font-medium text-stone-500 dark:text-stone-400">Jisudeng AI创作空间</div>
                        <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">{title}</h1>
                        <p className="mt-4 max-w-3xl text-base leading-7 text-stone-500 dark:text-stone-400">{subtitle}</p>
                    </header>

                    <div className="grid gap-4 py-8 md:grid-cols-3">
                        <Metric label="空间上限" value="全站共 30GB" />
                        <Metric label="访问策略" value="未登录只读" />
                        <Metric label="管理归属" value="主平台统一管理" />
                    </div>

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
                </section>
            </div>
        </main>
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
