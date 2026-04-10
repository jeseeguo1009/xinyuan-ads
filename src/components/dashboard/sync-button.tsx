'use client';

/**
 * 手动同步按钮
 * 点击后 POST /api/sync/tiktok,显示同步结果
 *
 * 未配置 TIKTOK_APP_KEY 时后端会返回 isMock=true,按钮显示 mock 提示
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SyncButtonProps {
  /** 最近一次同步时间(ISO 字符串),用于显示 "X 分钟前" */
  lastSyncedAt?: string | null;
}

export function SyncButton({ lastSyncedAt }: SyncButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>(
    'info'
  );

  async function handleSync() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/tiktok', { method: 'POST' });
      const json = await res.json();
      if (json.isMock) {
        setMessageType('info');
        setMessage('Mock 模式(未配置 TIKTOK_APP_KEY)');
      } else if (json.success) {
        const totalMetrics = (json.results ?? []).reduce(
          (s: number, r: { metricsUpserted?: number }) =>
            s + (r.metricsUpserted ?? 0),
          0
        );
        setMessageType('success');
        setMessage(`同步成功 · ${totalMetrics} 条指标已更新`);
        router.refresh(); // 刷新 RSC 数据
      } else {
        setMessageType('error');
        setMessage(`同步失败: ${json.error ?? '未知错误'}`);
      }
    } catch (err) {
      setMessageType('error');
      setMessage(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
      // 3 秒后自动清除消息
      setTimeout(() => setMessage(null), 3000);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {lastSyncedAt && (
          <span className="text-xs text-neutral-400">
            上次同步 {formatRelative(lastSyncedAt)}
          </span>
        )}
        <button
          onClick={handleSync}
          disabled={loading}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '同步中...' : '🔄 立即同步'}
        </button>
      </div>
      {message && (
        <span
          className={`text-xs ${
            messageType === 'success'
              ? 'text-emerald-600'
              : messageType === 'error'
                ? 'text-red-600'
                : 'text-neutral-500'
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return `${day} 天前`;
}
