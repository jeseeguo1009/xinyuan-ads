'use client';

/**
 * 日期范围选择器
 *
 * 特性:
 *  - 快捷按钮:7 天 / 14 天 / 30 天 / 本月 / 上月
 *  - 自定义日历:Popover + shadcn Calendar(range 模式)
 *  - 选完后跳转 URL: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  - 当前选中的快捷或自定义会高亮
 */

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { format, subDays, startOfMonth, endOfMonth, subMonths, isSameDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DateRangePickerProps {
  /** 当前 URL 中的 from/to */
  from: string;
  to: string;
}

interface Preset {
  key: string;
  label: string;
  getRange: () => { from: Date; to: Date };
}

const PRESETS: Preset[] = [
  {
    key: '7d',
    label: '7 天',
    getRange: () => ({ from: subDays(new Date(), 6), to: new Date() }),
  },
  {
    key: '14d',
    label: '14 天',
    getRange: () => ({ from: subDays(new Date(), 13), to: new Date() }),
  },
  {
    key: '30d',
    label: '30 天',
    getRange: () => ({ from: subDays(new Date(), 29), to: new Date() }),
  },
  {
    key: 'thisMonth',
    label: '本月',
    getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }),
  },
  {
    key: 'lastMonth',
    label: '上月',
    getRange: () => ({
      from: startOfMonth(subMonths(new Date(), 1)),
      to: endOfMonth(subMonths(new Date(), 1)),
    }),
  },
];

export function DateRangePicker({ from, to }: DateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<DateRange | undefined>({
    from: new Date(from),
    to: new Date(to),
  });

  const currentFrom = new Date(from);
  const currentTo = new Date(to);

  const activePreset = PRESETS.find((p) => {
    const r = p.getRange();
    return isSameDay(r.from, currentFrom) && isSameDay(r.to, currentTo);
  });

  function navigate(fromDate: Date, toDate: Date) {
    const params = new URLSearchParams();
    params.set('from', format(fromDate, 'yyyy-MM-dd'));
    params.set('to', format(toDate, 'yyyy-MM-dd'));
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyPreset(preset: Preset) {
    const r = preset.getRange();
    navigate(r.from, r.to);
  }

  function applyCustom() {
    if (pending?.from && pending?.to) {
      navigate(pending.from, pending.to);
      setOpen(false);
    }
  }

  const rangeLabel =
    isSameDay(currentFrom, currentTo)
      ? format(currentFrom, 'yyyy-MM-dd')
      : `${format(currentFrom, 'MM-dd')} ~ ${format(currentTo, 'MM-dd')}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 快捷按钮 */}
      <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
        {PRESETS.map((preset) => {
          const active = activePreset?.key === preset.key;
          return (
            <button
              key={preset.key}
              onClick={() => applyPreset(preset)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                active
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 自定义日历 */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            !activePreset
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          📅 {!activePreset ? rangeLabel : '自定义'}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="end" sideOffset={8}>
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={pending}
            onSelect={setPending}
            defaultMonth={currentFrom}
            locale={zhCN}
            weekStartsOn={1}
            className="[--cell-size:--spacing(9)]"
            classNames={{
              months: 'flex flex-col gap-6 md:flex-row md:gap-8',
              caption_label: 'text-sm font-semibold text-neutral-900',
              month_caption:
                'flex h-9 w-full items-center justify-center text-sm font-semibold text-neutral-900',
              weekday:
                'h-8 w-9 text-center text-xs font-medium text-neutral-400',
              day: 'relative h-9 w-9 p-0 text-center text-sm',
              day_button:
                'h-9 w-9 rounded-md font-normal text-neutral-700 hover:bg-neutral-100 aria-selected:opacity-100',
              selected:
                'bg-neutral-900 text-white hover:bg-neutral-800 focus:bg-neutral-900',
              range_start:
                'rounded-l-md bg-neutral-900 text-white [&>button]:bg-neutral-900 [&>button]:text-white',
              range_end:
                'rounded-r-md bg-neutral-900 text-white [&>button]:bg-neutral-900 [&>button]:text-white',
              range_middle:
                'bg-neutral-100 text-neutral-900 [&>button]:bg-transparent [&>button]:text-neutral-900',
              today: 'font-semibold underline underline-offset-2',
              outside: 'text-neutral-300',
              disabled: 'text-neutral-200',
            }}
          />
          <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3">
            <div className="text-xs text-neutral-500">
              {pending?.from && (
                <>
                  {format(pending.from, 'yyyy-MM-dd')}
                  {pending.to &&
                    !isSameDay(pending.from, pending.to) &&
                    ` ~ ${format(pending.to, 'yyyy-MM-dd')}`}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                onClick={applyCustom}
                disabled={!pending?.from || !pending?.to}
                className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                应用
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// parseDateRangeParams 抽到了 src/lib/dashboard/date-range.ts
// 因为 'use client' 文件里的 export 不能在服务端组件里调用
