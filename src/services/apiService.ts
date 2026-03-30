import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalLogService, AggregatedUsage } from './localLogService';

export interface ModelUsage {
  role: string;
  model: string;
  tokensUsed: number;
  multiplier: number;
}

export interface UsageStats {
  claudeUsage: {
    tokensUsed: number;
    tokensAvailable: number;
    percentageUsed: number;
    lastUpdated: number;
  };
  glmUsage: {
    tokensUsed: number;
    tokensAvailable: number;
    percentageUsed: number;
    lastUpdated: number;
  };
  planType: string;
  models: ModelUsage[];
  modelDetails?: {
    model: string;
    used: number;
    total: number;
  }[];
  /** 数据来源: 'api' | 'local-log' | 'none' */
  dataSource: string;
  /** 本地日志详细数据 */
  localLogData?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreation: number;
    totalCacheRead: number;
    todayTokens: number;
    byProject: { project: string; totalTokens: number }[];
    chatContext?: {
      tokens: number;
      project: string;
      maxTokens: number;
      timestamp: string;
    };
  };
  apiQuotaData?: {
    level: string;
    limits: any[];
  };
  /** 官方 model-usage 趋势数据 */
  cloudTrendData?: {
    daily: { time: string; tokens: number | null; calls: number | null }[];
    weekly: { date: string; tokens: number; calls: number }[];
    totalTokens: number;
    totalCalls: number;
  };
  hasApiKey: boolean;
}

export class ApiService {
  private context: vscode.ExtensionContext;
  private localLogService: LocalLogService;
  private lastBillingData: any = null;
  private lastBillingTime: number = 0;
  private lastTrendData: any = null;
  private lastTrendTime: number = 0;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.localLogService = new LocalLogService();
  }

  /**
   * 获取 Claude Code 配置目录路径（通用化）
   */
  private getClaudeConfigPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.claude', 'settings.json');
  }

  /**
   * 读取 Claude 设置文件
   */
  private readClaudeSettings(): any {
    try {
      const settingsPath = this.getClaudeConfigPath();

      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf8');
        return JSON.parse(content);
      } else {
        console.warn(`Claude 设置文件不存在: ${settingsPath}`);
      }
    } catch (error) {
      console.error('读取 Claude 设置失败:', error);
    }
    return {};
  }

  /**
   * 从 Claude 设置文件读取 API Key
   */
  private getApiKeyFromClaudeSettings(): string {
    const settings = this.readClaudeSettings();

    // 优先级 1: ANTHROPIC_AUTH_TOKEN（GLM Coding Plan 标准配置）
    if (settings.env?.ANTHROPIC_AUTH_TOKEN) {
      return settings.env.ANTHROPIC_AUTH_TOKEN;
    }

    // 优先级 2: ANTHROPIC_API_KEY
    if (settings.env?.ANTHROPIC_API_KEY) {
      return settings.env.ANTHROPIC_API_KEY;
    }

    // 优先级 3: ZHIPU_API_KEY
    if (settings.env?.ZHIPU_API_KEY) {
      return settings.env.ZHIPU_API_KEY;
    }

    // 优先级 4: apiKey 字段
    if (settings.apiKey) {
      return settings.apiKey;
    }

    // 优先级 5: 环境变量
    const envKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
    if (envKey) {
      return envKey;
    }

    // 优先级 6: VS Code 设置
    const config = vscode.workspace.getConfiguration('stats');
    return config.get<string>('glmApiKey', '');
  }

  /**
   * 将 GLM 模型名映射为显示名
   */
  private getModelDisplayName(glmModel: string): string {
    const normalized = (glmModel || '').toLowerCase().trim();
    const map: { [key: string]: string } = {
      'glm-4.5-air': 'GLM-4.5-Air (Haiku)',
      'glm-4.7': 'GLM-4.7 (Sonnet)',
      'glm-5': 'GLM-5 (Sonnet+)',
      'glm-5-turbo': 'GLM-5-Turbo',
      'glm-5.1': 'GLM-5.1 (Opus)'
    };
    return map[normalized] || glmModel;
  }

  /**
   * 获取模型消耗倍数
   */
  private getModelMultiplier(model: string): number {
    const normalized = (model || '').toLowerCase().trim();
    // GLM-5.1 / GLM-5 高阶模型消耗更高
    if (normalized.includes('glm-5.1') || normalized.includes('glm-5-turbo')) {
      return 3;
    }
    if (normalized === 'glm-5') {
      return 2;
    }
    // GLM-4.7 / GLM-4.5-Air 基础模型
    return 1;
  }

  /**
   * 尝试通过 GLM Billing API 获取用量
   * 端点已确认存在，使用 Bearer Token 鉴权
   */
  private async tryBillingApi(apiKey: string, force: boolean = false): Promise<any | null> {
    const endpoint = 'https://bigmodel.cn/api/monitor/usage/quota/limit';

    const now = Date.now();
    if (!force && this.lastBillingData && (now - this.lastBillingTime < 30000)) {
      return this.lastBillingData; // 缓存 30s
    }

    try {
      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': `${apiKey}`
        },
        timeout: 10000
      });

      if (response.status === 200 && response.data) {
        console.log('GLM Billing API 查询/刷新成功');
        this.lastBillingData = response.data;
        this.lastBillingTime = Date.now();
        
        return response.data;
      }
    } catch (error: any) {
      const status = error.response?.status;
      const msg = error.response?.data?.msg || error.message;
      console.warn(`GLM Billing API 调用失败 (${status}): ${msg}`);
    }

    return null;
  }

  /**
   * 获取官方 model-usage 趋势数据（今日 + 近7日）
   * 带5分钟缓存
   */
  private async tryUsageTrendApi(apiKey: string, force: boolean = false): Promise<any | null> {
    const now = Date.now();
    if (!force && this.lastTrendData && (now - this.lastTrendTime < 300000)) {
      return this.lastTrendData; // 缓存 5 分钟
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const today = new Date();
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
    const todayStr = fmt(today);
    const weekAgoStr = fmt(weekAgo);

    const weeklyUrl = `https://bigmodel.cn/api/monitor/usage/model-usage?startTime=${weekAgoStr}+00:00:00&endTime=${todayStr}+23:59:59`;
    // 这里的每日（实际是近24h）就不再单独拉 today 的 dailyUrl 了，因为如果今天没用，它全为null体验不好
    // 改为直接从 weeklyData 里切出最后 24 个小时的数据，这样哪怕今天0消耗，也能看到昨天到今天的连贯小图
    try {
      const headers = { 'Authorization': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'GLM-Usage-Tracker/1.0' };
      const weeklyRes = await axios.get(weeklyUrl, { headers, timeout: 10000 });
      const weeklyData = (weeklyRes.data?.code === 200) ? weeklyRes.data.data : null;

      // 聚合本周数据按天汇总
      const weekly: { date: string; tokens: number; calls: number }[] = [];
      if (weeklyData?.x_time) {
        const dayMap = new Map<string, { tokens: number; calls: number }>();
        weeklyData.x_time.forEach((t: string, i: number) => {
          const day = t.split(' ')[0];
          const prev = dayMap.get(day) || { tokens: 0, calls: 0 };
          dayMap.set(day, {
            tokens: prev.tokens + (weeklyData.tokensUsage?.[i] || 0),
            calls:  prev.calls  + (weeklyData.modelCallCount?.[i] || 0)
          });
        });
        dayMap.forEach((v, k) => weekly.push({ date: k, ...v }));
      }

      // 近24小时粒度数据（从近7日切出最后24条）
      const daily: { time: string; tokens: number | null; calls: number | null }[] = [];
      if (weeklyData?.x_time) {
        const totalLen = weeklyData.x_time.length;
        const startIndex = Math.max(0, totalLen - 24);
        for (let i = startIndex; i < totalLen; i++) {
          const t = weeklyData.x_time[i];
          const hour = t.split(' ')[1] || t;
          daily.push({
            time: hour,
            tokens: weeklyData.tokensUsage?.[i] ?? null,
            calls:  weeklyData.modelCallCount?.[i] ?? null
          });
        }
      }

      const result = {
        daily,
        weekly,
        totalTokens: weeklyData?.totalUsage?.totalTokensUsage || 0,
        totalCalls:  weeklyData?.totalUsage?.totalModelCallCount || 0
      };
      this.lastTrendData = result;
      this.lastTrendTime = Date.now();
      console.log('GLM model-usage 趋势数据获取成功');
      return result;
    } catch (err: any) {
      console.warn('GLM model-usage 趋势获取失败:', err.message);
      return null;
    }
  }

  /**
   * 解析 Billing API 返回数据
   */
  private parseBillingResponse(data: any): { tokensUsed: number; tokensAvailable: number; modelDetails: any[]; percentage: number; level: string; rawLimits: any[] } {
    let tokensUsed = 0;
    let tokensAvailable = 0;
    let percentage = 0;
    let level = data.data?.level || '';
    let modelDetails: { model: string; used: number; total: number }[] = [];

    // 尝试多种返回格式
    if (data.data?.limits && Array.isArray(data.data.limits)) {
      // Zhipu /api/monitor/usage/quota/limit 返回格式
      data.data.limits.forEach((limitItem: any) => {
        if (limitItem.type === 'TOKENS_LIMIT') {
          tokensUsed += limitItem.currentValue || 0;
          tokensAvailable += limitItem.usage || 0;
          percentage = limitItem.percentage || 0;
        } else if (!limitItem.type) {
          // 兼容无 type 的旧结构
          tokensUsed += limitItem.currentValue || 0;
          tokensAvailable += limitItem.usage || 0;
        }
        
        if (limitItem.usageDetails && Array.isArray(limitItem.usageDetails)) {
          limitItem.usageDetails.forEach((detail: any) => {
            const modelName = detail.modelCode || detail.mode || detail.modelName || detail.model || 'unknown';
            const used = detail.usage || detail.currentValue || detail.usedTokens || detail.used || 0;
            const existing = modelDetails.find(m => m.model === modelName);
            if (existing) {
              existing.used += used;
            } else {
              modelDetails.push({ model: modelName, used: used, total: 0 });
            }
          });
        }
      });
    } else if (data.data?.list && Array.isArray(data.data.list)) {
      modelDetails = data.data.list.map((item: any) => ({
        model: item.model || item.modelName || 'unknown',
        used: item.usedTokens || item.used || 0,
        total: item.totalTokens || item.total || 0
      }));
    } else if (data.data?.models && Array.isArray(data.data.models)) {
      modelDetails = data.data.models.map((item: any) => ({
        model: item.model || item.name || 'unknown',
        used: item.usedTokens || item.used || 0,
        total: item.totalTokens || item.total || 0
      }));
    } else if (data.data?.usedTokens !== undefined) {
      tokensUsed = data.data.usedTokens;
      tokensAvailable = data.data.totalTokens || 0;
    } else if (data.usedTokens !== undefined) {
      tokensUsed = data.usedTokens;
      tokensAvailable = data.totalTokens || 0;
    }

    if (tokensUsed === 0 && modelDetails.length > 0 && !percentage && !level) {
      tokensUsed = modelDetails.reduce((sum, item) => sum + item.used, 0);
      tokensAvailable = tokensAvailable || modelDetails.reduce((sum, item) => sum + item.total, 0);
    }

    return { tokensUsed, tokensAvailable, modelDetails, percentage, level, rawLimits: data.data?.limits || [] };
  }

  /**
   * 从本地日志获取用量详细数据
   */
  private async getLocalLogUsageData(): Promise<UsageStats['localLogData'] | null> {
    if (!this.localLogService.isAvailable()) {
      return null;
    }

    try {
      const [allUsage, currentContext] = await Promise.all([
        this.localLogService.getUsage(),
        this.localLogService.getCurrentSessionContext()
      ]);

      const byProject: any[] = [];
      allUsage.byProject.forEach((data, project) => {
        byProject.push({ project, totalTokens: data.totalTokens });
      });

      return {
        totalInputTokens: allUsage.totalInputTokens,
        totalOutputTokens: allUsage.totalOutputTokens,
        totalCacheCreation: allUsage.totalCacheCreation,
        totalCacheRead: allUsage.totalCacheRead,
        todayTokens: 0, // 由 getUsageStats 从 cloudTrendData 填充
        byProject: byProject.sort((a, b) => b.totalTokens - a.totalTokens),
        chatContext: currentContext ? {
          ...currentContext,
          maxTokens: 128000 // GLM-4 default limit
        } : undefined
      };
    } catch (error) {
      console.error('本地日志解析失败:', error);
      return null;
    }
  }

  /**
   * 获取合并后的使用统计 
   * 策略: 先尝试 Billing API，再用本地日志补充/降级
   */
  async getUsageStats(force: boolean = false): Promise<UsageStats> {
    const apiKey = this.getApiKeyFromClaudeSettings();
    const config = vscode.workspace.getConfiguration('stats');
    let planType = config.get<string>('planType', 'lite');

    let dataSource = 'none';
    let tokensUsed = 0;
    let tokensAvailable = 0; // 0 表示未知，需要 API 或用户配置
    let apiPercentage = 0;
    let apiModelDetails: { model: string; used: number; total: number }[] = [];
    let apiQuotaData: any = undefined;

    // === 方案 A: 尝试 Billing API ===
    if (apiKey) {
      const billingData = await this.tryBillingApi(apiKey, force);
      if (billingData && billingData.code !== 1001) {
        const parsed = this.parseBillingResponse(billingData);
        if (parsed.tokensUsed > 0 || parsed.tokensAvailable > 0 || parsed.percentage > 0 || parsed.level || parsed.rawLimits.length > 0) {
          tokensUsed = parsed.tokensUsed;
          tokensAvailable = parsed.tokensAvailable || tokensAvailable;
          apiPercentage = parsed.percentage;
          planType = parsed.level || planType; // Max 级别这里会覆盖
          apiModelDetails = parsed.modelDetails;
          dataSource = 'api';
          apiQuotaData = {
            level: parsed.level,
            limits: parsed.rawLimits
          };
          console.log('使用 Billing API 数据');
        }
      }
    }

    // === 方案 B: 本地项目级解析（仅保留用于上下文与项目统计展示） ===
    const localLogData = await this.getLocalLogUsageData();

    // 生成模型列表
    let models: ModelUsage[] = [];
    if (apiModelDetails.length > 0) {
      models = apiModelDetails.map(detail => ({
        role: this.getModelDisplayName(detail.model),
        model: detail.model,
        tokensUsed: detail.used,
        multiplier: this.getModelMultiplier(detail.model)
      }));
    }

    let percentageUsed = 0;
    if (apiPercentage > 0) {
      percentageUsed = apiPercentage / 100; // API 返回 10 表示 10%
    } else if (tokensAvailable > 0) {
      percentageUsed = tokensUsed / tokensAvailable;
    }

    // 获取 API 趋势数据
    const cloudTrendData = apiKey ? (await this.tryUsageTrendApi(apiKey, force)) || undefined : undefined;

    // 从 cloudTrendData 提取今日 tokens
    if (cloudTrendData?.weekly && localLogData) {
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      const todayEntry = cloudTrendData.weekly.find((d: { date: string; tokens: number; calls: number }) => d.date === todayStr);
      localLogData.todayTokens = todayEntry?.tokens || 0;
    }

    return {
      hasApiKey: !!apiKey,
      claudeUsage: {
        tokensUsed,
        tokensAvailable,
        percentageUsed,
        lastUpdated: Date.now()
      },
      glmUsage: {
        tokensUsed,
        tokensAvailable,
        percentageUsed,
        lastUpdated: Date.now()
      },
      planType,
      models,
      modelDetails: apiModelDetails.length > 0 ? apiModelDetails : undefined,
      dataSource,
      localLogData: localLogData || undefined,
      apiQuotaData,
      cloudTrendData
    };
  }

  /**
   * @deprecated 统一使用 getUsageStats
   */
  async getClaudeUsage(): Promise<any> {
    const stats = await this.getUsageStats();
    return stats.claudeUsage;
  }

  /**
   * @deprecated 统一使用 getUsageStats
   */
  async getGLMUsage(): Promise<any> {
    return this.getClaudeUsage();
  }
}
