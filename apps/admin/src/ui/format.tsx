import type { ReactNode } from 'react';

/** 1 元 = 1,000,000 微元 = 100 积分；1 积分 = 10,000 微元。 */
export const MICROS_PER_YUAN = 1_000_000;
export const MICROS_PER_POINT = 10_000;

export function yuanOf(micros: number): number {
  return micros / MICROS_PER_YUAN;
}

export function pointsOf(micros: number): number {
  return micros / MICROS_PER_POINT;
}

export function formatYuan(micros: number, digits = 2): string {
  const value = yuanOf(micros);
  const abs = Math.abs(value);
  const text = abs >= 10_000 ? Math.round(abs).toLocaleString('zh-CN') : abs.toFixed(digits);
  return `${value < 0 ? '-' : ''}¥${text}`;
}

export function formatPoints(micros: number): string {
  const value = pointsOf(micros);
  const abs = Math.abs(value);
  const text =
    abs >= 1000
      ? Math.round(abs).toLocaleString('zh-CN')
      : abs.toFixed(abs < 10 ? 2 : 0).replace(/\.00$/, '');
  return `${value < 0 ? '-' : ''}${text}`;
}

/** 金额统一同时显示「元」和「积分」。 */
export function Money({
  micros,
  strong,
  points = true,
}: {
  micros: number;
  strong?: boolean;
  points?: boolean;
}) {
  return (
    <span className={strong ? 'money money-strong' : 'money'}>
      {formatYuan(micros)}
      {points && <span className="money-sub">{formatPoints(micros)} 积分</span>}
    </span>
  );
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('zh-CN');
}

export function formatPercent(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(value);
}

/** 北京时间自然日 00:00 的 UTC 时间戳。 */
export function startOfBeijingDay(offsetDays = 0): string {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 3_600_000);
  beijing.setUTCHours(0, 0, 0, 0);
  beijing.setUTCDate(beijing.getUTCDate() + offsetDays);
  return new Date(beijing.getTime() - 8 * 3_600_000).toISOString();
}

export function beijingDayKey(value: string): string {
  const d = new Date(value);
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function beijingHourLabel(value: string): string {
  const d = new Date(value);
  const beijing = new Date(d.getTime() + 8 * 3_600_000);
  return `${String(beijing.getUTCHours()).padStart(2, '0')}:00`;
}

export function weekdayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00+08:00`);
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] ?? '';
}

export function textOrDash(value: ReactNode): ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  return value;
}
