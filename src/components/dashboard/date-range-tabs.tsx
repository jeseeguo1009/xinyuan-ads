/**
 * 日期范围 Tab 切换
 *
 * 服务端组件,纯 <Link> 实现,不需要客户端 JS
 * 选中态根据当前的 days 参数高亮
 */
import Link from 'next/link';

interface DateRangeTabsProps {
  /** 当前选中的天数 */
  current: number;
  /** 跳转的基础路径,默认 "/"(首页) */
  basePath?: string;
  /** 其他需要保留的 URL query 参数 */
  extraQuery?: Record<string, string | undefined>;
  /** 可选的 Tab 项,默认 7/14/30 */
  options?: { days: number; label: string }[];
}

const DEFAULT_OPTIONS = [
  { days: 7, label: '7 天' },
  { days: 14, label: '14 天' },
  { days: 30, label: '30 天' },
];

export function DateRangeTabs({
  current,
  basePath = '/',
  extraQuery = {},
  options = DEFAULT_OPTIONS,
}: DateRangeTabsProps) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
      {options.map((opt) => {
        const active = opt.days === current;
        const query = new URLSearchParams();
        query.set('days', String(opt.days));
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v) query.set(k, v);
        }
        const href = `${basePath}?${query.toString()}`;
        return (
          <Link
            key={opt.days}
            href={href}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              active
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

/** 允许的天数,防止用户乱传 URL */
const ALLOWED_DAYS = [7, 14, 30];

/** 从 searchParams 安全解析 days */
export function parseDaysParam(raw: string | string[] | undefined, fallback = 7): number {
  if (!raw) return fallback;
  const n = parseInt(Array.isArray(raw) ? raw[0]! : raw, 10);
  if (isNaN(n)) return fallback;
  return ALLOWED_DAYS.includes(n) ? n : fallback;
}
