import { useState } from 'react';
import { SupportAdminEndpoints as E } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, errorText } from '../data/hooks.js';
export function SupportBadge() {
  const r = useRemote(E.list, { query: { status: 'open', limit: 1 } });
  return r.data?.openCount ? <span className="badge">{r.data.openCount}</span> : null;
}
export function SupportAdminPage() {
  const [filter, setFilter] = useState<'open' | 'replied' | 'resolved'>('open'),
    [selected, setSelected] = useState<string | null>(null);
  const r = useRemote(E.list, { query: { status: filter, limit: 100 } });
  return (
    <section className="stack">
      <h1>帮助反馈与投诉</h1>
      <label>
        状态
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setSelected(null);
          }}
        >
          <option value="open">待处理</option>
          <option value="replied">已回复</option>
          <option value="resolved">已解决</option>
        </select>
      </label>
      {r.error && <p role="alert">{r.error}</p>}
      <table>
        <thead>
          <tr>
            <th>用户</th>
            <th>类型</th>
            <th>内容</th>
            <th>提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {r.data?.items.map((t) => (
            <tr key={t.ticketId}>
              <td>{t.username ?? '已注销'}</td>
              <td>{t.kind === 'complaint' ? '投诉' : '反馈'}</td>
              <td>{t.text}</td>
              <td>{new Date(t.createdAt).toLocaleString()}</td>
              <td>
                <button onClick={() => setSelected(t.ticketId)}>处理</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.data?.nextCursor && <p className="hint">仅展示当前最早100条，处理后刷新继续。</p>}
      {selected && (
        <TicketEditor
          key={selected}
          ticketId={selected}
          close={() => setSelected(null)}
          changed={r.refresh}
        />
      )}
    </section>
  );
}
export function TicketEditor({
  ticketId,
  close,
  changed,
}: {
  ticketId: string;
  close: () => void;
  changed: () => void;
}) {
  const r = useRemote(E.get, { params: { ticketId } });
  const [text, setText] = useState(''),
    [resolve, setResolve] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function act(action: 'reply' | 'resolve' | 'reopen') {
    setBusy(true);
    setError('');
    try {
      if (action === 'reply')
        await api.call(E.reply, { params: { ticketId }, body: { text, resolve } });
      else await api.call(action === 'resolve' ? E.resolve : E.reopen, { params: { ticketId } });
      setText('');
      r.refresh();
      changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const t = r.data;
  return (
    <section className="panel stack">
      <button disabled={busy} onClick={close}>
        关闭
      </button>
      {(error || r.error) && <p role="alert">{error || r.error}</p>}
      {t && (
        <>
          <h2>
            {t.kind === 'complaint' ? '投诉' : '反馈'} · {t.username ?? '已注销'}
          </h2>
          <p>
            对象：{t.target?.type ?? '无'} {t.target?.id} · 原因：{t.reason ?? t.category}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.text}</p>
          <div>
            {t.images.map(
              (i) =>
                i.url && (
                  <a key={i.mediaId} href={i.url} target="_blank" rel="noreferrer">
                    <img width={120} src={i.url} alt="反馈截图" />
                  </a>
                ),
            )}
          </div>
          {t.replies.map((v) => (
            <article key={v.replyId}>
              <small>
                {v.from === 'admin' ? '官方' : '用户'} · {new Date(v.createdAt).toLocaleString()}
              </small>
              <p style={{ whiteSpace: 'pre-wrap' }}>{v.text}</p>
            </article>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act('reply');
            }}
          >
            <label>
              回复
              <textarea
                maxLength={2000}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={resolve}
                disabled={busy}
                onChange={(e) => setResolve(e.target.checked)}
              />
              同时标记解决
            </label>
            <button disabled={busy || !text.trim()}>回复</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(t.status === 'resolved' ? 'reopen' : 'resolve')}
            >
              {t.status === 'resolved' ? '重新打开' : '标记解决'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
