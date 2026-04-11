'use client';

/**
 * 广告数据导入按钮
 *
 * 功能:
 *  1. 点击弹出导入面板(不是 modal,是展开面板)
 *  2. 选择文件 + 选择店铺 + 选择日期 + 汇率
 *  3. 提交后显示结果
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Account {
  id: string;
  account_name: string;
  market: string;
  currency: string;
}

export function ImportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);

  // 表单状态
  const [accountId, setAccountId] = useState('');
  const [statDate, setStatDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [exchangeRate, setExchangeRate] = useState('7.2');
  const [file, setFile] = useState<File | null>(null);

  // 结果
  const [result, setResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // 打开面板时加载账户列表
  useEffect(() => {
    if (!open) return;
    fetch('/api/import/ads')
      .then((r) => r.json())
      .then((data) => {
        setAccounts(data.accounts ?? []);
        if (data.accounts?.length === 1) {
          setAccountId(data.accounts[0].id);
        }
      })
      .catch(() => {});
  }, [open]);

  // 从文件名解析日期
  function handleFileChange(f: File | null) {
    setFile(f);
    if (!f) return;
    // 尝试从文件名提取日期: "Product campaign data 2026-04-10 - 2026-04-10.xlsx"
    const match = f.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) {
      setStatDate(match[1]);
    }
  }

  async function handleSubmit() {
    if (!file || !accountId || !statDate) return;

    setLoading(true);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('accountId', accountId);
      fd.append('statDate', statDate);
      fd.append('exchangeRate', exchangeRate);

      const res = await fetch('/api/import/ads', { method: 'POST', body: fd });
      const json = await res.json();

      if (json.success) {
        const s = json.summary;
        setResult({
          type: 'success',
          message: `导入成功! ${s.campaignsUpserted} 个广告计划, ${s.totalOrders} 单, 花费 $${s.totalSpendUsd}, GMV $${s.totalGmvUsd}`,
        });
        router.refresh();
        // 3 秒后关闭
        setTimeout(() => {
          setOpen(false);
          setResult(null);
          setFile(null);
          if (fileRef.current) fileRef.current.value = '';
        }, 3000);
      } else {
        setResult({ type: 'error', message: json.error ?? '导入失败' });
      }
    } catch (err) {
      setResult({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
      >
        {open ? '收起' : '📥 导入数据'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
          <h3 className="mb-3 text-sm font-semibold text-neutral-800">
            导入 Seller Center 广告报表
          </h3>

          {/* 文件选择 */}
          <label className="mb-2 block text-xs text-neutral-500">
            选择 xlsx 文件
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="mb-3 w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-neutral-700 hover:file:bg-neutral-200"
          />

          {/* 店铺选择 */}
          <label className="mb-1 block text-xs text-neutral-500">
            导入到哪个店铺
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mb-3 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-xs"
          >
            <option value="">-- 选择店铺 --</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name} ({a.market})
              </option>
            ))}
          </select>

          {/* 日期 */}
          <label className="mb-1 block text-xs text-neutral-500">
            统计日期
          </label>
          <input
            type="date"
            value={statDate}
            onChange={(e) => setStatDate(e.target.value)}
            className="mb-3 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-xs"
          />

          {/* 汇率 */}
          <label className="mb-1 block text-xs text-neutral-500">
            USD → CNY 汇率
          </label>
          <input
            type="number"
            step="0.01"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(e.target.value)}
            className="mb-4 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-xs"
          />

          {/* 提交 */}
          <button
            onClick={handleSubmit}
            disabled={loading || !file || !accountId || !statDate}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '导入中...' : '开始导入'}
          </button>

          {/* 结果 */}
          {result && (
            <div
              className={`mt-3 rounded-md p-2 text-xs ${
                result.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
