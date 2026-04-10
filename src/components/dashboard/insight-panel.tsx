'use client';

/**
 * Claude 每日洞察面板 —— 客户端组件
 *
 * 首屏渲染时 fetch /api/insights/daily 获取日报 Markdown
 * ANTHROPIC_API_KEY 未配置时后端返回 mock 文本(isMock=true),前端显示"Mock"标签
 *
 * Phase 3 后续优化:
 *  - 加 Supabase 缓存,每天只生成 1 次
 *  - 加"刷新"按钮
 *  - 加 Markdown 渲染(现在是 <pre>)
 */

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';

interface InsightPanelProps {
  windowDays: number;
}

interface ReportState {
  loading: boolean;
  error: string | null;
  markdown: string;
  isMock: boolean;
  reportDate: string;
  durationMs: number;
}

export function InsightPanel({ windowDays }: InsightPanelProps) {
  const [state, setState] = useState<ReportState>({
    loading: true,
    error: null,
    markdown: '',
    isMock: false,
    reportDate: '',
    durationMs: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/insights/daily');
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setState({
            loading: false,
            error: json.error ?? '未知错误',
            markdown: '',
            isMock: false,
            reportDate: '',
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
          reportDate: '',
          durationMs: 0,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-neutral-900">
              💡 每日洞察
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              基于最近 {windowDays} 天数据 ·{' '}
              {state.reportDate ? `报告日 ${state.reportDate}` : '加载中...'}
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
            Claude 正在生成日报...
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
                  <h1 className="mb-2 mt-4 text-base font-bold text-neutral-900">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-2 mt-4 text-base font-bold text-neutral-900">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-1 mt-3 text-sm font-semibold text-neutral-900">{children}</h3>
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
                  <strong className="font-semibold text-neutral-900">{children}</strong>
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
