import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getShopDetail, formatCny, formatNumber } from '@/lib/dashboard/queries';
import { MetricCard } from '@/components/dashboard/metric-card';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { CampaignTable } from '@/components/dashboard/campaign-table';
import { InsightPanel } from '@/components/dashboard/insight-panel';
import { DateRangePicker } from '@/components/dashboard/date-range-picker';
import { parseDateRangeParams } from '@/lib/dashboard/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function ShopDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { from, to } = parseDateRangeParams(sp, 30);

  let detail;
  let loadError: string | null = null;
  try {
    detail = await getShopDetail(id, { from, to });
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : err && typeof err === 'object'
          ? JSON.stringify(err)
          : String(err);
  }

  if (!loadError && !detail) notFound();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* 返回链接 */}
      <div className="mb-4">
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← 返回看板
        </Link>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">加载失败</div>
          <div className="mt-1 font-mono text-xs">{loadError}</div>
        </div>
      )}

      {detail && (
        <>
          {/* Header */}
          <header className="mb-8 flex items-end justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-4xl leading-none">{detail.shop.flag}</span>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    {detail.shop.country}
                  </h1>
                  <p className="text-sm text-neutral-500">
                    {detail.shop.accountName}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2 text-xs text-neutral-500">
                <span className="rounded bg-neutral-100 px-2 py-1">
                  币种 {detail.shop.currency}
                </span>
                <span className="rounded bg-neutral-100 px-2 py-1">
                  {detail.startDate} ~ {detail.endDate}
                </span>
              </div>
            </div>
            <DateRangePicker from={from} to={to} />
          </header>

          {/* 指标卡片 */}
          <section className="mb-8">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <MetricCard
                title="总花费"
                value={formatCny(detail.shop.spendCny)}
              />
              <MetricCard
                title="总 GMV"
                value={formatCny(detail.shop.gmvCny)}
              />
              <MetricCard
                title="ROI"
                value={detail.shop.roi.toFixed(2)}
                accent={
                  detail.shop.roi >= 2
                    ? 'success'
                    : detail.shop.roi >= 1
                      ? 'warning'
                      : 'danger'
                }
              />
              <MetricCard
                title="花费占比"
                value={
                  detail.shop.gmvCny > 0
                    ? `${((detail.shop.spendCny / detail.shop.gmvCny) * 100).toFixed(1)}%`
                    : '-'
                }
                subtitle="花费 / GMV"
                accent={
                  detail.shop.gmvCny > 0
                    ? detail.shop.spendCny / detail.shop.gmvCny < 0.5
                      ? 'success'
                      : detail.shop.spendCny / detail.shop.gmvCny < 1
                        ? 'warning'
                        : 'danger'
                    : 'default'
                }
              />
              <MetricCard
                title="总订单"
                value={formatNumber(detail.shop.orders)}
              />
            </div>
          </section>

          {/* 趋势图 */}
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">趋势({detail.windowDays} 天)</h2>
              <div className="text-xs text-neutral-400">
                柱:花费 / GMV   折线:ROI
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <TrendChart data={detail.dailySeries} />
            </div>
          </section>

          {/* 广告活动列表 */}
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">
              广告活动({detail.campaigns.length})
            </h2>
            <CampaignTable campaigns={detail.campaigns} />
          </section>

          {/* 店铺级 Claude 洞察 */}
          <section>
            <InsightPanel
              scope="shop"
              shopId={id}
              from={from}
              to={to}
              windowDays={detail.windowDays}
            />
          </section>
        </>
      )}
    </main>
  );
}
