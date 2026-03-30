import * as vscode from 'vscode';
import * as path from 'path';
import { StorageService } from '../services/storageService';

export class WebviewManager {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private storageService: StorageService;

    constructor(context: vscode.ExtensionContext, storageService: StorageService) {
        this.context = context;
        this.storageService = storageService;
    }

    /**
     * 显示或创建 WebView 面板
     */
    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            this.updatePanel();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'statsDetail',
            'GLM 用量详情',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
                ]
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        // 监听来自 WebView 的消息
        this.panel.webview.onDidReceiveMessage((message) => {
            this.handleWebviewMessage(message);
        });

        // 延迟发送初始数据（等 WebView 加载完成）
        setTimeout(() => this.updatePanel(), 500);

    }

    public updatePanel(): void {
        if (this.panel) {
            const stats = this.storageService.getDashboardStats();
            this.panel.webview.postMessage({
                command: 'updateStats',
                data: stats
            });
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src https:;">
    <title>GLM 用量详情</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            padding: 16px 24px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            min-height: 100vh;
            line-height: 1.5;
        }

        .container {
            max-width: 960px;
            margin: 0 auto;
        }

        /* === Header === */
        .header {
            margin-bottom: 16px;
            padding: 0 0 4px 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header h1 {
            font-size: 20px;
            font-weight: 700;
            background: linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin: 0;
        }

        .header .data-source {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 999px;
            background: rgba(99, 102, 241, 0.1);
            border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .data-source .dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22c55e;
            animation: pulse 2s ease-in-out infinite;
        }

        /* === Period Cards === */
        .period-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-bottom: 28px;
        }

        .period-card {
            background: var(--vscode-sidebar-background);
            border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
            border-radius: 14px;
            padding: 20px;
            text-align: center;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .period-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }

        .period-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 3px;
        }

        .period-card:nth-child(1)::before { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
        .period-card:nth-child(2)::before { background: linear-gradient(90deg, #8b5cf6, #a78bfa); }
        .period-card:nth-child(3)::before { background: linear-gradient(90deg, #f59e0b, #fbbf24); }

        .period-card .label {
            font-size: 12px;
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }

        .period-card .value {
            font-size: 28px;
            font-weight: 700;
            color: var(--vscode-editor-foreground);
        }

        .period-card .unit {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        /* === Quota Card === */
        .quota-card {
            background: var(--vscode-sidebar-background);
            border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
            border-radius: 14px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .quota-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }

        .quota-header h2 {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .quota-header .plan-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 3px 10px;
            border-radius: 999px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            text-transform: uppercase;
        }

        .cta-button {
            display: block;
            width: 100%;
            padding: 12px;
            margin-top: 16px;
            background: linear-gradient(135deg, #3b82f6, #60a5fa);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            text-align: center;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s;
        }

        .cta-button:hover {
            opacity: 0.9;
            transform: translateY(-1px);
        }

        .progress-container {
            margin: 16px 0;
        }

        .progress-bar {
            width: 100%;
            height: 12px;
            background: rgba(255,255,255,0.06);
            border-radius: 6px;
            overflow: hidden;
            position: relative;
        }

        .progress-fill {
            height: 100%;
            border-radius: 6px;
            transition: width 0.8s ease;
            position: relative;
        }

        .progress-fill::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            animation: shimmer 2.5s infinite;
        }

        .progress-fill.safe { background: linear-gradient(90deg, #22c55e, #4ade80); }
        .progress-fill.warning { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
        .progress-fill.danger { background: linear-gradient(90deg, #ef4444, #f87171); }

        .progress-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            font-size: 13px;
        }

        .progress-labels .used {
            color: var(--vscode-editor-foreground);
            font-weight: 600;
        }

        .progress-labels .total {
            color: var(--vscode-descriptionForeground);
        }

        /* === Detail Grid === */
        .detail-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 28px;
        }

        .detail-card {
            background: var(--vscode-sidebar-background);
            border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
            border-radius: 14px;
            padding: 20px;
        }

        .detail-card h3 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--vscode-editor-foreground);
        }

        /* Model list */
        .model-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }

        .model-item:last-child { border-bottom: none; }

        .model-item .name {
            font-size: 13px;
            font-weight: 500;
        }

        .model-item .tokens {
            font-size: 13px;
            font-weight: 600;
            color: #8b5cf6;
        }

        .model-item .breakdown {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        /* Project list */
        .project-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }

        .project-item:last-child { border-bottom: none; }

        .project-item .name {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .project-item .copy-btn {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 3px;
            border: 1px solid rgba(255,255,255,0.1);
            background: transparent;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s;
            flex-shrink: 0;
            margin: 0 6px;
        }

        .project-item:hover .copy-btn {
            opacity: 1;
        }

        .project-item .copy-btn:hover {
            background: rgba(139, 92, 246, 0.2);
            border-color: rgba(139, 92, 246, 0.5);
            color: #a78bfa;
        }

        .project-item .tokens {
            font-size: 12px;
            font-weight: 600;
        }

        /* Chart */
        .chart-card {
            background: var(--vscode-sidebar-background);
            border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
            border-radius: 14px;
            padding: 24px;
            margin-bottom: 28px;
        }

        .chart-card h3 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        canvas {
            max-height: 280px;
        }

        /* Context stats */
        .context-card {
            background: var(--vscode-sidebar-background);
            border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
            border-radius: 14px;
            padding: 20px;
            margin-bottom: 28px;
        }

        .stat-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 0;
        }

        .stat-row .label {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }

        .stat-row .value {
            font-size: 13px;
            font-weight: 600;
        }

        /* Footer */
        .footer {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            padding: 16px 0;
            opacity: 0.6;
        }

        /* Warning Banner */
        .warning-banner {
            display: none;
            background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.05));
            border: 1px solid rgba(245,158,11,0.3);
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 24px;
            font-size: 13px;
            line-height: 1.5;
        }

        .warning-banner strong { color: #f59e0b; }

        /* Animations */
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .container > * {
            animation: fadeIn 0.5s ease-out backwards;
        }
        .container > *:nth-child(1) { animation-delay: 0.05s; }
        .container > *:nth-child(2) { animation-delay: 0.1s; }
        .container > *:nth-child(3) { animation-delay: 0.15s; }
        .container > *:nth-child(4) { animation-delay: 0.2s; }
        .container > *:nth-child(5) { animation-delay: 0.25s; }
        .container > *:nth-child(6) { animation-delay: 0.3s; }

        @media (max-width: 600px) {
            .period-grid { grid-template-columns: 1fr; }
            .detail-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>📊 GLM 用量统计</h1>
        </div>

        <!-- Warning if no data -->
        <div id="warningBanner" class="warning-banner">
            <strong>⚠️ 未检测到 Claude Code 使用数据</strong><br/>
            请确认 <code>~/.claude/settings.json</code> 已正确配置 API Key，
            或者您已通过 Claude Code 进行过对话。
        </div>

        <!-- API Quota Section (New) -->
        <div id="apiQuotaSection" class="quota-card" style="display: none;">
            <div class="quota-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 12px; margin-bottom: 16px;">
                <h2 style="font-size: 15px; margin: 0; display: flex; align-items: center;">🌐 当前订阅 <span id="apiPlanBadge" class="plan-badge" style="margin-left: 8px;"></span></h2>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <div id="apiRefreshTimes" style="display: flex; gap: 16px; font-size: 11px; color: var(--vscode-descriptionForeground);"></div>
                    <button class="cta-button" style="margin-top: 0; padding: 4px 10px; width: auto; font-size: 11px;" onclick="openOfficialUsage()">官网查询 ↗</button>
                </div>
            </div>
            <div id="apiQuotaList">
                <!-- Data will be injected here -->
            </div>

            <!-- Cloud Trend Charts (Official API) -->
            <div id="cloudTrendSection" style="display:none; margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.06);">
                <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 16px; margin-bottom: 16px;">
                    <h2 style="font-size: 14px; margin: 0; display: flex; align-items: center;">☁️ token 详情</h2>
                    <div style="display:flex; gap:6px;">
                        <button id="tabBtnDaily" onclick="switchTab('daily')" style="padding: 4px 14px; border-radius: 6px; border: 1px solid rgba(139,92,246,0.6); background: rgba(139,92,246,0.25); color: #c4b5fd; font-size: 11px; cursor:pointer; min-width: 60px;">近24h</button>
                        <button id="tabBtnWeekly" onclick="switchTab('weekly')" style="padding: 4px 14px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; cursor:pointer; min-width: 60px;">本周</button>
                    </div>
                </div>
                
                <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px;">
                    近7日全网累计: <span id="cloudTotalTokens" style="color: #a78bfa; font-weight:600;">-</span> tokens · <span id="cloudTotalCalls" style="color: #a78bfa; font-weight:600;">-</span> 次调用
                </div>
                
                <div id="tabPanelDaily" style="height: 160px; position: relative; width: 100%;"><canvas id="dailyChart"></canvas></div>
                <div id="tabPanelWeekly" style="display:none; height: 160px; position: relative; width: 100%;"><canvas id="weeklyChart"></canvas></div>
            </div>
        </div>

        <!-- Local Data Consolidated Section -->
        <div class="quota-card">
            <div class="quota-header" style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 16px; margin-bottom: 20px;">
                <h2 style="font-size: 15px;">📊 本地数据</h2>
            </div>

            <!-- Unified Details Grid without internal borders -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 32px;">

                <!-- Col 1: Chat Context (compact) -->
                <div style="display: flex; flex-direction: column;">
                    <h3 style="font-size: 13px; margin-bottom: 16px; font-weight: 600; color: var(--vscode-editor-foreground); padding-bottom: 8px; border-bottom: 1px dashed rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
                        <span>💬 当前上下文</span>
                        <span id="ctxProjectBadge" style="display: none; font-size: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 6px; border-radius: 4px;"></span>
                    </h3>
                    <div id="ctxWarningBanner" style="display: none; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 6px; margin-bottom: 8px; font-size: 11px; color: #ef4444; align-items: flex-start; gap: 4px;">
                        <span>⚠️</span> <div>建议清理历史</div>
                    </div>
                    <div style="margin-top: 16px; display: flex; flex-direction: column; align-items: center;">
                        <div style="font-size: 32px; font-weight: 700; color: var(--vscode-editor-foreground); line-height: 1; margin-bottom: 14px;" id="ctxPercentStr">0%</div>
                        <div class="progress-container" style="margin: 0; width: 100%;">
                            <div class="progress-bar" style="height: 6px; border-radius: 3px;">
                                <div class="progress-fill safe" id="ctxProgress" style="width: 0%; border-radius: 3px;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Col 4: Projects -->
                <div>
                    <h3 style="font-size: 13px; margin-bottom: 12px; font-weight: 600; color: var(--vscode-editor-foreground); padding-bottom: 8px; border-bottom: 1px dashed rgba(255,255,255,0.1);">📁 本地项目</h3>
                    <div id="projectsList">
                        <div class="project-item"><span class="name">加载中...</span></div>
                    </div>
                </div>

            </div>
        </div>



        <!-- Footer -->
        <div class="footer">
            <span id="lastRefresh">上次更新: --</span> · 数据自动实时刷新
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
    <script>
        const vscode = acquireVsCodeApi();
        let dailyChart = null;
        let weeklyChart = null;
        let currentTab = 'daily';

        function formatNumber(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return String(n);
        }

        function getLevel(percent) {
            if (percent > 80) return 'danger';
            if (percent > 60) return 'warning';
            return 'safe';
        }

        function initCharts() {
            const commonOptions = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground'),
                            font: { size: 11 }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground'),
                            font: { size: 10 },
                            maxRotation: 45
                        }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground'),
                            font: { size: 10 },
                            callback: v => formatNumber(v)
                        }
                    }
                }
            };

            const dailyCtx = document.getElementById('dailyChart');
            if (dailyCtx) {
                dailyChart = new Chart(dailyCtx.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Token 消耗',
                            data: [],
                            backgroundColor: 'rgba(139, 92, 246, 0.65)',
                            borderRadius: 4,
                            barPercentage: 0.7
                        }]
                    },
                    options: commonOptions
                });
            }

            const weeklyCtx = document.getElementById('weeklyChart');
            if (weeklyCtx) {
                weeklyChart = new Chart(weeklyCtx.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Token 消耗',
                            data: [],
                            backgroundColor: 'rgba(99, 102, 241, 0.65)',
                            borderRadius: 4,
                            barPercentage: 0.7
                        }]
                    },
                    options: commonOptions
                });
            }
        }

        function switchTab(tab) {
            currentTab = tab;
            document.getElementById('tabPanelDaily').style.display  = (tab === 'daily')  ? 'block' : 'none';
            document.getElementById('tabPanelWeekly').style.display = (tab === 'weekly') ? 'block' : 'none';
            const activeStyle  = 'padding: 3px 12px; border-radius: 4px; border: 1px solid rgba(139,92,246,0.6); background: rgba(139,92,246,0.25); color: #c4b5fd; font-size: 11px; cursor:pointer;';
            const inactiveStyle= 'padding: 3px 12px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; cursor:pointer;';
            document.getElementById('tabBtnDaily').style.cssText  = (tab === 'daily')  ? activeStyle : inactiveStyle;
            document.getElementById('tabBtnWeekly').style.cssText = (tab === 'weekly') ? activeStyle : inactiveStyle;
        }

        function updateStats(data) {
            if (!data) return;

            const claude = data.claudeUsage || {};
            const ctx = data.chatContext || data.localLogData?.chatContext || {};
            const local = data.localLogData || {};

            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            // API Key Check & Warning
            const banner = document.getElementById('warningBanner');
            if (!data.hasApiKey || !data.apiQuotaData) {
                if (banner) {
                    banner.style.display = 'block';
                    banner.innerHTML = '<strong>⚠️ 请先配置 API Key</strong><br/>未能读取到生效的智谱 API Key 或接口请求失败。<br/><a href="#" onclick="vscode.postMessage({command: \\\'openExternal\\\', url: \\\'https://docs.bigmodel.cn/cn/coding-plan/tool/claude\\\'})" style="color:#a78bfa; cursor:pointer;">详情参考官网配置指南 ↗</a>';
                }
            } else {
                if (banner) banner.style.display = 'none';
            }

            // API Quota Section
            const quotaSec = document.getElementById('apiQuotaSection');
            const quotaList = document.getElementById('apiQuotaList');
            const apiQuota = data.apiQuotaData;

            if (apiQuota && apiQuota.limits && apiQuota.limits.length > 0) {
                if (quotaSec) quotaSec.style.display = 'block';
                setText('apiPlanBadge', (apiQuota.level || 'LITE').toUpperCase());
                
                let weeklyResetHtml = '';
                let quotaHtml = '';
                let detailsHtml = '';

                // 先提出重置时间（根据 unit 区分周期）
                // unit: 3=5小时, 4=日, 6=周
                let fiveHourResetHtml = '';
                let dailyResetHtml = '';
                let monthlyResetHtml = '';
                apiQuota.limits.forEach(limit => {
                    if (limit.type === 'TOKENS_LIMIT' && limit.nextResetTime) {
                        const timeStr = new Date(limit.nextResetTime).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
                        if (limit.unit === 3) {
                            fiveHourResetHtml = '<div style="display:flex; align-items:center; gap:4px;"><span>🔄 5h刷新:</span> <span style="color:var(--vscode-editor-foreground);">' + timeStr + '</span></div>';
                        } else if (limit.unit === 4) {
                            dailyResetHtml = '<div style="display:flex; align-items:center; gap:4px;"><span>🔄 日刷新:</span> <span style="color:var(--vscode-editor-foreground);">' + timeStr + '</span></div>';
                        } else {
                            weeklyResetHtml = '<div style="display:flex; align-items:center; gap:4px;"><span>🔄 周刷新:</span> <span style="color:var(--vscode-editor-foreground);">' + timeStr + '</span></div>';
                        }
                    }
                    if (limit.type === 'TIME_LIMIT' && limit.nextResetTime) {
                        const timeStr = new Date(limit.nextResetTime).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
                        monthlyResetHtml = '<div style="display:flex; align-items:center; gap:4px;"><span>📅 到期:</span> <span style="color:var(--vscode-editor-foreground);">' + timeStr + '</span></div>';
                    }
                });

                const timesEl = document.getElementById('apiRefreshTimes');
                if (timesEl) {
                    timesEl.innerHTML = fiveHourResetHtml + dailyResetHtml + weeklyResetHtml + monthlyResetHtml;
                }

                apiQuota.limits.forEach(limit => {
                    let title = limit.type === 'TOKENS_LIMIT' ? 'Token 限额' :
                                limit.type === 'TIME_LIMIT' ? '高级功能配额 (MCP等)' : limit.type;
                    
                    if (limit.type === 'TOKENS_LIMIT') {
                        // 尝试通过 unit 区分长短周期
                        if (limit.unit === 3) title = '每5小时 Token 限额';
                        if (limit.unit === 4) title = '每日 Token 限额';
                        if (limit.unit === 6) title = '每周 Token 限额';
                    }
                    
                    let pct = limit.percentage || 0;
                    if (limit.usage > 0) {
                        pct = ((limit.currentValue || 0) / limit.usage) * 100;
                    }
                    pct = Math.min(Math.max(pct, 0), 100);

                    if (limit.type === 'TOKENS_LIMIT') {
                        let usageText = '';
                        let headerNumStr = '';
                        if ((limit.usage && limit.usage > 0) || limit.currentValue >= 0) {
                            headerNumStr = '<span style="color: var(--vscode-descriptionForeground); font-weight: 400; margin-left: 8px;">(' + formatNumber(limit.currentValue || 0) + ' / ' + formatNumber(limit.usage || 0) + ')</span>';
                            usageText = '<div class="progress-labels">' + 
                                          '<span class="used">' + formatNumber(limit.currentValue || 0) + ' 已用</span>' +
                                          '<span class="total">' + formatNumber(limit.usage || 0) + ' 周期配额</span>' +
                                        '</div>';
                        } else if (limit.percentage !== undefined) {
                            headerNumStr = '<span style="color: var(--vscode-descriptionForeground); font-weight: 400; margin-left: 8px;">(已用: ' + limit.percentage + '%)</span>';
                            // 删除下方重复的 progress-labels，因为标题内已经含有 '(已用: x%)'
                            usageText = ''; 
                        }

                        quotaHtml += '<div style="margin-bottom: 12px;">' +
                            '<div style="font-size: 13px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center;">🔹 ' + title + headerNumStr + '</div>' + 
                            '<div class="progress-container" style="margin: 0;">' +
                                '<div class="progress-bar">' +
                                    '<div class="progress-fill ' + getLevel(pct) + '" style="width: ' + pct + '%"></div>' +
                                '</div>' +
                            '</div>' +
                            usageText +
                        '</div>';
                    } else {
                        // 针对 TIME_LIMIT 使用紧凑列表展示
                        detailsHtml += '<div style="margin-top: 16px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 12px;">';
                        detailsHtml += '<div style="font-size: 13px; font-weight: 600; margin-bottom: 8px; display:flex; justify-content:space-between;">' +
                                        '<span>🛠️ ' + title + '</span>' + 
                                       '</div>';
                        
                        let usageStr = ((limit.currentValue !== undefined) ? limit.currentValue : '-') + ' / ' + ((limit.usage !== undefined) ? limit.usage : '-');
                        if (limit.percentage !== undefined && !limit.usage) {
                            usageStr += ' (' + limit.percentage + '%)';
                        }
                        
                        detailsHtml += '<div class="stat-row" style="background: rgba(255,255,255,0.03); padding: 4px 8px; border-radius: 4px; margin-bottom: 8px;">' +
                                          '<span class="label" style="font-size: 12px;">当前周期总用量</span>' +
                                          '<span class="value" style="font-size: 12px; color: #a78bfa;">' + usageStr + ' 次</span>' +
                                       '</div>';
                        
                        if (limit.usageDetails && Array.isArray(limit.usageDetails) && limit.usageDetails.length > 0) {
                            limit.usageDetails.forEach(d => {
                                let modelName = d.modelCode || d.mode || d.modelName || '未知';
                                let used = d.usage || d.currentValue || 0;
                                detailsHtml += '<div class="stat-row" style="padding: 2px 8px;">' +
                                                  '<span class="label" style="font-size: 12px;">↳ ' + modelName + '</span>' +
                                                  '<span class="value" style="font-size: 12px;">' + used + ' 次</span>' +
                                               '</div>';
                            });
                        }
                        detailsHtml += '</div>';
                    }
                });
                if (quotaList) quotaList.innerHTML = quotaHtml + detailsHtml;
            } else {
                if (quotaSec) quotaSec.style.display = 'none';
            }

            // Consumption summary (Plan Badge only)
            const apiPlanBadge = document.getElementById('apiPlanBadge');
            if (apiPlanBadge) apiPlanBadge.textContent = (data.planType || '-').toUpperCase();

            // Projects
            const projEl = document.getElementById('projectsList');
            projEl.innerHTML = '';
            const projects = (local.byProject || []).slice(0, 10);
            if (projects.length > 0) {
                projects.forEach(p => {
                    const div = document.createElement('div');
                    div.className = 'project-item';
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'name';
                    nameSpan.textContent = p.project;
                    nameSpan.title = p.project;
                    div.appendChild(nameSpan);
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'copy-btn';
                    copyBtn.textContent = 'copy';
                    copyBtn.onclick = () => {
                        navigator.clipboard.writeText(p.project);
                        copyBtn.textContent = 'done';
                        setTimeout(() => { copyBtn.textContent = 'copy'; }, 1500);
                    };
                    div.appendChild(copyBtn);
                    const tokSpan = document.createElement('span');
                    tokSpan.className = 'tokens';
                    tokSpan.textContent = formatNumber(p.totalTokens);
                    div.appendChild(tokSpan);
                    projEl.appendChild(div);
                });
            } else {
                projEl.innerHTML = '<div class="project-item"><span class="name" style="color:var(--vscode-descriptionForeground)">暂无数据</span></div>';
            }

            // Cloud Trend Charts
            const cloudTrend = data.cloudTrendData;
            const cloudSec  = document.getElementById('cloudTrendSection');
            if (cloudTrend && cloudSec) {
                cloudSec.style.display = 'block';
                const setText2 = (id, text) => { const e = document.getElementById(id); if(e) e.textContent = text; };
                setText2('cloudTotalTokens', formatNumber(cloudTrend.totalTokens || 0));
                setText2('cloudTotalCalls', cloudTrend.totalCalls || 0);

                // Daily chart (hourly)
                if (dailyChart && cloudTrend.daily && cloudTrend.daily.length > 0) {
                    dailyChart.data.labels = cloudTrend.daily.map(d => d.time);
                    dailyChart.data.datasets[0].data = cloudTrend.daily.map(d => d.tokens || 0);
                    dailyChart.update('none');
                }

                // Weekly chart (daily-aggregated)
                if (weeklyChart && cloudTrend.weekly && cloudTrend.weekly.length > 0) {
                    weeklyChart.data.labels = cloudTrend.weekly.map(d => d.date.slice(5)); // MM-DD
                    weeklyChart.data.datasets[0].data = cloudTrend.weekly.map(d => d.tokens || 0);
                    weeklyChart.update('none');
                }
            } else if (cloudSec) {
                cloudSec.style.display = 'none';
            }

            // Chat Context
            // Chat Context
            const ctxTokensCount = ctx.tokens || 0;
            const ctxMaxTokens = ctx.maxTokens || 128000;
            const ctxPct = Math.min((ctxTokensCount / ctxMaxTokens) * 100, 100);
            
            if (ctx.project) {
                document.getElementById('ctxProjectBadge').style.display = 'inline-block';
                const ctxProjName = ctx.project.includes('/') ? ctx.project.split('/').pop() : 
                                    (ctx.project.includes('\\\\') ? ctx.project.split('\\\\').pop() : ctx.project);
                setText('ctxProjectBadge', ctxProjName);
            } else {
                document.getElementById('ctxProjectBadge').style.display = 'none';
            }
            
            // Show warning if context is over 100k
            const warBanner = document.getElementById('ctxWarningBanner');
            if (warBanner) {
                if (ctxTokensCount > 100000) {
                    warBanner.style.display = 'flex';
                } else {
                    warBanner.style.display = 'none';
                }
            }

            const ctxBar = document.getElementById('ctxProgress');
            if (ctxBar) {
                ctxBar.style.width = ctxPct + '%';
                ctxBar.className = 'progress-fill ' + getLevel(ctxPct);
            }
            setText('ctxPercentStr', ctxPct.toFixed(1) + '%');

            // Footer
            setText('lastRefresh', '上次更新: ' + (data.lastUpdated ? new Date(data.lastUpdated).toLocaleString('zh-CN') : '--'));
        }

        window.addEventListener('message', event => {
            if (event.data.command === 'updateStats') {
                updateStats(event.data.data);
            }
        });

        window.addEventListener('load', () => {
            initCharts();
        });

        function openOfficialUsage() {
            vscode.postMessage({ command: 'openExternal', url: 'https://www.bigmodel.cn/usercenter/glm-coding/usage' });
        }
    <\/script>
</body>
</html>`;
    }

    private handleWebviewMessage(message: any): void {
        switch (message.command) {
            case 'refresh':
                this.updatePanel();
                break;
            case 'openSettings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'stats.glmApiKey');
                break;
            case 'openExternal':
                if (message.url) {
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                break;
        }
    }
}

function getNonce(): string {
    let text = '';
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
