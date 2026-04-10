/**
 * Claude API 客户端封装
 *
 * 设计原则:
 *  1. ANTHROPIC_API_KEY 未配置时,generate() 返回 mock 文本,不抛错
 *     —— 这样本地开发和 CI 不会因为缺 key 而挂
 *  2. 所有调用集中在这里,便于将来换模型或加重试
 *  3. 默认模型 claude-sonnet-4-6(§5 技术栈)
 */

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface GenerateOptions {
  /** 系统提示,定义 Claude 的角色 */
  system?: string;
  /** 用户消息(实际 prompt) */
  prompt: string;
  /** 最大输出 token 数,默认 2000 */
  maxTokens?: number;
  /** 温度,默认 0.5(略有创造性,但不失稳定) */
  temperature?: number;
  /** 模型覆盖 */
  model?: string;
}

export interface GenerateResult {
  text: string;
  /** 是否是 mock(用于前端提示"Phase 3 接入中") */
  isMock: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * 生成文本
 * 未配置 ANTHROPIC_API_KEY 时返回 mock 字符串,不抛异常
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const client = getClient();
  if (!client) {
    return {
      text: mockResponse(opts.prompt),
      isMock: true,
    };
  }

  const response = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.5,
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const text = textBlock && 'text' in textBlock ? textBlock.text : '';

  return {
    text,
    isMock: false,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** Mock 返回,用于未配置 key 时的友好降级 */
function mockResponse(prompt: string): string {
  return `[Mock Claude 响应]

当前 ANTHROPIC_API_KEY 未配置,这是降级的 mock 文本。

## 今日核心
- 总花费: ¥4.6 万
- 总 GMV: ¥12.8 万
- ROI: 2.79
- 订单: 13,837

## 亮点
- 越南店 ROI 达 3.2,环比上升 18%
- 春季爆款-3 单日 GMV 破 ¥2 万

## 关注
- 泰国店 ROI 跌破 1.5,建议检查春季爆款-5 出价
- 印尼店曝光环比下降 12%,可能是素材疲劳

(真实输出会由 Claude 基于 ${prompt.length} 字符的 prompt 生成)`;
}
