import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PushAdminEndpoints, type AdminAlert } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
const labels: Record<string, string> = {
  platform_budget_warning: '平台预算',
  reconciliation_flagged: '对账异常',
  upstream_quota_exhausted: '上游余额',
  upstream_invalid: '上游凭据',
  upstream_unavailable: '上游故障',
  upstream_recovered: '上游恢复',
};
export function AlertBadge() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const abort = new AbortController();
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api.call(PushAdminEndpoints.listAdminAlerts, {
          query: { status: 'open', limit: 1 },
          signal: abort.signal,
        });
        if (active) setCount(result.openCount);
      } catch {
        if (active) setCount(null);
      } finally {
        inFlight = false;
      }
    };
    const update = () => void refresh();
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    window.addEventListener('weiban-admin:alerts-changed', update);
    return () => {
      active = false;
      abort.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('weiban-admin:alerts-changed', update);
    };
  }, []);
  return count !== null && count > 0 ? (
    <span className="alert-badge" aria-label={`${count}条未处理提醒`}>
      {count > 99 ? '99+' : count}
    </span>
  ) : null;
}
export function AlertsPage() {
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [items, setItems] = useState<AdminAlert[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  const load = useCallback(
    async (next?: string) => {
      const generation = ++revision.current;
      lifetime.current?.abort();
      const abort = new AbortController();
      lifetime.current = abort;
      setLoading(true);
      setError('');
      try {
        const page = await api.call(PushAdminEndpoints.listAdminAlerts, {
          query: { status, cursor: next, limit: 50 },
          signal: abort.signal,
        });
        if (generation !== revision.current) return;
        setItems((previous) =>
          next
            ? [
                ...new Map(
                  [...previous, ...page.items].map((item) => [item.alertId, item]),
                ).values(),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
        setCount(page.openCount);
      } catch (e) {
        if (generation === revision.current && !abort.signal.aborted) setError(errorText(e));
      } finally {
        if (generation === revision.current) setLoading(false);
      }
    },
    [status],
  );
  const cancelLoad = useCallback(() => {
    revision.current++;
    lifetime.current?.abort();
  }, []);
  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load();
    return cancelLoad;
  }, [load, cancelLoad]);
  async function acknowledge(alertId: string) {
    if (pending) return;
    setPending(alertId);
    setError('');
    setMessage('');
    const generation = revision.current;
    try {
      await api.call(PushAdminEndpoints.acknowledgeAdminAlert, { params: { alertId } });
      if (generation !== revision.current) return;
      setMessage('已标记为已处理');
      window.dispatchEvent(new Event('weiban-admin:alerts-changed'));
      await load();
    } catch (e) {
      if (generation === revision.current) setError(errorText(e));
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <h1>运行提醒</h1>
      <div className="panel form-grid">
        <label>
          提醒范围
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value === 'all' ? 'all' : 'open')}
          >
            <option value="open">未处理</option>
            <option value="all">全部（90天）</option>
          </select>
        </label>
        <p>未处理提醒：{count}</p>
        <button disabled={loading} onClick={() => void load()}>
          刷新
        </button>
      </div>
      <Feedback error={error} message={message} />
      {loading && <p role="status">正在读取提醒…</p>}
      {!loading && !error && items.length === 0 && <p>暂无提醒</p>}
      <table>
        <thead>
          <tr>
            <th>类别与级别</th>
            <th>说明</th>
            <th>次数</th>
            <th>最后发生时间（北京时间）</th>
            <th>处理</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.alertId}>
              <td>
                {labels[item.kind] ?? '其他提醒'} ·{' '}
                {item.severity === 'critical'
                  ? '严重'
                  : item.severity === 'warning'
                    ? '警告'
                    : item.severity === 'info'
                      ? '信息'
                      : '未知级别'}
              </td>
              <td>
                {item.summary}
                {item.refs?.upstreamId && (
                  <>
                    {' '}
                    <Link to="/upstreams">查看上游</Link>
                  </>
                )}
                {item.refs?.modelKey && (
                  <>
                    {' '}
                    <Link to="/catalog">查看模型</Link>
                  </>
                )}
              </td>
              <td>{item.occurrences}</td>
              <td>
                {new Date(item.lastRaisedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              </td>
              <td>
                {item.acknowledgedAt ? (
                  '已处理'
                ) : (
                  <button
                    disabled={pending !== null}
                    onClick={() => void acknowledge(item.alertId)}
                  >
                    标记已处理
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor && (
        <button disabled={loading} onClick={() => void load(cursor)}>
          加载更多提醒
        </button>
      )}
    </>
  );
}
