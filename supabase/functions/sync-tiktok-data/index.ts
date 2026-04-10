/**
 * Supabase Edge Function: sync-tiktok-data
 *
 * 每小时自动拉取 TikTok Shop 数据,写入 ads schema
 *
 * 相比 src/lib/tiktok/sync.ts(Node 版),这里是 Deno 运行时,独立实现。
 * 真正的生产环境建议用这个版本作为定时任务,Node 版只用于手动同步 API。
 *
 * 部署:
 *   supabase functions deploy sync-tiktok-data
 *
 * 定时(每小时):
 *   SELECT cron.schedule('sync-tiktok-hourly', '0 * * * *',
 *     'SELECT net.http_post(url := ''https://<project>.functions.supabase.co/sync-tiktok-data'', ...)');
 *
 * 依赖环境变量:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(自动注入)
 *   TIKTOK_APP_KEY, TIKTOK_APP_SECRET(需 supabase secrets set)
 */

// @ts-expect-error Deno 运行时
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 简化版 — 仅实现框架,实际 TikTok API 调用的完整逻辑和签名见
// src/lib/tiktok/marketing-api.ts 和 sync.ts,这里只做占位 + 基础调度

// @ts-expect-error Deno 全局
Deno.serve(async (req: Request) => {
  try {
    // @ts-expect-error Deno env
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    // @ts-expect-error Deno env
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // @ts-expect-error Deno env
    const appKey = Deno.env.get('TIKTOK_APP_KEY');
    // @ts-expect-error Deno env
    const appSecret = Deno.env.get('TIKTOK_APP_SECRET');

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: 'ads' },
    });

    // 未配置 TikTok key 时直接返回(让定时任务不会刷错误)
    if (!appKey || !appSecret) {
      return new Response(
        JSON.stringify({
          success: true,
          isMock: true,
          message: 'TIKTOK_APP_KEY 未配置,跳过同步',
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 拉所有活跃的 TikTok 账户
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, external_account_id, access_token')
      .eq('platform', 'tiktok_shop')
      .eq('is_active', true);
    if (error) throw error;

    // 过滤 mock 账户
    const realAccounts = (accounts ?? []).filter(
      (a: { external_account_id: string }) =>
        !a.external_account_id?.startsWith('mock-')
    );

    // TODO: 完整实现和 src/lib/tiktok/sync.ts 等价的 Deno 版逻辑
    // 目前先记录日志,Phase 4 真正上线时补全
    for (const acc of realAccounts) {
      await supabase.from('sync_logs').insert({
        account_id: acc.id,
        sync_type: 'tiktok_edge_placeholder',
        status: 'pending',
        error_message:
          'Edge Function 版本待完整实现,当前手动同步请用 POST /api/sync/tiktok',
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        isMock: false,
        accountsFound: realAccounts.length,
        note: 'Edge Function 版本待完整实现,当前走 Next.js API Route',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[sync-tiktok-data] 失败:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
