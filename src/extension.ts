import * as vscode from 'vscode';
import { ApiService } from './services/apiService';
import { StorageService } from './services/storageService';
import { WebviewManager } from './views/webviewManager';

let apiService: ApiService;
let storageService: StorageService;
let webviewManager: WebviewManager;
let autoRefreshInterval: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;
let lastCtxPercent: number = 0; // 上下文占比缓存，同会话内只升不降
let lastCtxSessionId: string = ''; // 追踪会话变化

export async function activate(context: vscode.ExtensionContext) {
  console.log('Claude/GLM 用量统计插件已激活');

  // 初始化服务
  storageService = new StorageService(context);
  apiService = new ApiService(context);
  webviewManager = new WebviewManager(context, storageService);

  // 创建状态栏项目
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'stats.showDetail';
  statusBarItem.text = '$(graph) 加载中...';
  statusBarItem.tooltip = '点击查看 GLM 用量详情';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);



  // 注册命令
  registerCommands(context);

  // 启动自动刷新
  setupAutoRefresh(context);

  // ★ 首次加载数据
  try {
    const freshStats = await apiService.getUsageStats();
    await storageService.saveUsageStats(freshStats);
    // 更新状态栏显示用量概要
    const stats = storageService.getUsageStats();
    updateStatusBarView(stats);
  } catch (error) {
    console.error('首次加载数据失败:', error);
    statusBarItem.text = '$(graph) GLM 用量';
  }
}

function updateStatusBarView(stats: any): void {
  const todayTokens = stats.localLogData?.todayTokens || 0;
  const ctx = stats.localLogData?.chatContext || {};
  const ctxTokens = ctx.tokens || 0;
  const ctxTotal = ctx.maxTokens || 128000;
  const level = (stats.apiQuotaData?.level || stats.planType || '').toLowerCase();

  let ctxPercent = Math.min((ctxTokens / ctxTotal) * 100, 100);
  // 检测会话切换：sessionId 变化时重置缓存
  const currentSessionId = ctx.sessionId || '';
  if (currentSessionId && currentSessionId !== lastCtxSessionId) {
    lastCtxSessionId = currentSessionId;
    lastCtxPercent = 0;
  }
  // 同会话内上下文占比只升不降，防止刷新时跳动
  if (ctxPercent < lastCtxPercent) {
    ctxPercent = lastCtxPercent;
  } else {
    lastCtxPercent = ctxPercent;
  }
  const progressBar = getVerticalProgressBar(ctxPercent);

  // 额度显示：MAX(无限额)显示 tokens 数，其他有限额套餐显示用量百分比
  let usageText: string;
  if (level === 'max') {
    usageText = formatTokens(todayTokens);
  } else {
    // 从 apiQuotaData.limits 中取 TOKENS_LIMIT 的百分比
    const tokenLimit = (stats.apiQuotaData?.limits || []).find((l: any) => l.type === 'TOKENS_LIMIT');
    const quotaPercent = tokenLimit?.percentage
      ?? (stats.glmUsage?.percentageUsed ? Math.round(stats.glmUsage.percentageUsed * 100) : 0);
    usageText = quotaPercent + '%';
  }

  statusBarItem.text = `$(graph) ${usageText} | ${progressBar} ${Math.round(ctxPercent)}%`;
  
  // 如果负荷过大，调整状态栏颜色为警告级别
  if (ctxPercent >= 80) {
    statusBarItem.backgroundColor = getStatusBarColor('danger');
  } else {
    statusBarItem.backgroundColor = undefined;
  }
}

function getVerticalProgressBar(percentage: number): string {
  // 单字符垂直填充分割：1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 7/8, 全块
  // 必须使用 unicode 转义 (\u2581 等)，防止由于文件编码或复制导致字符丢失变成普通空格
  const blocks = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];
  if (percentage <= 0) return '\u2581'; 
  const index = Math.floor((percentage / 100) * blocks.length);
  const safeIndex = Math.max(0, Math.min(index, blocks.length - 1));
  return blocks[safeIndex];
}

function getStatusBarColor(level: 'safe' | 'warning' | 'danger'): vscode.ThemeColor | undefined {
  switch (level) {
    case 'warning':
      return new vscode.ThemeColor('statusBarItem.warningBackground');
    case 'danger':
      return new vscode.ThemeColor('statusBarItem.errorBackground');
    default:
      return undefined;
  }
}

function formatTokens(n: number): string {
  if (n >= 1000000) { return (n / 1000000).toFixed(1) + 'M'; }
  if (n >= 1000) { return (n / 1000).toFixed(1) + 'K'; }
  return String(n);
}

function registerCommands(context: vscode.ExtensionContext) {
  // 刷新用量数据
  context.subscriptions.push(
    vscode.commands.registerCommand('stats.refresh', async () => {
      try {
        vscode.window.showInformationMessage('正在刷新用量数据...');
        const freshStats = await apiService.getUsageStats(true); // force=true 强制突破 30s 缓存
        await storageService.saveUsageStats(freshStats);
        vscode.window.showInformationMessage('✅ 用量数据已刷新');
      } catch (error) {
        vscode.window.showErrorMessage(`刷新失败: ${error}`);
      }
    })
  );

  // 打开设置
  context.subscriptions.push(
    vscode.commands.registerCommand('stats.openSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'stats.'
      );
    })
  );

  // 显示详细信息（状态栏和树视图兼容）
  context.subscriptions.push(
    vscode.commands.registerCommand('stats.showDetail', (item: any) => {
      if (item && item.label) {
        vscode.window.showInformationMessage(
          `${item.label}: ${item.description || 'N/A'}`
        );
      } else {
        webviewManager.show();
      }
    })
  );

  // 显示详细面板
  context.subscriptions.push(
    vscode.commands.registerCommand('stats.openDetailPanel', () => {
      webviewManager.show();
    })
  );
}

function setupAutoRefresh(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('stats');
  const enableAutoRefresh = config.get<boolean>('enableAutoRefresh', true);
  const refreshInterval = config.get<number>('refreshInterval', 10) * 1000; // 转换为毫秒

  if (enableAutoRefresh) {
    autoRefreshInterval = setInterval(async () => {
      try {
        const stats = await apiService.getUsageStats();
        await storageService.saveUsageStats(stats);
        // 更新状态栏
        updateStatusBarView(stats);
        
        // 更新面板内容 (如果已打开)
        webviewManager.updatePanel();
      } catch (error) {
        console.error('自动刷新失败:', error);
      }
    }, refreshInterval);
  }

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stats')) {
        // 重新设置自动刷新
        if (autoRefreshInterval) {
          clearInterval(autoRefreshInterval);
        }
        setupAutoRefresh(context);
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
      }
    }
  });
}

export function deactivate() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  console.log('Claude/GLM 用量统计插件已停用');
}
