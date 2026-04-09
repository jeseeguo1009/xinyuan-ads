/**
 * Claude 每日洞察面板
 *
 * 当前版本:硬编码 mock 文本,用于 Phase 2 UI 验证
 * 下一步(Phase 3):接 Claude API,每天 8:30 生成并缓存真实洞察
 */
import { Card, CardContent } from '@/components/ui/card';

interface InsightPanelProps {
  windowDays: number;
}

export function InsightPanel({ windowDays }: InsightPanelProps) {
  // TODO(Phase 3): 调用 Claude API 生成,目前用 mock
  const mockInsights = [
    {
      type: 'highlight',
      text: '越南店铺本周 ROI 达 3.2,环比上升 18%,春季爆款-3 贡献主要增量',
    },
    {
      type: 'warning',
      text: '泰国店铺 ROI 跌破 1.5,建议检查春季爆款-5 活动的出价策略',
    },
    {
      type: 'info',
      text: '新加坡店铺 CTR 稳定在 3.1%,是 6 店铺中表现最好的',
    },
  ];

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-neutral-900">
              💡 每日洞察
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              基于最近 {windowDays} 天数据 · Claude 生成(mock)
            </p>
          </div>
          <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
            Phase 3 接入
          </span>
        </div>

        <ul className="space-y-3">
          {mockInsights.map((insight, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  insight.type === 'highlight'
                    ? 'bg-emerald-500'
                    : insight.type === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-neutral-400'
                }`}
              />
              <span className="text-sm leading-relaxed text-neutral-700">
                {insight.text}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
