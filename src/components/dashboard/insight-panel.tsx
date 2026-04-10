'use client';

/**
 * Claude 洞察面板 —— 客户端组件
 *
 * 支持两种模式:
 *  1. scope="global"  全局日报(首页),调 /api/insights/daily
 *  2. scope="shop"    店铺洞察(详情页),调 /api/insights/shop/:id
 *
 * ANTHROPIC_API_KEY 未配置时后端返回 isMock=true,前端显示黄色 Mock 标签
 */

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';

interface InsightPanelProps {
  /** 洞察范围 */
  scope?: 'global' | 'shop';
  /** scope='shop' 时必传 */
  shopId?: string;
  /** URL 的 from/to,用于构造 API 请求和 key */
  from?: string;
  to?: string;
  /** 面板标题覆盖 */
  title?: string;
  /** 窗口天数(仅用于显示) */
  windowDays?: number;
}

interface InsightState {
  loading: boolean;
  error: string | null;
  markdown: string;
  isMock: boolean;
  reportDate?: string;
  durationMs: number;
}

export function InsightPanel({
  scope = 'global',
  shopId,
  from,
  to,
  title,
  windowDays,
}: InsightPanelProps) {
  const [state, setState] = useState<InsightState>({
    loading: true,
    error: null,
    markdown: '',
    isMock: false,
    durationMs: 0,
  });

  const key = `${scope}:${shopId ?? ''}:${from ?? ''}:${to ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const base =
          scope === 'global'
            ? '/api/insights/daily'
            : `/api/insights/shop/${shopId}`;
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        const url = query.toString() ? `${base}?${query.toString()}` : base;

        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setState({
            loading: false,
            error: json.error ?? '未知错误',
            markdown: '',
            isMock: false,
            durationMs: 0,
          });
          return;
        }
        setState({
          loading: false,
          error: null,
          markdown: json.markdown,
          isMock: json.isMock,
          reportDate: json.reportDate,
          durationMs: json.durationMs,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          markdown: '',
          isMock: false,
          durationMs: 0,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const displayTitle =
    title ?? (scope === 'global' ? '💡 每日洞察' : '💡 店铺洞察');
  const subtitle =
    scope === 'global'
      ? `全局日报${windowDays ? ` · 最近 ${windowDays} 天` : ''}${state.reportDate ? ` · ${state.reportDate}` : ''}`
      : `针对该店铺的 Claude 分析${windowDays ? ` · 最近 ${windowDays} 天` : ''}`;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-neutral-900">
              {displayTitle}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              {subtitle}
              {state.durationMs > 0 && ` · ${state.durationMs}ms`}
            </p>
          </div>
          {state.isMock && (
            <span className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-700">
              Mock(待配置 ANTHROPIC_API_KEY)
            </span>
          )}
          {!state.isMock && !state.loading && !state.error && (
            <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
              Claude 生成
            </span>
          )}
        </div>

        {state.loading && (
          <div className="py-6 text-center text-sm text-neutral-400">
            Claude 正在分析...
          </div>
        )}

        {state.error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            生成失败: <span className="font-mono text-xs">{state.error}</span>
          </div>
        )}

        {!state.loading && !state.error && state.markdown && (
          <div className="prose prose-sm prose-neutral max-w-none text-neutral-700">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="mb-2 mt-4 text-base font-bold text-neutral-900">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-2 mt-4 text-base font-bold text-neutral-900">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-1 mt-3 text-sm font-semibold text-neutral-900">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="my-1 text-sm leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="my-2 list-disc pl-5 text-sm">{children}</ul>
                ),
                li: ({ children }) => (
                  <li className="my-0.5 leading-relaxed">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-neutral-900">
                    {children}
                  </strong>
                ),
              }}
            >
              {state.markdown}
            </ReactMarkdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
