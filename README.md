# GLM 用量统计助手 (GLM Usage Tracker)
方便日常使用，无商业操作

## 🌟 核心功能特性
- **统计apikey的用量数据**
- 🔐 **零配置开箱即用**: 支持无需手动输入，自动寻找并使用本机 `~/.claude/settings.json` 内的安全原生环境变量。
- 📈 **极限极简仪表盘**: 现代风、高清晰度的 WebView 画布面板，支持 Chart.js 的流式自适应渲染。

## 🚀 快速上手

1. 确保您已经配置绑定了智谱 GLM Coding Plan 等 API Key。
2. 安装本扩展完成以后，在 VS Code 右下角点击【GLM 用量统计】图标。
3. 扩展会自动接管。如果没有自动读取到您的 Key，您可以随时点击设置 (`stats.glmApiKey`) 并配置。
4. 入口在右下角（token量/上下文占比）

## ⚙️ 插件配置 (settings.json)

| 配置项 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `stats.glmApiKey` | 智谱 GLM API Key（优先检查系统 `~/.claude/settings.json`，若无则使用此项） | `""` |
| `stats.claudeApiKey` | （针对海外 Claude 原生直连用户） | `""` |
| `stats.refreshInterval` | 自动刷新间隔（秒），建议设置为 3~5 秒实现流式统计 | `5` |
| `stats.glm.maxTokens` | 判定告警的最大上下文长度（智谱 GLM-4 默认 128k） | `128000` |

## 🛡️ 数据与安全隐私

- **本地化先行**: 本插件所有涉及 `Project` 相关的分析日志完全在您本地的 `.claude/history` 目录中完成轻量级聚合，**绝不上传任何您的代码信息和对话聊天记录**。
- **只读权限**: 云端图表所用接口仅限官方提供的 **Read-Only 用量统计 API**，不会造成任何额外计费或篡改风险。

---
*Created with ♥ by the Developer Community*
