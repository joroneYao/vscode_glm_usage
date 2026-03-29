import * as vscode from 'vscode';
import { ApiService } from '../services/apiService';
import { StorageService } from '../services/storageService';

export class StatsProvider implements vscode.TreeDataProvider<StatsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    StatsItem | undefined | null | void
  > = new vscode.EventEmitter<StatsItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    StatsItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private context: vscode.ExtensionContext;
  private apiService: ApiService;
  private storageService: StorageService;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ApiService,
    storageService: StorageService
  ) {
    this.context = context;
    this.apiService = apiService;
    this.storageService = storageService;
  }

  getTreeItem(element: StatsItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StatsItem): Promise<StatsItem[]> {
    const stats = this.storageService.getUsageStats();
    const local = stats.localLogData;

    if (!element) {
      // 根节点
      const items: StatsItem[] = [];

      // 套餐用量总览
      items.push(new StatsItem(
        '📦 套餐用量',
        vscode.TreeItemCollapsibleState.Expanded,
        'quota',
        stats
      ));

      // 模型明细
      if (local?.byModel?.length > 0 || stats.models?.length > 0) {
        items.push(new StatsItem(
          '🤖 模型消耗',
          vscode.TreeItemCollapsibleState.Collapsed,
          'models',
          stats
        ));
      }

      // 项目明细
      if (local?.byProject?.length > 0) {
        items.push(new StatsItem(
          '📁 项目消耗',
          vscode.TreeItemCollapsibleState.Collapsed,
          'projects',
          stats
        ));
      }

      // 数据源信息
      items.push(new StatsItem(
        '🔄 刷新信息',
        vscode.TreeItemCollapsibleState.None,
        'refresh',
        stats
      ));

      return items;
    }

    // 子节点
    switch (element.id) {
      case 'quota': {
        const usage = stats.claudeUsage || {};
        const pct = ((usage.percentageUsed || 0) * 100).toFixed(1);
        return [
          new StatsItem(
            `今日: ${this.formatTokens(local?.todayTokens || 0)}`,
            vscode.TreeItemCollapsibleState.None, 'today', null
          ),
          new StatsItem(
            `本周: ${this.formatTokens(local?.weekTokens || 0)}`,
            vscode.TreeItemCollapsibleState.None, 'week', null
          ),
          new StatsItem(
            `本月: ${this.formatTokens(local?.monthTokens || 0)}`,
            vscode.TreeItemCollapsibleState.None, 'month', null
          ),
          new StatsItem(
            `总已用: ${this.formatTokens(usage.tokensUsed || 0)}`,
            vscode.TreeItemCollapsibleState.None, 'tokens-used', null
          ),
          new StatsItem(
            `配额: ${this.formatTokens(usage.tokensAvailable || 0)}`,
            vscode.TreeItemCollapsibleState.None, 'tokens-available', null
          ),
          new StatsItem(
            `使用率: ${pct}%`,
            vscode.TreeItemCollapsibleState.None, 'percentage', null
          ),
          new StatsItem(
            `套餐: ${(stats.planType || 'lite').toUpperCase()}`,
            vscode.TreeItemCollapsibleState.None, 'plan', null
          ),
        ];
      }

      case 'models': {
        const models = local?.byModel || stats.models || [];
        return models.map((m: any) => {
          const name = m.model || m.role || 'unknown';
          const tokens = m.totalTokens || m.tokensUsed || 0;
          const desc = m.count ? `${m.count} 次调用` : '';
          const item = new StatsItem(
            `${name}: ${this.formatTokens(tokens)}`,
            vscode.TreeItemCollapsibleState.None,
            `model-${name}`,
            null
          );
          item.description = desc;
          return item;
        });
      }

      case 'projects': {
        const projects = (local?.byProject || []).slice(0, 10);
        return projects.map((p: any) => {
          const item = new StatsItem(
            `${p.project}`,
            vscode.TreeItemCollapsibleState.None,
            `proj-${p.project}`,
            null
          );
          item.description = this.formatTokens(p.totalTokens);
          return item;
        });
      }

      case 'refresh': {
        const lastUpdated = stats.lastUpdated
          ? new Date(stats.lastUpdated).toLocaleString('zh-CN')
          : '未更新';
        const source = stats.dataSource || 'none';
        const sourceLabel: { [key: string]: string } = {
          'api': 'Billing API',
          'local-log': '本地日志',
          'none': '无数据'
        };
        return [
          new StatsItem(
            `数据源: ${sourceLabel[source] || source}`,
            vscode.TreeItemCollapsibleState.None, 'data-source', null
          ),
          new StatsItem(
            `上次更新: ${lastUpdated}`,
            vscode.TreeItemCollapsibleState.None, 'last-update', null
          )
        ];
      }

      default:
        return [];
    }
  }

  private formatTokens(n: number): string {
    if (n >= 1000000) { return (n / 1000000).toFixed(1) + 'M'; }
    if (n >= 1000) { return (n / 1000).toFixed(1) + 'K'; }
    return String(n);
  }

  async refresh(): Promise<void> {
    try {
      const stats = await this.apiService.getUsageStats();
      await this.storageService.saveUsageStats(stats);
      this._onDidChangeTreeData.fire();
    } catch (error) {
      console.error('刷新失败:', error);
      vscode.window.showErrorMessage(`刷新失败: ${error}`);
    }
  }
}

class StatsItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly id: string,
    public readonly data: any
  ) {
    super(label, collapsibleState);
    this.tooltip = this.label;
    this.iconPath = this.getIconPath();
  }

  private getIconPath(): vscode.ThemeIcon | undefined {
    switch (this.id) {
      case 'quota': return new vscode.ThemeIcon('package');
      case 'models': return new vscode.ThemeIcon('symbol-class');
      case 'projects': return new vscode.ThemeIcon('folder');
      case 'refresh': return new vscode.ThemeIcon('sync');
      case 'today': return new vscode.ThemeIcon('calendar');
      case 'week': return new vscode.ThemeIcon('calendar');
      case 'month': return new vscode.ThemeIcon('calendar');
      case 'tokens-used': return new vscode.ThemeIcon('circle-filled');
      case 'tokens-available': return new vscode.ThemeIcon('circle');
      case 'percentage': return new vscode.ThemeIcon('graph');
      case 'plan': return new vscode.ThemeIcon('tag');
      case 'data-source': return new vscode.ThemeIcon('database');
      case 'last-update': return new vscode.ThemeIcon('history');
      default:
        if (this.id?.startsWith('model-')) { return new vscode.ThemeIcon('symbol-method'); }
        if (this.id?.startsWith('proj-')) { return new vscode.ThemeIcon('folder-library'); }
        return undefined;
    }
  }
}
