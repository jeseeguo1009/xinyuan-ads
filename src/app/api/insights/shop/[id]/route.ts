/**
 * GET /api/insights/shop/:id
 *
 * 店铺级洞察(针对单个店铺的 Claude 分析)
 *
 * 支持查询参数:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  自定义日期范围
 *   ?days=30                        或用天数(向后兼容)
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateShopInsight } from '@/lib/dashboard/shop-insight';
import { parseDateRangeParams } from '@/lib/dashboard/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const { from, to } = parseDateRangeParams(
      { from: searchParams.get('from') ?? undefined, to: searchParams.get('to') ?? undefined },
      30
    );

    const result = await generateShopInsight(id, { from, to });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[/api/insights/shop/:id] 失败:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
