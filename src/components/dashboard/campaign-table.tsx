/**
 * 广告活动列表 —— 按花费倒序
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatUsd, formatNumber, type CampaignRow } from '@/lib/dashboard/queries';

interface CampaignTableProps {
  campaigns: CampaignRow[];
}

const STATUS_LABEL: Record<string, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  enabled: { text: '运行中', variant: 'default' },
  paused: { text: '已暂停', variant: 'secondary' },
  deleted: { text: '已删除', variant: 'destructive' },
  pending: { text: '审核中', variant: 'outline' },
  rejected: { text: '被拒', variant: 'destructive' },
};

const OBJECTIVE_LABEL: Record<string, string> = {
  product_sales: '商品销量',
  traffic: '引流',
  video_views: '视频播放',
  followers: '涨粉',
  live_room_promotion: '直播推广',
};

function roiColor(roi: number): string {
  if (roi >= 2) return 'text-emerald-600 font-semibold';
  if (roi >= 1) return 'text-amber-600 font-semibold';
  if (roi > 0) return 'text-red-600 font-semibold';
  return 'text-neutral-400';
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
  if (campaigns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
        该店铺暂无广告活动
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>活动名称</TableHead>
            <TableHead>目标</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">花费</TableHead>
            <TableHead className="text-right">GMV</TableHead>
            <TableHead className="text-right">订单</TableHead>
            <TableHead className="text-right">ROI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((c) => {
            const status = STATUS_LABEL[c.status] ?? { text: c.status, variant: 'outline' as const };
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-xs text-neutral-500">
                  {c.objective ? OBJECTIVE_LABEL[c.objective] ?? c.objective : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.text}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(c.spend)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(c.gmv)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(c.orders)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${roiColor(c.roi)}`}>
                  {c.roi.toFixed(2)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
