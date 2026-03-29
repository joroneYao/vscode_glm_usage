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
          return fs.statSync(fullPath).isDirectory();
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
   * 例如: "e--AISpace-MutAgent-Claude" -> "e:/AISpace/MutAgent-Claude"  (近似)
   */
  private decodeProjectName(dirName: string): string {
    // Claude Code 用 -- 替代 路径分隔符, - 替代其他分隔符
    // 这是一个近似还原
    return dirName.replace(/^([a-zA-Z])--/, '$1:/').replace(/--/g, '/');
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



  /**
   * 获取最近一次对话的上下文 Token 数（即最后一个 assistant 消息的 input_tokens）
   */
  async getCurrentSessionContext(): Promise<{ tokens: number, project: string, timestamp: string } | null> {
    try {
      const projectDirs = this.getProjectDirs();
      let latestFile: string | null = null;
      let maxMtime = 0;

      for (const projectDir of projectDirs) {
        const jsonlFiles = this.getJsonlFiles(projectDir);
        for (const file of jsonlFiles) {
          try {
            const stat = fs.statSync(file);
            if (stat.mtimeMs > maxMtime) {
              maxMtime = stat.mtimeMs;
              latestFile = file;
            }
          } catch (e) {
            // ignore
          }
        }
      }

      if (!latestFile) return null;

      const entries = this.parseJsonlFile(latestFile);
      if (entries.length > 0) {
        // 最后一条 assistant 消息的 inputTokens 代表了此刻大模型的长上下文长度
        const lastEntry = entries[entries.length - 1];
        return {
          tokens: lastEntry.inputTokens,
          project: lastEntry.project,
          timestamp: lastEntry.timestamp
        };
      }
    } catch (error) {
       console.error('获取当前会话上下文失败:', error);
    }
    return null;
  }
}
