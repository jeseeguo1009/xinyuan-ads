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
              v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
            }
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 12 }}
            stroke="#888"
            domain={[0, 'auto']}
          />
          {/* 花费占比独立刻度(0-100%),隐藏避免视觉拥挤 */}
          <YAxis yAxisId="ratio" orientation="right" domain={[0, 100]} hide />
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
              if (name === '花费占比') return [`${num.toFixed(1)}%`, '花费占比'];
              return [
                `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                name,
              ];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="left"
            dataKey="spend"
            name="花费"
            fill="#f87171"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="gmv"
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
          <Line
            yAxisId="ratio"
            type="monotone"
            dataKey="spendRatio"
            name="花费占比"
            stroke="#a855f7"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
