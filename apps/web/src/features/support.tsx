import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SupportEndpoints as E,
  FeedbackCategory,
  ComplaintReason,
  type SupportTicket,
  type FeedbackCategory as Category,
  type ComplaintReason as Reason,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { uploadMedia, prepareImage } from '../data/upload.js';
import { NavBar, MenuGroup, MenuRow } from './shell-kit.js';
export const feedbackLabels: Record<Category, string> = {
  bug: '功能异常',
  suggestion: '产品建议',
  character: '角色表现',
  billing: '积分与充值',
  account: '账号与登录',
  other: '其他',
};
export const reasonLabels: Record<Reason, string> = {
  inappropriate: '内容低俗、不适',
  harassment: '辱骂、骚扰',
  infringement: '侵权',
  real_person: '冒充身边真人',
  minor: '涉及未成年人不当内容',
  fraud: '诈骗、引流',
  other: '其他',
};
const states: Record<string, string> = { open: '待处理', replied: '已回复', resolved: '已解决' };
export function SupportRow() {
  const r = useRemote(E.listMine, { query: { limit: 1 }, networkOnly: true });
  useUpdates((u) => {
    if (u.type === 'data.changed' && (u.data as { section?: string })?.section === 'support')
      r.refresh();
  });
  return <MenuRow to="/support" label="帮助与反馈" dot={(r.data?.unseenCount ?? 0) > 0} />;
}
export function SupportPage() {
  const r = useRemote(E.listMine, { query: { limit: 20 }, networkOnly: true });
  const [more, setMore] = useState<SupportTicket[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setMore([]);
    setCursor(r.data?.nextCursor ?? null);
  }, [r.data]);
  useUpdates((u) => {
    if (u.type === 'data.changed' && (u.data as { section?: string })?.section === 'support')
      r.refresh();
  });
  async function load() {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await api.call(E.listMine, { query: { limit: 20, cursor } });
      setMore((v) => [...v, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <NavBar title="帮助与反馈" fallback="/settings" right={<Link to="/support/new">反馈</Link>} />
      {r.loading && !r.data && (
        <p className="empty" role="status">
          正在读取反馈…
        </p>
      )}
      {(r.error || error) && (
        <p className="page-note" role="alert">
          {error || r.error}{' '}
          <button className="text-button" type="button" onClick={r.refresh}>
            重试
          </button>
        </p>
      )}
      {!!((r.data?.items.length ?? 0) + more.length) && (
        <MenuGroup>
          {[...(r.data?.items ?? []), ...more].map((t) => (
            <MenuRow
              key={t.ticketId}
              to={'/support/tickets/' + t.ticketId}
              label={t.text || '投诉'}
              value={states[t.status] ?? t.status}
              dot={t.unseen}
              subtitle={new Date(t.createdAt).toLocaleString()}
            />
          ))}
        </MenuGroup>
      )}
      {r.data && !r.data.items.length && !more.length && <p className="empty">暂无反馈或投诉</p>}
      {cursor && (
        <button disabled={busy} onClick={() => void load()}>
          加载更多
        </button>
      )}
    </main>
  );
}
export function SupportCreatePage() {
  const [params] = useSearchParams();
  const targetId = params.get('targetId');
  const targetType = params.get('targetType') === 'plaza_work' ? 'plaza_work' : 'character';
  const complaint = !!targetId;
  const navigate = useNavigate();
  const key = useRef(crypto.randomUUID());
  const [category, setCategory] = useState<Category>('bug'),
    [reason, setReason] = useState<Reason>('inappropriate'),
    [text, setText] = useState(''),
    [images, setImages] = useState<{ mediaId: string; url: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function upload(files: FileList) {
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files).slice(0, 9 - images.length)) {
        const prepared = await prepareImage(file);
        const media = await uploadMedia('support_image', prepared.blob);
        setImages((v) => [...v, { mediaId: media.mediaId, url: media.url }]);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const t = await api.call(E.create, {
        body: {
          clientRequestId: key.current,
          kind: complaint ? 'complaint' : 'feedback',
          ...(complaint ? { target: { type: targetType, id: targetId! }, reason } : { category }),
          text,
          imageIds: images.map((i) => i.mediaId),
        },
      });
      navigate('/support/tickets/' + t.ticketId, { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <NavBar title={complaint ? '投诉' : '提交反馈'} fallback="/support" />
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {complaint ? (
          <label>
            原因
            <select
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
            >
              {ComplaintReason.options.map((v) => (
                <option key={v} value={v}>
                  {reasonLabels[v]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            类型
            <select
              disabled={busy}
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {FeedbackCategory.options.map((v) => (
                <option key={v} value={v}>
                  {feedbackLabels[v]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          说明
          <textarea
            disabled={busy}
            value={text}
            maxLength={2000}
            rows={6}
            onChange={(e) => setText(e.target.value)}
            placeholder={complaint ? '可补充说明' : '请描述遇到的问题或建议'}
          />
        </label>
        <label>
          截图（最多9张）
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy || images.length >= 9}
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <div className="request-image-grid">
          {images.map((i) => (
            <div key={i.mediaId}>
              <img src={i.url} alt="截图" width={80} />
              <button
                type="button"
                disabled={busy}
                onClick={() => setImages((v) => v.filter((x) => x.mediaId !== i.mediaId))}
              >
                移除
              </button>
            </div>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy || (!complaint && !text.trim())}>
          {busy ? '正在处理…' : '提交'}
        </button>
      </form>
    </main>
  );
}
export function SupportDetailPage() {
  const { ticketId = '' } = useParams();
  return <SupportDetail key={ticketId} ticketId={ticketId} />;
}
function SupportDetail({ ticketId }: { ticketId: string }) {
  const r = useRemote(E.get, { params: { ticketId }, networkOnly: true });
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function reply() {
    setBusy(true);
    setError('');
    try {
      await api.call(E.addReply, { params: { ticketId }, body: { text } });
      setText('');
      r.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  useUpdates((u) => {
    const data = u.data as { section?: string; itemId?: string | null } | undefined;
    if (
      u.type === 'data.changed' &&
      data?.section === 'support' &&
      (!data.itemId || data.itemId === ticketId)
    )
      r.refresh();
  });
  const t = r.data;
  return (
    <main>
      <NavBar title="反馈详情" fallback="/support" />
      {r.loading && !r.data && (
        <p className="empty" role="status">
          正在读取反馈详情…
        </p>
      )}
      {(error || r.error) && <p role="alert">{error || r.error}</p>}
      {t && (
        <>
          <article className="panel">
            <p>
              {states[t.status] ?? t.status} ·{' '}
              {t.kind === 'complaint' ? '投诉' : (feedbackLabels[t.category as Category] ?? '反馈')}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{t.text}</p>
            {t.images.map(
              (i) =>
                i.url && (
                  <a key={i.mediaId} href={i.url} target="_blank" rel="noreferrer">
                    <img src={i.url} alt="反馈截图" width={100} />
                  </a>
                ),
            )}
          </article>
          {t.replies.map((v) => (
            <article className="panel" key={v.replyId}>
              <small>
                {v.from === 'admin' ? '官方回复' : '我的补充'} ·{' '}
                {new Date(v.createdAt).toLocaleString()}
              </small>
              <p style={{ whiteSpace: 'pre-wrap' }}>{v.text}</p>
            </article>
          ))}
          {t.status !== 'resolved' && (
            <form
              className="panel stack"
              onSubmit={(e) => {
                e.preventDefault();
                void reply();
              }}
            >
              <label>
                补充说明
                <textarea
                  maxLength={2000}
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy || !text.trim()}>
                {busy ? '正在提交…' : '补充说明'}
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
