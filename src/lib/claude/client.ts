/**
 * Claude API 客户端封装
 *
 * 支持三种模式(按优先级):
 *  1. OPENROUTER_API_KEY → 走 OpenRouter(OpenAI 兼容格式)
 *  2. ANTHROPIC_API_KEY  → 走 Anthropic 原生 SDK
 *  3. 都没有             → 返回 mock 文本,不抛错
 *
 * 默认模型 claude-sonnet-4-6(§5 技术栈)
 */

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
// OpenRouter 的模型格式: anthropic/claude-sonnet-4-6
const OPENROUTER_MODEL = 'anthropic/claude-sonnet-4-6';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

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
  /** 使用的路径:'openrouter' | 'anthropic' | 'mock' */
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
}

// ---------- OpenRouter 实现(OpenAI Chat Completions 格式)----------

async function generateViaOpenRouter(
  opts: GenerateOptions
): Promise<GenerateResult> {
  const apiKey = process.env.OPENROUTER_API_KEY!;

  // 构造 messages:system 作为 system message,prompt 作为 user message
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) {
    messages.push({ role: 'system', content: opts.system });
  }
  messages.push({ role: 'user', content: opts.prompt });

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter 推荐的标识头
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://xinyuan-ads.netlify.app',
      'X-Title': 'xinyuan-ads',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.5,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API 请求失败: ${res.status} ${text}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const text = choice?.message?.content ?? '';

  return {
    text,
    isMock: false,
    provider: 'openrouter',
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

// ---------- Anthropic SDK 实现 ----------

let _client: Anthropic | null = null;
function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

async function generateViaAnthropic(
  opts: GenerateOptions
): Promise<GenerateResult> {
  const client = getAnthropicClient()!;

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
    provider: 'anthropic',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ---------- 统一入口 ----------

/**
 * 生成文本
 * 优先级:OpenRouter > Anthropic > Mock
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  // 1. OpenRouter(优先)
  if (process.env.OPENROUTER_API_KEY) {
    return generateViaOpenRouter(opts);
  }

  // 2. Anthropic 原生
  if (process.env.ANTHROPIC_API_KEY) {
    return generateViaAnthropic(opts);
  }

  // 3. Mock 降级
  return {
    text: mockResponse(opts.prompt),
    isMock: true,
    provider: 'mock',
  };
}

/** Mock 返回,用于未配置 key 时的友好降级 */
function mockResponse(prompt: string): string {
  return `[Mock Claude 响应]

当前未配置 API Key(OPENROUTER_API_KEY 或 ANTHROPIC_API_KEY),这是降级的 mock 文本。

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
