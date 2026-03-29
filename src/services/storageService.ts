import * as vscode from 'vscode';

export interface StorageData {
  usageStats?: any;
  contextStats?: any;
  lastRefresh?: number;
}

export class StorageService {
  private context: vscode.ExtensionContext;
  private readonly STORAGE_KEY_PREFIX = 'glm-stats:';

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * 保存数据到全局存储
   */
  async saveGlobalData(key: string, value: any): Promise<void> {
    const fullKey = this.STORAGE_KEY_PREFIX + key;
    await this.context.globalState.update(fullKey, value);
  }

  /**
   * 从全局存储读取数据
   */
  getGlobalData(key: string): any {
    const fullKey = this.STORAGE_KEY_PREFIX + key;
    return this.context.globalState.get(fullKey);
  }

  /**
   * 保存数据到工作区存储
   */
  async saveWorkspaceData(key: string, value: any): Promise<void> {
    const fullKey = this.STORAGE_KEY_PREFIX + key;
    await this.context.workspaceState.update(fullKey, value);
  }

  /**
   * 从工作区存储读取数据
   */
  getWorkspaceData(key: string): any {
    const fullKey = this.STORAGE_KEY_PREFIX + key;
    return this.context.workspaceState.get(fullKey);
  }

  /**
   * 保存使用统计数据
   */
  async saveUsageStats(stats: any): Promise<void> {
    const snapshot = {
      ...stats,
      lastUpdated: Date.now()
    };
    await this.saveGlobalData('usageStats', snapshot);
    await this.appendUsageHistory(snapshot);
  }

  /**
   * 获取使用统计数据
   */
  getUsageStats(): any {
    return this.getGlobalData('usageStats') || {
      claudeUsage: { tokensUsed: 0, tokensAvailable: 128000, percentageUsed: 0 },
      lastUpdated: 0
    };
  }

  /**
   * 获取上下文统计
   */
  getContextStats(): any {
    return this.getWorkspaceData('contextStats') || {
      totalTokens: 0,
      percentageOfContext: 0,
      warningLevel: 'safe',
      maxContextTokens: 1000000
    };
  }

  /**
   * 返回汇总仪表盘数据
   */
  getDashboardStats(): any {
    const usageStats = this.getUsageStats();
    const contextStats = this.getContextStats();
    const localLogData = usageStats.localLogData;
    const now = new Date();

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfDay);
    const weekDay = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - weekDay);

    const startOfMonth = new Date(startOfDay);
    startOfMonth.setDate(1);

    // 如果有本地日志数据，使用精确的日/周/月统计
    const today = { claude: localLogData?.todayTokens || 0 };
    const week = { claude: localLogData?.weekTokens || 0 };
    const month = { claude: localLogData?.monthTokens || 0 };

    return {
      ...usageStats,
      contextStats,
      dataSource: usageStats.dataSource || 'none',
      localLogData,
      quotaSummary: {
        claude: {
          used: usageStats.claudeUsage?.tokensUsed || 0,
          total: usageStats.claudeUsage?.tokensAvailable || 0,
          percentage: (usageStats.claudeUsage?.percentageUsed || 0) * 100
        }
      },
      subscriptionPlan: {
        claudeMax: usageStats.claudeUsage?.tokensAvailable || 0
      },
      refreshTimestamps: {
        lastRefresh: usageStats.lastUpdated,
        today: startOfDay.getTime(),
        week: startOfWeek.getTime(),
        month: startOfMonth.getTime()
      },
      usageByPeriod: {
        today,
        week,
        month
      },
      combined: {
        used: usageStats.claudeUsage?.tokensUsed || 0,
        total: usageStats.claudeUsage?.tokensAvailable || 0
      }
    };
  }

  /**
   * 追加历史日志数据
   */
  async appendUsageHistory(stats: any): Promise<void> {
    const history = this.getGlobalData('usageHistory') || [];
    const now = Date.now();

    history.push({
      ts: now,
      claudeUsed: stats.claudeUsage.tokensUsed || 0
    });

    // 保留最近 90 天数据
    const cutoff = now - 90 * 24 * 60 * 60 * 1000;
    const filtered = history.filter((entry: any) => entry.ts >= cutoff);

    await this.saveGlobalData('usageHistory', filtered);
  }

  /**
   * 清除所有存储数据
   */
  async clearAll(): Promise<void> {
    const keys = this.context.globalState.keys();
    for (const key of keys) {
      if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
        await this.context.globalState.update(key, undefined);
      }
    }
  }
}
