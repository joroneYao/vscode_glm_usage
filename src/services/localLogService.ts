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

          // 跳过空的 usage（中间 streaming 消息）
          const inputTokens = usage.input_tokens || 0;
          const outputTokens = usage.output_tokens || 0;
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
    const allEntries: LogUsageEntry[] = [];
    const projectDirs = this.getProjectDirs();

    for (const projectDir of projectDirs) {
      const projectName = path.basename(projectDir);

      // 项目名过滤
      if (projectFilter && !projectName.toLowerCase().includes(projectFilter.toLowerCase())) {
        continue;
      }

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

  /**
   * 获取最近一次对话的上下文 Token 数
   * 策略：
   * 1. 优先使用 birthtime 找最新创建的会话（用户刚切换的新窗口）
   * 2. 如果会话 ID 变化，清空缓存
   * 3. 同一会话内只升不降
   */
  async getCurrentSessionContext(): Promise<{ tokens: number, project: string, timestamp: string, sessionId: string } | null> {
    try {
      const projectDirs = this.getProjectDirs();

      // 找到 birthtime 最新的文件（最新创建的会话）
      let newestFile: string | null = null;
      let newestBirthtime = 0;

      for (const projectDir of projectDirs) {
        const jsonlFiles = this.getJsonlFiles(projectDir);
        for (const file of jsonlFiles) {
          try {
            const stat = fs.statSync(file);
            const birthtime = stat.birthtimeMs || stat.mtimeMs;
            if (birthtime > newestBirthtime) {
              newestBirthtime = birthtime;
              newestFile = file;
            }
          } catch {
            // ignore
          }
        }
      }

      if (!newestFile) {
        console.log('[GLM-Stats] 未找到任何会话文件');
        return null;
      }

      const sessionId = path.basename(newestFile, '.jsonl');
      console.log(`[GLM-Stats] 最新会话: ${sessionId}, birthtime: ${new Date(newestBirthtime).toLocaleString()}`);

      // 检测会话切换：sessionId 变化时清空缓存
      if (this.lastSessionId !== sessionId) {
        console.log(`[GLM-Stats] 会话切换: ${this.lastSessionId} -> ${sessionId}`);
        this.lastSessionId = sessionId;
        this.lastContextCache = null;
      }

      const entries = this.parseJsonlFile(newestFile);
      console.log(`[GLM-Stats] 会话 ${sessionId} 有 ${entries.length} 条记录`);

      if (entries.length > 0) {
        const maxEntry = entries.reduce((max, e) => e.inputTokens > max.inputTokens ? e : max, entries[0]);
        console.log(`[GLM-Stats] 最大 inputTokens: ${maxEntry.inputTokens}`);

        // 同会话内只升不降：新值更大时更新缓存，否则返回缓存
        if (!this.lastContextCache || maxEntry.inputTokens >= this.lastContextCache.tokens) {
          this.lastContextCache = {
            tokens: maxEntry.inputTokens,
            project: maxEntry.project,
            timestamp: new Date().toISOString(),
            sessionId
          };
        }
        return this.lastContextCache;
      }

      // 会话还没有数据
      console.log(`[GLM-Stats] 会话 ${sessionId} 没有数据，返回 null`);
      return null;
    } catch (error) {
      console.error('获取当前会话上下文失败:', error);
    }
    return null;
  }
}
