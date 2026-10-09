import { useState } from 'react';
import { BillingEndpoints } from '@weiban/contracts';
import { formatMoney } from '@weiban/client-core';
import { useRemote } from '../data/use-remote.js';

type UsageSummaryRow = {
  key: string;
  amountMicros: number;
  calls: number;
};

type GroupBy = 'day' | 'character' | 'category' | 'model';
const groupOptions: { key: GroupBy; label: string }[] = [
  { key: 'day', label: '按天' },
  { key: 'character', label: '按角色' },
  { key: 'category', label: '按用途' },
  { key: 'model', label: '按模型' },
];

const categoryLabels: Record<string, string> = {
  chat: '聊天',
  background: '后台',
  media: '媒体',
  import: '导入',
  safety: '安全检查',
  admin: '平台',
  planning: '行为规划',
  unsupported: '其他',
};

function formatKey(key: string, groupBy: GroupBy): string {
  if (groupBy === 'day') {
    const d = new Date(key);
    return isNaN(d.getTime()) ? key : d.toLocaleDateString('zh-CN');
  }
  if (groupBy === 'category') return categoryLabels[key] ?? key;
  return key;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function UsagePage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [range, setRange] = useState<7 | 30>(7);

  const from = daysAgo(range - 1);
  const to = todayLocal();

  const remote = useRemote(BillingEndpoints.getUsageSummary, {
    query: { from, to, groupBy },
  });

  const rows: UsageSummaryRow[] = remote.data?.rows ?? [];
  const total = remote.data?.totalMicros ?? 0;
  const maxAmount = rows.reduce((m, r) => Math.max(m, r.amountMicros), 1);

  return (
    <main>
      <h1 className="page-title">花费统计</h1>
      <div className="filter-row" role="group" aria-label="时间范围">
        {([7, 30] as const).map((days) => (
          <button
            key={days}
            className={`filter-btn${range === days ? ' active' : ''}`}
            aria-pressed={range === days}
            onClick={() => setRange(days)}
          >
            近 {days} 天
          </button>
        ))}
      </div>
      <div className="filter-row" role="group" aria-label="分组方式">
        {groupOptions.map(({ key, label }) => (
          <button
            key={key}
            className={`filter-btn${groupBy === key ? ' active' : ''}`}
            aria-pressed={groupBy === key}
            onClick={() => setGroupBy(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {remote.error && <p role="alert">{remote.error}</p>}
      <section className="panel balance">
        <p>合计</p>
        <strong>{formatMoney(total)}</strong>
        <p className="hint">
          {from} 至 {to}
        </p>
      </section>
      <div className="panel rows usage-list">
        {rows.length === 0 && !remote.loading && <p className="empty">该时段暂无花费数据</p>}
        {rows.map((row) => (
          <div key={row.key} className="usage-row">
            <div className="usage-label">
              <strong>{formatKey(row.key, groupBy)}</strong>
              <p className="hint">{row.calls} 次调用</p>
            </div>
            <div className="usage-bar-col">
              <div
                className="usage-bar"
                style={{ width: `${Math.round((row.amountMicros / maxAmount) * 100)}%` }}
                role="presentation"
              />
            </div>
            <strong className="usage-amount">{formatMoney(row.amountMicros)}</strong>
          </div>
        ))}
      </div>
      <p className="hint page-foot">数字为实际扣费，与余额明细一致</p>
    </main>
  );
}
