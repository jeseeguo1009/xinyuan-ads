'use client';

/**
 * 趋势图组件 —— 客户端组件(Recharts 依赖 window)
 * 双 Y 轴:左轴金额(柱:花费+GMV),右轴 ROI(折线)
 */
import {
  Bar,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import type { DailyPoint } from '@/lib/dashboard/queries';

interface TrendChartProps {
  data: DailyPoint[];
}

export function TrendChart({ data }: TrendChartProps) {
  // 格式化日期为 MM-DD
  const chartData = data.map((d) => ({
    ...d,
    label: d.date.slice(5), // "04-10"
  }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#888" />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 12 }}
            stroke="#888"
            tickFormatter={(v) =>
              v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`
            }
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 12 }}
            stroke="#888"
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              background: 'white',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : Number(value);
              if (name === 'ROI') return [num.toFixed(2), 'ROI'];
              return [
                `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`,
                name,
              ];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="left"
            dataKey="spendCny"
            name="花费"
            fill="#f87171"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="gmvCny"
            name="GMV"
            fill="#34d399"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="roi"
            name="ROI"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
