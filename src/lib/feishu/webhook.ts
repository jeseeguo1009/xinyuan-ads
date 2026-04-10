/**
 * 飞书自定义机器人 Webhook 工具
 *
 * 文档:https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 *
 * 支持两种消息类型:
 *   - text:纯文本(简单告警)
 *   - interactive(card):富文本卡片(日报)
 *
 * 签名算法(启用"签名校验"时必需):
 *   string_to_sign = `${timestamp}\n${secret}`
 *   sign = base64(HMAC_SHA256(string_to_sign, ""))
 */

import crypto from 'node:crypto';

export interface FeishuSendOptions {
  webhookUrl?: string;
  /** 如果飞书机器人启用了"签名校验",传入 secret */
  secret?: string;
}

/** 计算飞书签名 */
export function calcFeishuSign(timestamp: number, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', stringToSign);
  hmac.update('');
  return hmac.digest('base64');
}

/** 发送纯文本消息 */
export async function sendFeishuText(
  text: string,
  opts: FeishuSendOptions = {}
): Promise<void> {
  const url = opts.webhookUrl ?? process.env.FEISHU_WEBHOOK_URL;
  if (!url) {
    // Key 未配置时静默跳过,方便本地 mock 运行
    console.log('[Feishu mock] webhookUrl 未配置,跳过发送:', text.slice(0, 80));
    return;
  }

  const body: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  };

  const secret = opts.secret ?? process.env.FEISHU_WEBHOOK_SECRET;
  if (secret) {
    const ts = Math.floor(Date.now() / 1000);
    body.timestamp = String(ts);
    body.sign = calcFeishuSign(ts, secret);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.code !== 0 && json.StatusCode !== 0) {
    throw new Error(`飞书发送失败: ${JSON.stringify(json)}`);
  }
}

/** 发送 Markdown 卡片消息(日报用) */
export async function sendFeishuMarkdown(
  title: string,
  markdown: string,
  opts: FeishuSendOptions = {}
): Promise<void> {
  const url = opts.webhookUrl ?? process.env.FEISHU_WEBHOOK_URL;
  if (!url) {
    console.log(`[Feishu mock] 跳过发送卡片: ${title}`);
    console.log(markdown);
    return;
  }

  const body: Record<string, unknown> = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: 'blue',
      },
      elements: [
        {
          tag: 'markdown',
          content: markdown,
        },
      ],
    },
  };

  const secret = opts.secret ?? process.env.FEISHU_WEBHOOK_SECRET;
  if (secret) {
    const ts = Math.floor(Date.now() / 1000);
    body.timestamp = String(ts);
    body.sign = calcFeishuSign(ts, secret);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.code !== 0 && json.StatusCode !== 0) {
    throw new Error(`飞书卡片发送失败: ${JSON.stringify(json)}`);
  }
}
