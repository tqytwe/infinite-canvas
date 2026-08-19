import { AlertTriangle, ArrowLeft, Database, HardDrive, RefreshCw, ScanSearch, ShieldCheck, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { getCanvasSession } from "@/services/canvas-cloud";
import { deleteAdminStorageObject, fetchAdminStorageObjects, fetchAdminStorageStatus, purgeAdminStorageQuarantine, reclaimAdminStorage, reconcileAdminStorage, type AdminStorageObject, type AdminStorageSnapshot } from "@/services/api/admin-storage";

const bytes = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let n = value;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
};
function Stat({ label, value, detail, Icon }: { label: string; value: string; detail: string; Icon: typeof HardDrive }) {
    return (
        <div className="border border-stone-200 bg-card p-5 dark:border-stone-800">
            <div className="flex justify-between text-sm text-stone-500">
                <span>{label}</span>
                <Icon className="size-4" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{value}</div>
            <div className="mt-1 text-xs text-stone-500">{detail}</div>
        </div>
    );
}

export default function AdminStoragePage() {
    const [snapshot, setSnapshot] = useState<AdminStorageSnapshot | null>(null);
    const [objects, setObjects] = useState<AdminStorageObject[]>([]);
    const [message, setMessage] = useState("正在验证管理员权限...");
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        setBusy(true);
        try {
            const [status, list] = await Promise.all([fetchAdminStorageStatus(), fetchAdminStorageObjects()]);
            setSnapshot(status);
            setObjects(list.items);
            setMessage("");
        } catch (error) {
            setMessage(error instanceof Error && error.message === "ADMIN_REQUIRED" ? "当前账号没有管理员权限。" : "请先登录极速蹬管理员账号，或稍后重试。");
        } finally {
            setBusy(false);
        }
    }, []);
    useEffect(() => {
        void getCanvasSession(true)
            .then((session) => {
                if (session.authenticated) void load();
                else setMessage("请先登录极速蹬管理员账号。");
            })
            .catch(() => setMessage("请先登录极速蹬管理员账号。"));
    }, [load]);
    const action = async (run: () => Promise<unknown>, confirm: string) => {
        if (!window.confirm(confirm)) return;
        setBusy(true);
        try {
            await run();
            await load();
        } catch (error) {
            window.alert(error instanceof Error ? error.message : "操作失败");
            setBusy(false);
        }
    };
    if (!snapshot)
        return (
            <main className="h-full overflow-y-auto bg-background">
                <div className="mx-auto max-w-4xl px-6 py-10">
                    <Link to="/docs/admin" className="inline-flex items-center gap-2 text-sm text-stone-500">
                        <ArrowLeft className="size-4" />
                        返回管理员文档
                    </Link>
                    <section className="mt-10 border border-stone-200 bg-card p-8 dark:border-stone-800">
                        <ShieldCheck className="size-6" />
                        <h1 className="mt-4 text-2xl font-semibold">存储管理</h1>
                        <p className="mt-3 text-sm text-stone-500">{message}</p>
                    </section>
                </div>
            </main>
        );
    const percent = snapshot.media_pool.max_bytes ? (snapshot.media_pool.indexed_bytes / snapshot.media_pool.max_bytes) * 100 : 0;
    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto max-w-7xl px-6 py-8">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-7 dark:border-stone-800">
                    <div>
                        <Link to="/docs/admin" className="inline-flex items-center gap-2 text-sm text-stone-500">
                            <ArrowLeft className="size-4" />
                            管理员文档
                        </Link>
                        <h1 className="mt-5 text-3xl font-semibold">本地存储管理</h1>
                        <p className="mt-2 text-sm text-stone-500">真实磁盘、媒体池、临时区和引用保护状态。</p>
                    </div>
                    <button type="button" onClick={() => void load()} disabled={busy} className="inline-flex h-9 items-center gap-2 border border-stone-300 px-3 text-sm">
                        <RefreshCw className={cn("size-4", busy && "animate-spin")} />
                        刷新
                    </button>
                </header>
                <section className="grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat label="媒体池登记" value={bytes(snapshot.media_pool.indexed_bytes)} detail={`上限 ${bytes(snapshot.media_pool.max_bytes)} · ${percent.toFixed(1)}%`} Icon={Database} />
                    <Stat label="真实磁盘已用" value={bytes(snapshot.filesystem.used_bytes)} detail={`可用 ${bytes(snapshot.filesystem.free_bytes)}`} Icon={HardDrive} />
                    <Stat label="临时文件" value={bytes(snapshot.temporary.bytes)} detail={`${snapshot.temporary.files} 个`} Icon={RefreshCw} />
                    <Stat label="待隔离孤儿" value={bytes(snapshot.orphan.bytes)} detail={`${snapshot.orphan.files} 个未登记文件`} Icon={ScanSearch} />
                    <Stat label="隔离区" value={bytes(snapshot.quarantine.bytes)} detail={`${snapshot.quarantine.files} 个孤儿文件`} Icon={AlertTriangle} />
                </section>
                <section className="mb-8 flex flex-wrap gap-3 border border-stone-200 bg-card p-5 dark:border-stone-800">
                    <div className="mr-auto text-sm text-stone-500">无引用媒体保留 {snapshot.policy.unreferenced_retention_hours} 小时；引用文件不会自动删除。</div>
                    <button type="button" disabled={busy} onClick={() => void action(reconcileAdminStorage, "扫描并隔离过期孤儿文件？")} className="inline-flex h-9 items-center gap-2 border border-stone-300 px-3 text-sm">
                        <ScanSearch className="size-4" />
                        扫描孤儿
                    </button>
                    <button type="button" disabled={busy} onClick={() => void action(reclaimAdminStorage, "只回收超过保留期且确认无引用的媒体文件？")} className="inline-flex h-9 items-center gap-2 border border-stone-300 px-3 text-sm">
                        <Trash2 className="size-4" />
                        按策略回收
                    </button>
                    <button type="button" disabled={busy || !snapshot.quarantine.files} onClick={() => void action(purgeAdminStorageQuarantine, "永久删除隔离区文件？")} className="inline-flex h-9 items-center gap-2 bg-stone-950 px-3 text-sm text-white">
                        <Trash2 className="size-4" />
                        清空隔离区
                    </button>
                </section>
                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
                    <section className="min-w-0 border border-stone-200 bg-card dark:border-stone-800">
                        <div className="border-b border-stone-200 px-5 py-4 font-semibold dark:border-stone-800">媒体对象（{objects.length}）</div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[680px] text-left text-sm">
                                <thead className="bg-stone-50 text-xs text-stone-500 dark:bg-stone-950">
                                    <tr>
                                        <th className="px-5 py-3">对象</th>
                                        <th className="px-5 py-3">用户</th>
                                        <th className="px-5 py-3">大小</th>
                                        <th className="px-5 py-3">保护</th>
                                        <th className="px-5 py-3 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {objects.map((item) => (
                                        <tr key={`${item.user_id}:${item.storage_key}`} className="border-t border-stone-100 dark:border-stone-800">
                                            <td className="max-w-[260px] truncate px-5 py-3 font-mono text-xs" title={item.storage_key}>
                                                {item.storage_key}
                                            </td>
                                            <td className="px-5 py-3">{item.user_id}</td>
                                            <td className="px-5 py-3">{bytes(item.bytes)}</td>
                                            <td className="px-5 py-3">
                                                {item.references.length ? <span className="text-amber-700">{item.references.length} 个引用</span> : item.pinned ? "已固定" : item.reclaimable ? <span className="text-emerald-700">可回收</span> : "保留期内"}
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                {item.references.length ? (
                                                    <span className="text-xs text-stone-400">受保护</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        title="删除无引用对象"
                                                        onClick={() => void action(() => deleteAdminStorageObject(item.storage_key, item.user_id), `删除用户 ${item.user_id} 的对象？`)}
                                                        className="inline-flex size-8 items-center justify-center text-stone-500"
                                                    >
                                                        <Trash2 className="size-4" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    <aside className="border border-stone-200 bg-card p-5 dark:border-stone-800">
                        <div className="flex items-center gap-2 font-semibold">
                            <Users className="size-4" />
                            用户占用排行
                        </div>
                        <div className="mt-4 space-y-3">
                            {snapshot.users.slice(0, 10).map((user, index) => (
                                <div key={user.user_id} className="flex items-center gap-3 text-sm">
                                    <span className="w-5 text-xs text-stone-400">{index + 1}</span>
                                    <span className="flex-1">用户 {user.user_id}</span>
                                    <span className="text-stone-500">{bytes(user.bytes)}</span>
                                </div>
                            ))}
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}
