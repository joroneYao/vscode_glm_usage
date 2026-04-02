import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 日志服务 - 调试模式下将日志写入文件
 * 默认关闭，需通过 VS Code 配置 stats.debugMode 开启
 * 日志文件位置: ~/.claude/extension-logs/claude-glm-usage.log
 */
export class LogService {
  private logFilePath: string;
  private static instance: LogService;
  private enabled: boolean = false; // 默认关闭
  private maxLogSize: number = 5 * 1024 * 1024; // 5MB

  private constructor() {
    const logDir = path.join(os.homedir(), '.claude', 'extension-logs');
    this.logFilePath = path.join(logDir, 'claude-glm-usage.log');
  }

  static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }
    return LogService.instance;
  }

  /**
   * 初始化日志（由扩展 activate 时调用，读取配置决定是否启用）
   */
  init(debugMode: boolean): void {
    this.enabled = debugMode;
    if (!this.enabled) return;

    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // 检查日志文件大小，超过限制则清空
    if (fs.existsSync(this.logFilePath)) {
      const stat = fs.statSync(this.logFilePath);
      if (stat.size > this.maxLogSize) {
        fs.writeFileSync(this.logFilePath, '');
      }
    }

    this.log('=== 扩展日志服务启动（调试模式） ===');
  }

  /**
   * 写入日志（仅控制台 + 文件）
   */
  log(message: string, ...args: any[]): void {
    // 始终输出到控制台（开发者工具可见）
    console.log(`[Extension] ${message}`, ...args);

    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] ${message}${formattedArgs ? ' ' + formattedArgs : ''}\n`;

    try {
      fs.appendFileSync(this.logFilePath, logLine);
    } catch {
      // 静默失败
    }
  }

  error(message: string, ...args: any[]): void {
    console.error(`[Extension] ${message}`, ...args);
    if (this.enabled) {
      this.log(`[ERROR] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[Extension] ${message}`, ...args);
    if (this.enabled) {
      this.log(`[WARN] ${message}`, ...args);
    }
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  clearLog(): void {
    try {
      fs.writeFileSync(this.logFilePath, '');
    } catch {
      // 静默失败
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const logger = LogService.getInstance();
