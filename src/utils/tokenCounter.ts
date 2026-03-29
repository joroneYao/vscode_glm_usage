/**
 * Token 计数工具
 * 使用字符/单词估算方式（GLM 模型没有对应的 tiktoken 编码）
 */
export class TokenCounter {

  constructor() {
    // GLM 模型不需要 tiktoken，直接用估算
    console.log('TokenCounter: 使用字符估算模式');
  }

  /**
   * 计算文本的 token 数（估算）
   */
  count(text: string): number {
    return this.estimate(text);
  }

  /**
   * 估算文本的 token 数
   * 中文约 1 token/字，英文约 4 字符/token
   */
  estimate(text: string): number {
    // 分别统计中文字符和英文字符
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const remaining = text.length - chineseChars;
    
    // 中文约 1.5 token/字，英文约 4 字符/token
    const chineseTokens = Math.ceil(chineseChars * 1.5);
    const englishTokens = Math.ceil(remaining / 4);
    
    return chineseTokens + englishTokens;
  }

  /**
   * 获取文本在特定上下文窗口中的百分比
   */
  getContextPercentage(text: string, contextWindow: number = 200000): number {
    const tokens = this.count(text);
    return Math.min((tokens / contextWindow) * 100, 100);
  }

  /**
   * 检查是否接近 token 限制
   */
  checkContextLimit(
    text: string,
    contextWindow: number = 200000,
    warningThreshold: number = 80
  ): { level: 'safe' | 'warning' | 'danger'; percentage: number } {
    const percentage = this.getContextPercentage(text, contextWindow);
    let level: 'safe' | 'warning' | 'danger' = 'safe';
    if (percentage >= 95) {
      level = 'danger';
    } else if (percentage >= warningThreshold) {
      level = 'warning';
    }
    return { level, percentage };
  }
}
