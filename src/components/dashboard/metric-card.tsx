/**
 * 顶部核心指标卡片
 * 展示单个指标的大数字 + 标题 + 可选的次要信息
 */
import { Card, CardContent } from '@/components/ui/card';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  accent?: 'default' | 'success' | 'warning' | 'danger';
}

const accentMap: Record<NonNullable<MetricCardProps['accent']>, string> = {
  default: 'text-neutral-900',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
};

export function MetricCard({
  title,
  value,
  subtitle,
  accent = 'default',
}: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium text-neutral-500">{title}</div>
        <div className={`mt-2 text-3xl font-bold tracking-tight ${accentMap[accent]}`}>
          {value}
        </div>
        {subtitle && (
          <div className="mt-1 text-xs text-neutral-400">{subtitle}</div>
        )}
      </CardContent>
    </Card>
  );
}
