"use client";

import { DeleteOutlined, ReloadOutlined, ScanOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Card, Col, Flex, Modal, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
    deleteAdminLocalStorageObject,
    fetchAdminLocalStorageObjects,
    fetchAdminLocalStorageStatus,
    purgeAdminLocalStorageQuarantine,
    reclaimAdminLocalStorage,
    reconcileAdminLocalStorage,
    type AdminLocalStorageObject,
    type AdminLocalStorageStatus,
} from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const referenceLabels: Record<string, string> = {
    user_asset: "用户资产",
    canvas: "画布",
    video_history: "视频历史",
    image_history: "图片历史",
    legacy_user_data: "用户数据",
    catalog_asset: "公共素材",
    image_task: "图片任务",
    audio_task: "音频任务",
    video_task: "视频任务",
};

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function percent(used: number, total: number) {
    if (!total) return 0;
    return Math.min(100, Math.max(0, Math.round((used / total) * 1000) / 10));
}

export default function AdminStoragePage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [status, setStatus] = useState<AdminLocalStorageStatus | null>(null);
    const [objects, setObjects] = useState<AdminLocalStorageObject[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const [nextStatus, nextObjects] = await Promise.all([
                fetchAdminLocalStorageStatus(token),
                fetchAdminLocalStorageObjects(token, { page: 1, limit: 50 }),
            ]);
            setStatus(nextStatus);
            setObjects(nextObjects.items);
            setTotal(nextObjects.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取本地存储状态失败");
        } finally {
            setLoading(false);
        }
    }, [message, token]);

    useEffect(() => {
        void load();
    }, [load]);

    const confirmAction = (title: string, content: string, action: () => Promise<void>) => {
        Modal.confirm({
            title,
            content,
            okText: "确认执行",
            cancelText: "取消",
            onOk: action,
        });
    };

    const runReconcile = () =>
        confirmAction("扫描并隔离孤儿文件？", "只会处理超过 1 小时且没有数据库索引的文件；正常登记的用户媒体不会被移动。", async () => {
            try {
                const nextStatus = await reconcileAdminLocalStorage(token);
                setStatus(nextStatus);
                message.success("孤儿扫描完成，未登记文件已隔离");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "孤儿扫描失败");
            }
        });

    const runReclaim = () =>
        confirmAction("按策略回收无引用媒体？", "只删除超过保留期且没有资产、画布或历史引用的媒体；带有引用的文件永不自动删除。", async () => {
            try {
                const result = await reclaimAdminLocalStorage(token, true);
                message.success(`${result.message}，释放 ${formatBytes(result.objectBytes + result.temporaryBytes)}`);
                await load();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "媒体回收失败");
            }
        });

    const purgeQuarantine = () =>
        confirmAction("永久删除隔离区文件？", "隔离区文件不再属于任何已登记媒体。删除后无法恢复，请确认已完成必要的排查。", async () => {
            try {
                const result = await purgeAdminLocalStorageQuarantine(token);
                message.success(`已删除 ${result.count} 个隔离文件，释放 ${formatBytes(result.bytes)}`);
                await load();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "隔离区清理失败");
            }
        });

    const deleteObject = (item: AdminLocalStorageObject) =>
        confirmAction("删除这个媒体对象？", "只有没有资产、画布和历史引用的对象允许删除。删除后不会影响其他用户。", async () => {
            try {
                await deleteAdminLocalStorageObject(token, item.id);
                message.success("媒体对象已删除");
                await load();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "媒体删除失败");
            }
        });

    const objectColumns = useMemo<ColumnsType<AdminLocalStorageObject>>(
        () => [
            { title: "用户", dataIndex: "userDisplayName", width: 150, render: (value: string, item) => value || item.createdBy },
            { title: "类型", dataIndex: "kind", width: 90, render: (value: string) => <Tag>{value || "file"}</Tag> },
            { title: "大小", dataIndex: "bytes", width: 110, render: (value: number) => formatBytes(value) },
            { title: "创建时间", dataIndex: "createdAt", width: 180, render: (value: string) => new Date(value).toLocaleString() },
            {
                title: "引用",
                dataIndex: "references",
                render: (references: AdminLocalStorageObject["references"]) =>
                    references.length ? (
                        <Space size={[4, 4]} wrap>
                            {references.map((reference) => <Tag key={`${reference.type}-${reference.id}`}>{referenceLabels[reference.type] || reference.type}</Tag>)}
                        </Space>
                    ) : <Typography.Text type="secondary">无引用</Typography.Text>,
            },
            {
                title: "状态",
                dataIndex: "reclaimable",
                width: 130,
                render: (reclaimable: boolean, item) => reclaimable ? <Tag color="green">可安全删除</Tag> : <Tooltip title={item.references.length ? "存在受保护引用" : "当前不可删除"}><Tag color="orange">受保护</Tag></Tooltip>,
            },
            {
                title: "操作",
                key: "actions",
                width: 80,
                render: (_, item) => <Button danger type="text" icon={<DeleteOutlined />} disabled={!item.reclaimable} onClick={() => deleteObject(item)} />,
            },
        ],
        [],
    );

    const usageColumns = [
        { title: "用户", dataIndex: "userDisplayName", render: (value: string, item: AdminLocalStorageStatus["users"][number]) => value || item.userId },
        { title: "占用", dataIndex: "bytes", render: (value: number) => formatBytes(value) },
        { title: "对象数", dataIndex: "objectCount" },
        { title: "占媒体池", dataIndex: "bytes", render: (value: number) => `${percent(value, status?.mediaLimitBytes || 0)}%` },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card title="本地媒体空间" extra={<Space><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button><Button icon={<ScanOutlined />} onClick={runReconcile}>扫描孤儿</Button><Button icon={<ThunderboltOutlined />} onClick={runReclaim}>按策略回收</Button><Button danger onClick={purgeQuarantine}>清理隔离区</Button></Space>}>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>已引用的资产、画布和历史媒体不会自动删除。接近容量阈值时，系统只回收超过保留期且确认无引用的媒体；仍不足时拒绝新任务。</Typography.Paragraph>
                    <Row gutter={[16, 16]}>
                        <Col xs={12} md={6}><Statistic title="文件系统已用" value={formatBytes(status?.filesystemUsedBytes || 0)} suffix={status ? `${percent(status.filesystemUsedBytes, status.filesystemTotalBytes)}%` : ""} /></Col>
                        <Col xs={12} md={6}><Statistic title="文件系统可用" value={formatBytes(status?.filesystemAvailableBytes || 0)} /></Col>
                        <Col xs={12} md={6}><Statistic title="媒体池登记" value={formatBytes(status?.indexedBytes || 0)} suffix={`/ ${formatBytes(status?.mediaLimitBytes || 0)}`} /></Col>
                        <Col xs={12} md={6}><Statistic title="隔离区" value={formatBytes(status?.quarantineDirectoryBytes || 0)} suffix={`${status?.orphanCount || 0} 个待处理`} /></Col>
                    </Row>
                    <Typography.Text type="secondary">卷路径：{status?.root || "-"}　检查时间：{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : "-"}</Typography.Text>
                </Card>
                <Card title="用户占用排行"><Table rowKey="userId" size="small" pagination={false} loading={loading} dataSource={status?.users || []} columns={usageColumns} /></Card>
                <Card title={`媒体对象（${total}）`}><Table rowKey="id" size="small" loading={loading} dataSource={objects} columns={objectColumns} pagination={false} scroll={{ x: 900 }} /></Card>
            </Flex>
        </main>
    );
}
