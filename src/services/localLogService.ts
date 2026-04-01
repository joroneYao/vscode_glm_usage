import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

/**
 * 单条对话的 usage 数据
 */
export interface LogUsageEntry {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  timestamp: string;
  project: string;
}

/**
 * 聚合后的用量统计
 */
export interface AggregatedUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  totalTokens: number;
  byProject: Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  entries: LogUsageEntry[];
}

/**
 * Claude Code 本地日志解析服务
 * 
 * Claude Code 的对话日志存储在 ~/.claude/projects/<project-hash>/<session-id>.jsonl
 * 每行是一个 JSON 对象，包含 type, message, usage 等字段
 * 
 * 我们从 assistant 消息中提取 usage 数据来统计 token 消耗
 */
export class LocalLogService {
  private claudeDir: string;
  private projectsDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.projectsDir = path.join(this.claudeDir, 'projects');
  }

  /**
   * 判断项目目录名是否为非项目路径（用户主目录、系统目录等）
   * 直接匹配原始目录名，不依赖 decodeProjectName
   */
  private isNonProjectDir(dirName: string): boolean {
    const lower = dirName.toLowerCase();
    // 用户主目录: C--Users-xxx（去掉 Downloads 子目录后的用户根目录）
    if (/^[a-z]--users-[a-z0-9_-]+$/.test(lower)) return true;
    // Downloads 目录
    if (/^[a-z]--users-[a-z0-9_-]+-downloads$/.test(lower)) return true;
    // Windows 系统目录
    if (/^[a-z]--windows-/.test(lower)) return true;
    // Linux/macOS 用户主目录
    if (/^-home-/.test(lower)) return true;
    if (lower === '-root') return true;
    return false;
  }

  /**
   * 获取所有项目目录
   */
  private getProjectDirs(): string[] {
    try {
      if (!fs.existsSync(this.projectsDir)) {
        console.warn('Claude projects 目录不存在:', this.projectsDir);
        return [];
      }

      return fs.readdirSync(this.projectsDir)
        .filter(name => {
          const fullPath = path.join(this.projectsDir, name);
          return fs.statSync(fullPath).isDirectory() && !this.isNonProjectDir(name);
        })
        .map(name => path.join(this.projectsDir, name));
    } catch (error) {
      console.error('读取 projects 目录失败:', error);
      return [];
    }
  }

  /**
   * 获取指定目录下的所有 JSONL 文件
   */
  private getJsonlFiles(dir: string): string[] {
    try {
      return fs.readdirSync(dir)
        .filter(name => name.endsWith('.jsonl'))
        .map(name => path.join(dir, name));
    } catch (error) {
      console.error('读取 JSONL 文件列表失败:', error);
      return [];
    }
  }

  /**
   * 解析单个 JSONL 文件中的 usage 数据
   */
  private parseJsonlFile(filePath: string, since?: Date): LogUsageEntry[] {
    const entries: LogUsageEntry[] = [];
    const projectName = path.basename(path.dirname(filePath));
    const sessionId = path.basename(filePath, '.jsonl');

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);

          // 只处理 assistant 类型的消息（包含 usage 数据）
          if (data.type !== 'assistant' || !data.message?.usage) {
            continue;
          }

          const usage = data.message.usage;
          const timestamp = data.timestamp;

          // 检查时间过滤
          if (since && timestamp) {
            const entryDate = new Date(timestamp);
            if (entryDate < since) {
              continue;
            }
          }

          // ★ 上下文大小 = 新输入 + 缓存读取 + 缓存创建 + 输出
          // output_tokens 代表当前轮正在生成的输出，占用上下文窗口
          const outputTokens = usage.output_tokens || 0;
          const inputTokens = (usage.input_tokens || 0)
            + (usage.cache_read_input_tokens || 0)
            + (usage.cache_creation_input_tokens || 0)
            + outputTokens;

          // 跳过空的 usage（中间 streaming 消息）
          if (inputTokens === 0 && outputTokens === 0) {
            continue;
          }

          entries.push({
            sessionId,
            model: data.message.model || 'unknown',
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
            cacheReadInputTokens: usage.cache_read_input_tokens || 0,
            timestamp: timestamp || '',
            project: this.decodeProjectName(projectName)
          });
        } catch (parseError) {
          // 跳过解析失败的行
          continue;
        }
      }
    } catch (error) {
      console.error('解析 JSONL 文件失败:', filePath, error);
    }

    return entries;
  }

  /**
   * 将项目目录名还原为可读路径
   * Claude Code 编码规则:
   *   开头 letter-- → 驱动器号 (C:/)
   *   中间 -- → 原始连字符 (-)
   *   单个 - → 路径分隔符 (/)
   * 注意: 原始路径中的 _ 也被编码为 -，无法区分，属于有损解码
   */
  private decodeProjectName(dirName: string): string {
    // 1. 驱动器号: "C--" → "C:/"
    let result = dirName.replace(/^([a-zA-Z])--/, '$1:/');
    // 2. 中间 "--" → 临时占位符 (保留为原始连字符)
    result = result.replace(/--/g, '\x00');
    // 3. 单个 "-" → 路径分隔符 "/"
    result = result.replace(/-/g, '/');
    // 4. 还原占位符为 "-"
    result = result.replace(/\x00/g, '-');
    return result;
  }

  /**
   * 获取指定时间范围内的所有用量数据
   * @param since 开始时间（可选，不传则获取所有数据）
   * @param projectFilter 项目名过滤（可选）
   */
  async getUsage(since?: Date, projectFilter?: string): Promise<AggregatedUsage> {
    // ★ 如果传入了 projectFilter（编码后的项目目录名），直接限定扫描目录
    const targetDirs = projectFilter
      ? [path.join(this.projectsDir, projectFilter)].filter(d => fs.existsSync(d))
      : this.getProjectDirs();
    const allEntries: LogUsageEntry[] = [];

    for (const projectDir of targetDirs) {
      const projectName = path.basename(projectDir);

      const jsonlFiles = this.getJsonlFiles(projectDir);

      for (const jsonlFile of jsonlFiles) {
        // 按文件修改时间做粗略过滤，提升性能
        if (since) {
          try {
            const stat = fs.statSync(jsonlFile);
            if (stat.mtime < since) {
              continue;
            }
          } catch {
            continue;
          }
        }

        const entries = this.parseJsonlFile(jsonlFile, since);
        allEntries.push(...entries);
      }
    }

    return this.aggregate(allEntries);
  }

  /**
   * 聚合用量数据
   */
  private aggregate(entries: LogUsageEntry[]): AggregatedUsage {
    const byProject = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreation = 0;
    let totalCacheRead = 0;

    for (const entry of entries) {
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;
      totalCacheCreation += entry.cacheCreationInputTokens;
      totalCacheRead += entry.cacheReadInputTokens;

      // 按项目聚合
      const projectKey = entry.project;
      const projectData = byProject.get(projectKey) || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      projectData.inputTokens += entry.inputTokens;
      projectData.outputTokens += entry.outputTokens;
      projectData.totalTokens += entry.inputTokens + entry.outputTokens;
      byProject.set(projectKey, projectData);
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreation,
      totalCacheRead,
      totalTokens: totalInputTokens + totalOutputTokens,
      byProject,
      entries
    };
  }



  /**
   * 检查 Claude Code 本地日志是否可用
   */
  isAvailable(): boolean {
    return fs.existsSync(this.projectsDir);
  }



  private lastContextCache: { tokens: number; project: string; timestamp: string; sessionId: string } | null = null;
  private lastSessionId: string | null = null;
  /** 最近活跃的会话文件路径（由文件监听器更新） */
  private lastActiveFilePath: string | null = null;

  /**
   * 更新最近活跃的会话文件（供外部文件监听器调用）
   */
  setActiveFile(filePath: string): void {
    this.lastActiveFilePath = filePath;
    console.log(`[LocalLogService] 设置活跃会话: ${path.basename(filePath || '')}`);
  }

  /**
   * 清空上下文缓存（供外部调用，强制重新读取文件）
   * 注意：不清空 lastActiveFilePath，保持当前追踪的会话
   */
  clearContextCache(): void {
    this.lastContextCache = null;
    this.lastSessionId = null;
    // ★ 不清空 lastActiveFilePath，保持当前追踪的会话
    console.log('[LocalLogService] 上下文缓存已清空（保持活跃文件）');
  }

  /**
   * 获取最近一次对话的上下文 Token 数
   * 策略：
   * 1. 优先使用 setActiveFile() 设置的活跃文件（由文件监听器更新）
   * 2. 如果没有，则回退到 max(birthtime, mtime) 找最近活跃的会话（限当前工作区）
   * 3. 如果会话 ID 变化，清空缓存并返回初始状态
   * 4. compact 后允许上下文下降
   *
   * @param projectFilter 当前工作区的编码后项目目录名，用于隔离多窗口
   */
  async getCurrentSessionContext(projectFilter?: string): Promise<{ tokens: number, project: string, timestamp: string, sessionId: string, compacted?: boolean } | null> {
    try {
      let activeFile: string | null = this.lastActiveFilePath;
      console.log(`[LocalLogService] getCurrentSessionContext 开始: projectFilter=${projectFilter || 'none'}, lastActiveFilePath=${activeFile ? path.basename(path.dirname(activeFile)) + '/' + path.basename(activeFile) : 'none'}`);

      // ★ 如果设置了工作区过滤，检查 activeFile 是否属于当前工作区
      if (activeFile && projectFilter) {
        const fileProjectDir = path.basename(path.dirname(activeFile));
        if (fileProjectDir !== projectFilter) {
          console.log(`[LocalLogService] 活跃文件不属于当前工作区，跳过: ${fileProjectDir} !== ${projectFilter}`);
          activeFile = null;  // 重置为 null，触发回退查找
        }
      }

      // 如果没有活跃文件记录，回退到时间戳查找（限当前工作区目录）
      if (!activeFile || !fs.existsSync(activeFile)) {
        const projectDirs = this.getProjectDirs();
        let latestActiveTime = 0;
        const now = Date.now();
        const STALE_THRESHOLD = 5 * 60 * 1000; // 5 分钟内修改过的才算活跃会话

        for (const projectDir of projectDirs) {
          // ★ 工作区过滤：只搜索匹配当前工作区的目录
          if (projectFilter) {
            const dirName = path.basename(projectDir);
            if (dirName !== projectFilter) {
              continue;
            }
          }

          const jsonlFiles = this.getJsonlFiles(projectDir);
          for (const file of jsonlFiles) {
            try {
              const stat = fs.statSync(file);
              // ★ 跳过超过 5 分钟没更新的旧会话文件
              if (now - stat.mtimeMs > STALE_THRESHOLD) {
                continue;
              }
              const activeTime = Math.max(stat.birthtimeMs || 0, stat.mtimeMs || 0);
              if (activeTime > latestActiveTime) {
                latestActiveTime = activeTime;
                activeFile = file;
              }
            } catch {
              // ignore
            }
          }
        }
      }

      if (!activeFile) {
        console.log(`[LocalLogService] 未找到会话文件 (projectFilter=${projectFilter || 'none'})`);
        return null;
      }

      const sessionId = path.basename(activeFile, '.jsonl');
      const projectName = this.decodeProjectName(path.basename(path.dirname(activeFile)));

      // 检测会话切换：sessionId 变化时清空缓存
      if (this.lastSessionId !== sessionId) {
        console.log(`[LocalLogService] 检测到会话切换: ${this.lastSessionId?.substring(0,8) || '(none)'} -> ${sessionId.substring(0,8)}...`);
        this.lastSessionId = sessionId;
        this.lastContextCache = null;
      }

      // ★ 解析文件并检测 compact 事件
      const { entries, lastCompactIndex } = this.parseJsonlFileWithCompact(activeFile);

      if (entries.length > 0) {
        // ★ 如果发生过 compact，只取 compact 之后的数据来判断上下文
        const effectiveEntries = lastCompactIndex >= 0
          ? entries.filter((_, i) => i >= lastCompactIndex)
          : entries;

        const latestEntry = effectiveEntries[effectiveEntries.length - 1];

        // ★ 检测 compact：如果有 compact 记录且当前值明显小于缓存值，标记 compacted
        const wasCompacted = lastCompactIndex >= 0 && this.lastContextCache &&
          latestEntry.inputTokens < this.lastContextCache.tokens * 0.5;

        this.lastContextCache = {
          tokens: latestEntry.inputTokens,
          project: latestEntry.project,
          timestamp: new Date().toISOString(),
          sessionId
        };

        if (wasCompacted) {
          console.log(`[LocalLogService] 检测到 compact 事件: sessionId=${sessionId.substring(0,8)}... tokens=${latestEntry.inputTokens}`);
          return { ...this.lastContextCache, compacted: true };
        }

        console.log(`[LocalLogService] 上下文更新: sessionId=${sessionId.substring(0,8)}... tokens=${latestEntry.inputTokens}`);
        return this.lastContextCache;
      }

      // ★ 新会话还没有数据时，返回初始上下文（tokens=0）
      console.log(`[LocalLogService] 会话暂无数据，返回初始上下文: sessionId=${sessionId.substring(0,8)}...`);
      return {
        tokens: 0,
        project: projectName,
        timestamp: new Date().toISOString(),
        sessionId
      };
    } catch (error) {
      console.error('[LocalLogService] 获取当前会话上下文失败:', error);
    }
    return null;
  }

  /**
   * 解析 JSONL 文件并检测 compact 事件
   * compact 后会生成 type="summary" 的消息，表示上下文被压缩
   */
  private parseJsonlFileWithCompact(filePath: string): { entries: LogUsageEntry[], lastCompactIndex: number } {
    const entries: LogUsageEntry[] = [];
    const projectName = path.basename(path.dirname(filePath));
    const sessionId = path.basename(filePath, '.jsonl');
    let lastCompactIndex = -1;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]);

          // ★ 检测 compact/summary 事件
          if (data.type === 'summary' || (data.type === 'system' && data.subtype === 'summary')) {
            lastCompactIndex = i;
            continue;
          }

          // 只处理 assistant 类型的消息（包含 usage 数据）
          if (data.type !== 'assistant' || !data.message?.usage) {
            continue;
          }

          const usage = data.message.usage;
          const timestamp = data.timestamp;

          // ★ 上下文大小 = 新输入 + 缓存读取 + 缓存创建 + 输出
          const outputTokens = usage.output_tokens || 0;
          const inputTokens = (usage.input_tokens || 0)
            + (usage.cache_read_input_tokens || 0)
            + (usage.cache_creation_input_tokens || 0)
            + outputTokens;

          // 跳过空的 usage
          if (inputTokens === 0 && outputTokens === 0) {
            continue;
          }

          entries.push({
            sessionId,
            model: data.message.model || 'unknown',
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
            cacheReadInputTokens: usage.cache_read_input_tokens || 0,
            timestamp: timestamp || '',
            project: this.decodeProjectName(projectName)
          });
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.error('解析 JSONL 文件失败:', filePath, error);
    }

    return { entries, lastCompactIndex };
  }
}
