import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { ApiService } from './services/apiService';
import { StorageService } from './services/storageService';
import { WebviewManager } from './views/webviewManager';

let apiService: ApiService;
let storageService: StorageService;
let webviewManager: WebviewManager;
let autoRefreshInterval: NodeJS.Timeout | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let statusBarItem: vscode.StatusBarItem;
let lastCtxPercent: number = 0; // 上下文占比缓存，同会话内只升不降
let lastCtxSessionId: string = ''; // 追踪会话变化
let refreshDebounceTimer: NodeJS.Timeout | undefined; // 防抖定时器
const EXTENSION_VERSION = '1.0.3'; // 与 package.json 保持同步
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24小时检查一次更新

/**
 * 检查 VSCode 扩展市场是否有新版本
 */
async function checkForUpdates(context: vscode.ExtensionContext): Promise<void> {
  const lastCheck = context.globalState.get<number>('lastUpdateCheck', 0);
  const now = Date.now();

  // 24小时内不重复检查
  if (now - lastCheck < UPDATE_CHECK_INTERVAL) {
    return;
  }

  try {
    const response = await axios.get(
      'https://marketplace.visualstudio.com/items/jorone.claude-glm-usage-stats',
      { timeout: 5000 }
    );

    // 从页面中提取版本号
    const versionMatch = response.data?.match(/"version":"(\d+\.\d+\.\d+)"/);
    if (versionMatch && versionMatch[1]) {
      const latestVersion = versionMatch[1];
      context.globalState.update('lastUpdateCheck', now);

      if (latestVersion !== EXTENSION_VERSION) {
        console.log(`[Extension] 发现新版本: ${latestVersion} (当前: ${EXTENSION_VERSION})`);
        const action = await vscode.window.showInformationMessage(
          `GLM 用量统计有新版本 ${latestVersion} 可用（当前: ${EXTENSION_VERSION}）`,
          '查看更新'
        );
        if (action === '查看更新') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://marketplace.visualstudio.com/items/jorone.claude-glm-usage-stats')
          );
        }
      } else {
        console.log(`[Extension] 版本检查: 已是最新版本 ${EXTENSION_VERSION}`);
      }
    }
  } catch (error) {
    // 静默失败，不影响用户体验
    console.warn('[Extension] 版本检查失败:', error);
  }
}

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

  // ★ 启动文件监听器（实时监听会话变化）
  setupFileWatcher(context);

  // ★ 首次加载数据
  try {
    console.log('[Extension] 开始首次加载用量数据...');
    const freshStats = await apiService.getUsageStats();
    await storageService.saveUsageStats(freshStats);
    // 更新状态栏显示用量概要
    const stats = storageService.getUsageStats();
    updateStatusBarView(stats);
    console.log('[Extension] 首次加载完成');
  } catch (error) {
    console.error('[Extension] 首次加载数据失败:', error);
    statusBarItem.text = '$(graph) GLM 用量';
  }

  // ★ 检查扩展更新（后台执行，不阻塞）
  checkForUpdates(context).catch(() => {});
}

function updateStatusBarView(stats: any): void {
  const todayTokens = stats.localLogData?.todayTokens || 0;
  const ctx = stats.localLogData?.chatContext || {};
  const ctxTokens = ctx.tokens || 0;
  const ctxTotal = ctx.maxTokens || 128000;
  const level = (stats.apiQuotaData?.level || stats.planType || '').toLowerCase();

  // 获取当前会话 ID（即使 tokens 为 0 也要有 sessionId）
  const currentSessionId = ctx.sessionId || '';

  // ★ 关键修复：检测会话切换（包括新会话暂无数据的情况）
  if (currentSessionId && currentSessionId !== lastCtxSessionId) {
    console.log(`[StatusBar] 检测到会话切换: ${lastCtxSessionId.substring(0,8)}... -> ${currentSessionId.substring(0,8)}...`);
    lastCtxSessionId = currentSessionId;
    lastCtxPercent = 0; // 新会话归零
  }

  let ctxPercent = Math.min((ctxTokens / ctxTotal) * 100, 100);

  // 同会话内上下文占比只升不降，防止刷新时跳动
  if (ctxPercent < lastCtxPercent) {
    ctxPercent = lastCtxPercent;
  } else if (ctxPercent > lastCtxPercent) {
    lastCtxPercent = ctxPercent;
    console.log(`[StatusBar] 上下文增长: ${lastCtxPercent.toFixed(1)}% -> ${ctxPercent.toFixed(1)}%`);
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
        console.error('[Extension] 自动刷新失败:', error);
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

/**
 * 设置文件监听器，监听 Claude 会话文件变化
 */
function setupFileWatcher(context: vscode.ExtensionContext) {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  // 检查目录是否存在
  if (!require('fs').existsSync(claudeProjectsDir)) {
    console.log('[Extension] Claude projects 目录不存在，跳过文件监听');
    return;
  }

  // 创建文件监听器，监听 .jsonl 文件的变化
  fileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(claudeProjectsDir), '**/*.jsonl')
  );

  // 即时刷新：文件变化时立即更新状态栏
  fileWatcher.onDidChange(async (uri: vscode.Uri) => {
    console.log(`[Extension] 检测到会话文件变化: ${path.basename(uri.fsPath)}`);

    // ★ 关键：先设置活跃会话文件，确保切换会话时能正确获取上下文
    apiService.setActiveSessionFile(uri.fsPath);

    // 使用防抖避免频繁刷新
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
    }
    refreshDebounceTimer = setTimeout(async () => {
      try {
        const stats = await apiService.getUsageStats(true); // 强制刷新
        await storageService.saveUsageStats(stats);
        updateStatusBarView(stats);
        webviewManager.updatePanel();
        console.log('[Extension] 文件变化触发刷新完成');
      } catch (error) {
        console.error('[Extension] 文件变化刷新失败:', error);
      }
    }, 500); // 500ms 防抖
  });

  context.subscriptions.push(fileWatcher);
  console.log('[Extension] 文件监听器已启动');
}

export function deactivate() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  if (fileWatcher) {
    fileWatcher.dispose();
  }
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
  }
  console.log('Claude/GLM 用量统计插件已停用');
}
