/**
 * 6 店铺矩阵组件
 * 2 列 × 3 行网格,每个卡片展示该店铺窗口期内的核心指标
 * ROI 颜色:≥ 2 绿 / 1-2 黄 / < 1 红(符合 §11 决策 10 的"红降绿升黄异常")
 */
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { formatUsd, formatNumber, type ShopSummary } from '@/lib/dashboard/queries';

interface ShopMatrixProps {
  shops: ShopSummary[];
}

function roiColor(roi: number): string {
  if (roi >= 2) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (roi >= 1) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (roi > 0) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-neutral-50 text-neutral-500 border-neutral-200';
}

export function ShopMatrix({ shops }: ShopMatrixProps) {
  if (shops.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
        暂无已连接的店铺
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shops.map((shop) => (
        <Link key={shop.id} href={`/shops/${shop.id}`} className="group">
          <Card className="transition hover:border-neutral-400 hover:shadow-md">
            <CardContent className="p-5">
              {/* Header:国旗 + 店铺名 + ROI 徽标 */}
              <div className="mb-4 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl leading-none">{shop.flag}</span>
                    <span className="text-sm font-semibold text-neutral-900">
                      {shop.country}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-neutral-500">
                    {shop.accountName}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${roiColor(shop.roi)}`}
                >
                  ROI {shop.roi.toFixed(2)}
                </span>
              </div>

              {/* Metrics 网格 */}
              <div className="grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3">
                <div>
                  <div className="text-xs text-neutral-500">花费</div>
                  <div className="mt-0.5 text-base font-semibold text-neutral-900">
                    {formatUsd(shop.spend)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">GMV</div>
                  <div className="mt-0.5 text-base font-semibold text-neutral-900">
                    {formatUsd(shop.gmv)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">订单</div>
                  <div className="mt-0.5 text-base font-semibold text-neutral-900">
                    {formatNumber(shop.orders)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">CTR</div>
                  <div className="mt-0.5 text-base font-semibold text-neutral-900">
                    {(shop.ctr * 100).toFixed(2)}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
