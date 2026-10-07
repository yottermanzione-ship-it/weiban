import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BillingEndpoints, type LedgerEntry, type PriceUnit } from '@weiban/contracts';
import { formatMoney, yuanToMicros } from '@weiban/client-core';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
export function WalletPage() {
  const remote = useRemote(BillingEndpoints.getWallet);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      await api.call(BillingEndpoints.updateWalletSettings, {
        body: {
          backgroundDailyLimitMicros: yuanToMicros(String(form.get('budget'))),
          lowBalanceThresholdMicros: yuanToMicros(String(form.get('threshold'))),
        },
      });
      remote.refresh();
      setMessage('已保存');
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <h1 className="page-title">余额</h1>
      <section className="panel balance">
        <p>余额</p>
        <strong>{remote.data ? formatMoney(remote.data.balanceMicros) : '—'}</strong>
        <p className="hint">如需增加余额，请联系管理员</p>
        {remote.data && remote.data.availableMicros <= 0 && <p className="error">余额不足</p>}
      </section>
      <div className="panel rows">
        <Link to="/ledger">余额明细 ›</Link>
        <Link to="/prices">价目表 ›</Link>
      </div>
      {remote.data && (
        <form key={remote.data.updatedAt} className="panel stack" onSubmit={(e) => void save(e)}>
          <h2>后台预算</h2>
          <p>今日已用 {formatMoney(remote.data.backgroundBudget.spentTodayMicros)}</p>
          <label>
            每日上限（元）
            <input
              name="budget"
              inputMode="decimal"
              required
              defaultValue={String(remote.data.backgroundBudget.dailyLimitMicros / 1_000_000)}
            />
          </label>
          <label>
            余额提醒线（元）
            <input
              name="threshold"
              inputMode="decimal"
              required
              defaultValue={String(remote.data.lowBalanceThresholdMicros / 1_000_000)}
            />
          </label>
          <button className="primary" disabled={pending}>
            保存
          </button>
        </form>
      )}
      <p role="status">{message || remote.error}</p>
    </main>
  );
}
const ledgerLabels: Record<LedgerEntry['type'], string> = {
  admin_grant: '管理员加余额',
  admin_deduct: '管理员扣余额',
  charge: '调用扣费',
  refund: '退还',
  adjustment: '调整',
};
export function LedgerPage() {
  const [cursor, setCursor] = useState<string>();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const remote = useRemote(BillingEndpoints.listLedger, {
    query: { type: 'all', limit: 30, ...(cursor ? { cursor } : {}) },
  });
  useEffect(() => {
    if (remote.data)
      setEntries((before) => {
        const seen = new Set(before.map((e) => e.entryId));
        return [...before, ...remote.data!.items.filter((e) => !seen.has(e.entryId))];
      });
  }, [remote.data]);
  return (
    <main>
      <h1 className="page-title">余额明细</h1>
      <div className="panel rows">
        {entries.map((entry) => (
          <div key={entry.entryId} className="ledger-row">
            <div>
              <strong>{ledgerLabels[entry.type]}</strong>
              <p>{entry.note || entry.modelKey || '余额变动'}</p>
              <small>{new Date(entry.createdAt).toLocaleString('zh-CN')}</small>
            </div>
            <div>
              <strong className={entry.amountMicros > 0 ? 'income' : ''}>
                {entry.amountMicros > 0 ? '+' : ''}
                {formatMoney(entry.amountMicros)}
              </strong>
              <p>余额 {formatMoney(entry.balanceAfterMicros)}</p>
            </div>
          </div>
        ))}
      </div>
      {!remote.loading && !entries.length && !remote.error && (
        <p className="empty">还没有余额变动</p>
      )}
      {remote.error && <p role="alert">{remote.error}</p>}
      {remote.data?.nextCursor && (
        <button disabled={remote.loading} onClick={() => setCursor(remote.data!.nextCursor!)}>
          查看更多
        </button>
      )}
    </main>
  );
}
const unitLabels: Record<PriceUnit, string> = {
  input_tokens_per_million: '输入 / 百万 token',
  cached_input_tokens_per_million: '缓存输入 / 百万 token',
  output_tokens_per_million: '输出 / 百万 token',
  image: '每张图片',
  tts_10k_chars: '每万字语音',
  asr_minute: '每分钟识别',
  realtime_minute: '每分钟通话',
  search_call: '每次搜索',
};
export function PricesPage() {
  const remote = useRemote(BillingEndpoints.getPrices);
  return (
    <main>
      <h1 className="page-title">价目表</h1>
      {remote.data && (
        <>
          <p className="hint">
            {remote.data.versionLabel} ·{' '}
            {new Date(remote.data.effectiveFrom).toLocaleString('zh-CN')} 生效
          </p>
          <div className="panel rows">
            {remote.data.items.map((item, index) => (
              <div key={index} className="ledger-row">
                <div>
                  <strong>{item.modelKey}</strong>
                  <p>
                    {unitLabels[item.unit]}
                    {item.band && ` · ${item.band.name} ${item.band.start}–${item.band.end}`}
                  </p>
                </div>
                <strong>{formatMoney(item.priceMicros)}</strong>
              </div>
            ))}
          </div>
        </>
      )}
      {remote.error && <p role="alert">{remote.error}</p>}
    </main>
  );
}
