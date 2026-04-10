import { getDashboardData, formatCny, formatNumber } from '@/lib/dashboard/queries';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ShopMatrix } from '@/components/dashboard/shop-matrix';
import { InsightPanel } from '@/components/dashboard/insight-panel';
import { SyncButton } from '@/components/dashboard/sync-button';

// 强制动态渲染,每次访问都查最新数据
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  let data;
  let loadError: string | null = null;

  try {
    data = await getDashboardData(7);
  } catch (err) {
    if (err instanceof Error) {
      loadError = err.message;
    } else if (err && typeof err === 'object') {
      loadError = JSON.stringify(err);
    } else {
      loadError = String(err);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">欣远广告 Agent</h1>
          <p className="mt-1 text-sm text-neutral-500">
            TikTok Shop + Shopee 广告数据统一看板 · 最近 {data?.windowDays ?? 7} 天
            {data && (
              <span className="ml-2 text-neutral-400">
                ({data.startDate} ~ {data.endDate})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
          <a
            href="/api/auth/tiktok/authorize"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            + 连接 TikTok 店铺
          </a>
        </div>
      </header>

      {/* 错误态 */}
      {loadError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">加载失败</div>
          <div className="mt-1 font-mono text-xs">{loadError}</div>
        </div>
      )}

      {data && (
        <>
          {/* 顶部核心指标 */}
          <section className="mb-8">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <MetricCard
                title="总花费"
                value={formatCny(data.totals.spendCny)}
                subtitle="累计广告投入"
              />
              <MetricCard
                title="总 GMV"
                value={formatCny(data.totals.gmvCny)}
                subtitle="累计销售额"
              />
              <MetricCard
                title="整体 ROI"
                value={data.totals.roi.toFixed(2)}
                subtitle={data.totals.roi >= 2 ? '表现良好' : '需要关注'}
                accent={
                  data.totals.roi >= 2
                    ? 'success'
                    : data.totals.roi >= 1
                      ? 'warning'
                      : 'danger'
                }
              />
              <MetricCard
                title="花费占比"
                value={
                  data.totals.gmvCny > 0
                    ? `${((data.totals.spendCny / data.totals.gmvCny) * 100).toFixed(1)}%`
                    : '-'
                }
                subtitle="花费 / GMV"
                accent={
                  data.totals.gmvCny > 0
                    ? data.totals.spendCny / data.totals.gmvCny < 0.5
                      ? 'success'
                      : data.totals.spendCny / data.totals.gmvCny < 1
                        ? 'warning'
                        : 'danger'
                    : 'default'
                }
              />
              <MetricCard
                title="总订单"
                value={formatNumber(data.totals.orders)}
                subtitle="累计成单"
              />
            </div>
          </section>

          {/* 店铺矩阵 */}
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">店铺矩阵</h2>
            <ShopMatrix shops={data.shops} />
          </section>

          {/* Claude 洞察 */}
          <section>
            <InsightPanel windowDays={data.windowDays} />
          </section>
        </>
      )}
    </main>
  );
}
