/**
 * 日期范围工具 —— 纯服务端 / 纯函数,能在任何地方用
 */
import { format, subDays } from 'date-fns';

/** 从 searchParams 安全解析 from/to,降级为最近 N 天 */
export function parseDateRangeParams(
  params: { from?: string | string[]; to?: string | string[] },
  defaultDays = 7
): { from: string; to: string } {
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const fromRaw = pick(params.from);
  const toRaw = pick(params.to);

  const isValid = (s?: string): boolean =>
    !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (isValid(fromRaw) && isValid(toRaw)) {
    return { from: fromRaw!, to: toRaw! };
  }

  const now = new Date();
  return {
    from: format(subDays(now, defaultDays - 1), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
  };
}
