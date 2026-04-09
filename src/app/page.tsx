import { createServiceRoleClient } from '@/lib/supabase/server';

// 首页服务端渲染:拉取已连接的广告账户列表
export default async function HomePage() {
  let accounts: Array<{
    id: string;
    platform: string;
    market: string;
    account_name: string;
    is_active: boolean;
  }> = [];
  let loadError: string | null = null;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('accounts')
      .select('id, platform, market, account_name, is_active')
      .order('created_at', { ascending: false });

    if (error) throw error;
    accounts = data ?? [];
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-bold">欣远广告 Agent</h1>
        <p className="mt-2 text-neutral-600">
          TikTok Shop + Shopee 广告数据统一看板
        </p>
      </header>

      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">已连接店铺</h2>
          <a
            href="/api/auth/tiktok/authorize"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + 连接 TikTok 店铺
          </a>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            加载失败:{loadError}
            <div className="mt-1 text-xs text-red-500">
              检查 .env.local 是否配置了 Supabase 环境变量
            </div>
          </div>
        )}

        {!loadError && accounts.length === 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            暂无已连接的店铺,点击右上角按钮开始授权
          </div>
        )}

        {accounts.length > 0 && (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {accounts.map((acc) => (
              <li
                key={acc.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <div className="font-medium">{acc.account_name}</div>
                  <div className="text-xs text-neutral-500">
                    {acc.platform.toUpperCase()} · {acc.market.toUpperCase()}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    acc.is_active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {acc.is_active ? '已激活' : '未激活'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
