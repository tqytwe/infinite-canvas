/**
 * Multi-Account Load Balancing
 *
 * Phase 3.2: 多账号负载均衡
 * - 管理多个API账号
 * - 自动轮询分配请求
 * - 监控账号配额和状态
 */

export interface AccountConfig {
    id: string;
    name: string;
    apiKey: string;
    provider: string;
    isEnabled: boolean;
    priority: number; // 优先级，数字越小越优先
    quota?: {
        total: number;
        used: number;
        resetAt?: number; // 重置时间戳
    };
    lastUsedAt?: number;
    errorCount: number;
}

export interface LoadBalancerStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    accountUsage: Record<string, number>;
}

/**
 * 多账号负载均衡器
 */
export class AccountLoadBalancer {
    private accounts: AccountConfig[] = [];
    private stats: LoadBalancerStats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        accountUsage: {},
    };
    private currentIndex = 0;

    constructor(accounts: AccountConfig[] = []) {
        this.accounts = accounts.filter((a) => a.isEnabled);
        this.sortAccounts();
    }

    /**
     * 添加账号
     */
    addAccount(account: AccountConfig): void {
        this.accounts.push(account);
        this.sortAccounts();
    }

    /**
     * 移除账号
     */
    removeAccount(accountId: string): void {
        this.accounts = this.accounts.filter((a) => a.id !== accountId);
    }

    /**
     * 更新账号配置
     */
    updateAccount(accountId: string, updates: Partial<AccountConfig>): void {
        const account = this.accounts.find((a) => a.id === accountId);
        if (account) {
            Object.assign(account, updates);
            this.sortAccounts();
        }
    }

    /**
     * 获取下一个可用账号（轮询策略）
     */
    getNextAccount(): AccountConfig | null {
        if (this.accounts.length === 0) {
            return null;
        }

        const availableAccounts = this.accounts.filter((a) => this.isAccountAvailable(a));

        if (availableAccounts.length === 0) {
            return null;
        }

        // 轮询策略
        const account = availableAccounts[this.currentIndex % availableAccounts.length];
        this.currentIndex = (this.currentIndex + 1) % availableAccounts.length;

        // 更新使用时间
        account.lastUsedAt = Date.now();

        // 更新统计
        this.stats.totalRequests++;
        this.stats.accountUsage[account.id] = (this.stats.accountUsage[account.id] || 0) + 1;

        return account;
    }

    /**
     * 获取优先级最高的可用账号
     */
    getPriorityAccount(): AccountConfig | null {
        const availableAccounts = this.accounts.filter((a) => this.isAccountAvailable(a));

        if (availableAccounts.length === 0) {
            return null;
        }

        // 返回优先级最高（数字最小）的账号
        const account = availableAccounts[0];
        account.lastUsedAt = Date.now();

        this.stats.totalRequests++;
        this.stats.accountUsage[account.id] = (this.stats.accountUsage[account.id] || 0) + 1;

        return account;
    }

    /**
     * 标记请求成功
     */
    markSuccess(accountId: string): void {
        const account = this.accounts.find((a) => a.id === accountId);
        if (account) {
            account.errorCount = 0;
            if (account.quota) {
                account.quota.used++;
            }
        }
        this.stats.successfulRequests++;
    }

    /**
     * 标记请求失败
     */
    markFailure(accountId: string): void {
        const account = this.accounts.find((a) => a.id === accountId);
        if (account) {
            account.errorCount++;
            // 连续失败3次后禁用账号
            if (account.errorCount >= 3) {
                account.isEnabled = false;
            }
        }
        this.stats.failedRequests++;
    }

    /**
     * 检查账号是否可用
     */
    private isAccountAvailable(account: AccountConfig): boolean {
        if (!account.isEnabled) {
            return false;
        }

        // 检查配额
        if (account.quota) {
            // 检查配额是否已重置
            if (account.quota.resetAt && Date.now() >= account.quota.resetAt) {
                account.quota.used = 0;
            }

            // 检查是否超出配额
            if (account.quota.used >= account.quota.total) {
                return false;
            }
        }

        // 检查错误次数
        if (account.errorCount >= 3) {
            return false;
        }

        return true;
    }

    /**
     * 按优先级排序账号
     */
    private sortAccounts(): void {
        this.accounts.sort((a, b) => a.priority - b.priority);
    }

    /**
     * 获取所有账号
     */
    getAccounts(): AccountConfig[] {
        return [...this.accounts];
    }

    /**
     * 获取统计信息
     */
    getStats(): LoadBalancerStats {
        return { ...this.stats };
    }

    /**
     * 重置统计信息
     */
    resetStats(): void {
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            accountUsage: {},
        };
    }

    /**
     * 持久化到localStorage
     */
    save(): void {
        const data = {
            accounts: this.accounts,
            stats: this.stats,
        };
        localStorage.setItem("account-load-balancer", JSON.stringify(data));
    }

    /**
     * 从localStorage加载
     */
    static load(): AccountLoadBalancer {
        try {
            const data = localStorage.getItem("account-load-balancer");
            if (data) {
                const parsed = JSON.parse(data);
                const balancer = new AccountLoadBalancer(parsed.accounts || []);
                balancer.stats = parsed.stats || balancer.stats;
                return balancer;
            }
        } catch (e) {
            console.error("Failed to load account load balancer:", e);
        }
        return new AccountLoadBalancer();
    }
}

/**
 * 全局负载均衡器实例
 */
let globalBalancer: AccountLoadBalancer | null = null;

export function getAccountLoadBalancer(): AccountLoadBalancer {
    if (!globalBalancer) {
        globalBalancer = AccountLoadBalancer.load();
    }
    return globalBalancer;
}

export function saveAccountLoadBalancer(): void {
    if (globalBalancer) {
        globalBalancer.save();
    }
}
