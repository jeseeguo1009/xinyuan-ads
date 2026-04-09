/**
 * Supabase 服务端客户端
 *
 * 两种模式:
 * 1. createServerClient()      - 使用登录用户的 session(受 RLS 保护)
 * 2. createServiceRoleClient() - 使用 Service Role(绕过 RLS,仅用于系统级操作)
 *
 * ⚠️ Service Role Key 绝对不能暴露给浏览器
 */
import {
  createServerClient as createSSRClient,
  type CookieOptions,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * 用户会话版本:读取 cookie 里的 session
 * 用于需要识别当前登录用户的场景
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component 中可能无法写 cookie,忽略即可
          }
        },
      },
    }
  );
}

/**
 * Service Role 版本:绕过 RLS,拥有完整权限
 * 仅用于:
 *  - 写入 OAuth token 等敏感数据
 *  - 后台定时任务
 *  - 系统级数据操作
 */
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: 'ads', // 默认走 ads schema
      },
    }
  );
}
