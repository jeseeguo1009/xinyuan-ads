/**
 * GET /api/insights/daily
 *
 * 返回今天的运营日报(Markdown)
 *
 * 行为:
 *  - 无缓存:每次调用都会重新聚合数据 + 调 Claude(ANTHROPIC_API_KEY 未配置时走 mock)
 *  - 前端首页 InsightPanel 通过 fetch 调用
 *  - 未来 Phase 3 完整接入后可加 Supabase 缓存(每天只生成 1 次)
 */

import { NextResponse } from 'next/server';
import { generateDailyReport } from '@/lib/dashboard/daily-report';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const report = await generateDailyReport();
    return NextResponse.json({
      success: true,
      ...report,
    });
  } catch (err) {
    console.error('[/api/insights/daily] 失败:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
