/**
 * Account Manager Component
 *
 * Phase 3.2: 账号管理UI
 * - 添加/编辑/删除账号
 * - 显示账号状态和配额
 * - 测试账号连接
 */

import { useState } from "react";
import { Plus, Edit2, Trash2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { AccountConfig } from "@/services/account-load-balancer";
import { getAccountLoadBalancer, saveAccountLoadBalancer } from "@/services/account-load-balancer";

export function AccountManager() {
    const balancer = getAccountLoadBalancer();
    const [accounts, setAccounts] = useState<AccountConfig[]>(balancer.getAccounts());
    const [isAddingAccount, setIsAddingAccount] = useState(false);
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

    const refreshAccounts = () => {
        setAccounts(balancer.getAccounts());
        saveAccountLoadBalancer();
    };

    const handleAddAccount = (account: AccountConfig) => {
        balancer.addAccount(account);
        refreshAccounts();
        setIsAddingAccount(false);
    };

    const handleUpdateAccount = (accountId: string, updates: Partial<AccountConfig>) => {
        balancer.updateAccount(accountId, updates);
        refreshAccounts();
        setEditingAccountId(null);
    };

    const handleDeleteAccount = (accountId: string) => {
        if (confirm("确定删除这个账号？")) {
            balancer.removeAccount(accountId);
            refreshAccounts();
        }
    };

    const stats = balancer.getStats();

    return (
        <div style={{ padding: "2rem" }}>
            <div style={{ marginBottom: "2rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <h2 style={{ fontSize: "24px", fontWeight: "600" }}>账号管理</h2>
                    <button
                        onClick={() => setIsAddingAccount(true)}
                        style={{
                            padding: "0.5rem 1rem",
                            borderRadius: "6px",
                            border: "none",
                            backgroundColor: "#3b82f6",
                            color: "white",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                        }}
                    >
                        <Plus size={16} />
                        添加账号
                    </button>
                </div>

                {/* 统计信息 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
                    <StatCard label="总请求" value={stats.totalRequests} />
                    <StatCard label="成功" value={stats.successfulRequests} color="#10b981" />
                    <StatCard label="失败" value={stats.failedRequests} color="#ef4444" />
                    <StatCard label="账号数" value={accounts.length} />
                </div>
            </div>

            {/* 账号列表 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {accounts.map((account) => (
                    <AccountCard
                        key={account.id}
                        account={account}
                        usageCount={stats.accountUsage[account.id] || 0}
                        onEdit={() => setEditingAccountId(account.id)}
                        onDelete={() => handleDeleteAccount(account.id)}
                        onToggleEnabled={(enabled) => handleUpdateAccount(account.id, { isEnabled: enabled })}
                    />
                ))}
            </div>

            {/* 添加账号对话框 */}
            {isAddingAccount && (
                <AccountDialog
                    onSave={handleAddAccount}
                    onClose={() => setIsAddingAccount(false)}
                />
            )}

            {/* 编辑账号对话框 */}
            {editingAccountId && (
                <AccountDialog
                    account={accounts.find((a) => a.id === editingAccountId)}
                    onSave={(account) => handleUpdateAccount(editingAccountId, account)}
                    onClose={() => setEditingAccountId(null)}
                />
            )}
        </div>
    );
}

function StatCard({ label, value, color = "#374151" }: { label: string; value: number; color?: string }) {
    return (
        <div
            style={{
                padding: "1rem",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                backgroundColor: "white",
            }}
        >
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "0.5rem" }}>{label}</div>
            <div style={{ fontSize: "24px", fontWeight: "600", color }}>{value}</div>
        </div>
    );
}

interface AccountCardProps {
    account: AccountConfig;
    usageCount: number;
    onEdit: () => void;
    onDelete: () => void;
    onToggleEnabled: (enabled: boolean) => void;
}

function AccountCard({ account, usageCount, onEdit, onDelete, onToggleEnabled }: AccountCardProps) {
    const isAvailable = account.isEnabled && account.errorCount < 3;

    return (
        <div
            style={{
                padding: "1.5rem",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                backgroundColor: "white",
            }}
        >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        {isAvailable ? (
                            <CheckCircle2 size={20} color="#10b981" />
                        ) : account.errorCount >= 3 ? (
                            <XCircle size={20} color="#ef4444" />
                        ) : (
                            <AlertCircle size={20} color="#f59e0b" />
                        )}
                        <h3 style={{ fontSize: "16px", fontWeight: "600" }}>{account.name}</h3>
                        <span
                            style={{
                                padding: "0.25rem 0.5rem",
                                borderRadius: "4px",
                                backgroundColor: "#f3f4f6",
                                fontSize: "11px",
                                color: "#6b7280",
                            }}
                        >
                            {account.provider}
                        </span>
                    </div>

                    <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "0.75rem" }}>
                        优先级: {account.priority} · 使用次数: {usageCount}
                    </div>

                    {/* 配额信息 */}
                    {account.quota && (
                        <div style={{ marginBottom: "0.75rem" }}>
                            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "0.25rem" }}>
                                配额: {account.quota.used} / {account.quota.total}
                            </div>
                            <div
                                style={{
                                    width: "100%",
                                    height: "4px",
                                    backgroundColor: "#e5e7eb",
                                    borderRadius: "2px",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        width: `${(account.quota.used / account.quota.total) * 100}%`,
                                        height: "100%",
                                        backgroundColor: account.quota.used >= account.quota.total ? "#ef4444" : "#3b82f6",
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 错误提示 */}
                    {account.errorCount > 0 && (
                        <div
                            style={{
                                padding: "0.5rem",
                                borderRadius: "4px",
                                backgroundColor: "#fef2f2",
                                color: "#dc2626",
                                fontSize: "12px",
                            }}
                        >
                            错误次数: {account.errorCount}
                        </div>
                    )}
                </div>

                {/* 操作按钮 */}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                        <input
                            type="checkbox"
                            checked={account.isEnabled}
                            onChange={(e) => onToggleEnabled(e.target.checked)}
                            style={{ marginRight: "0.5rem" }}
                        />
                        <span style={{ fontSize: "13px" }}>启用</span>
                    </label>

                    <button
                        onClick={onEdit}
                        style={{
                            padding: "0.5rem",
                            border: "1px solid #d1d5db",
                            borderRadius: "4px",
                            backgroundColor: "white",
                            cursor: "pointer",
                        }}
                        title="编辑"
                    >
                        <Edit2 size={16} />
                    </button>

                    <button
                        onClick={onDelete}
                        style={{
                            padding: "0.5rem",
                            border: "1px solid #d1d5db",
                            borderRadius: "4px",
                            backgroundColor: "white",
                            cursor: "pointer",
                            color: "#ef4444",
                        }}
                        title="删除"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}

interface AccountDialogProps {
    account?: AccountConfig;
    onSave: (account: AccountConfig) => void;
    onClose: () => void;
}

function AccountDialog({ account, onSave, onClose }: AccountDialogProps) {
    const [formData, setFormData] = useState<AccountConfig>(
        account || {
            id: `account-${Date.now()}`,
            name: "",
            apiKey: "",
            provider: "",
            isEnabled: true,
            priority: 1,
            errorCount: 0,
        }
    );

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    backgroundColor: "white",
                    borderRadius: "12px",
                    padding: "2rem",
                    width: "90%",
                    maxWidth: "500px",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "1.5rem" }}>
                    {account ? "编辑账号" : "添加账号"}
                </h3>

                <form onSubmit={handleSubmit}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <div>
                            <label style={{ display: "block", fontSize: "14px", marginBottom: "0.5rem" }}>账号名称</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                }}
                                required
                            />
                        </div>

                        <div>
                            <label style={{ display: "block", fontSize: "14px", marginBottom: "0.5rem" }}>API Key</label>
                            <input
                                type="password"
                                value={formData.apiKey}
                                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                }}
                                required
                            />
                        </div>

                        <div>
                            <label style={{ display: "block", fontSize: "14px", marginBottom: "0.5rem" }}>提供商</label>
                            <input
                                type="text"
                                value={formData.provider}
                                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                                style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                }}
                                required
                            />
                        </div>

                        <div>
                            <label style={{ display: "block", fontSize: "14px", marginBottom: "0.5rem" }}>优先级</label>
                            <input
                                type="number"
                                value={formData.priority}
                                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                                style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                }}
                                min="1"
                                required
                            />
                        </div>

                        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    flex: 1,
                                    padding: "0.75rem",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                    backgroundColor: "white",
                                    cursor: "pointer",
                                }}
                            >
                                取消
                            </button>
                            <button
                                type="submit"
                                style={{
                                    flex: 1,
                                    padding: "0.75rem",
                                    borderRadius: "6px",
                                    border: "none",
                                    backgroundColor: "#3b82f6",
                                    color: "white",
                                    cursor: "pointer",
                                }}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
