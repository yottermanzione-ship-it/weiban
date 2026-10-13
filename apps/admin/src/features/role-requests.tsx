/**
 * 角色创建 › 申请制作的后台处理（总经理 10-14 裁定 2.3；契约 RoleRequestAdminEndpoints 3.5）。
 * 列表（按状态筛选，待处理最早在前）→ 详情：接单 / 填进度 / 完成并选已上架预设角色（默认自动加到用户通讯录）/ 拒绝；
 * 另有「价格与开关」：是否开放、每次积分价格（预留，目前只记录不扣）、每人同时未完成上限。
 * 所有写操作服务器写审计。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  CharacterAdminEndpoints,
  RoleRequestAdminEndpoints,
  type AdminRoleRequest,
  type RoleRequestStatus,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

const AUDIT = <small className="hint">此操作会记入审计记录，并通知申请人</small>;
const statusNames: Record<string, [string, string]> = {
  pending: ['待处理', 'tag warning'],
  in_progress: ['制作中', 'tag'],
  completed: ['已完成', 'tag success'],
  rejected: ['已拒绝', 'tag danger'],
  cancelled: ['已撤回', 'tag'],
};
const basisNames: Record<string, string> = {
  real_person: '真人',
  fictional: '虚构',
  original: '原创',
};
function beijing(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function Status({ status }: { status: string }) {
  const [label, cls] = statusNames[status] ?? ['未知', 'tag'];
  return <span className={cls}>{label}</span>;
}

const CHANGED = 'weiban-admin:role-requests-changed';

/** 菜单角标：待处理申请数（处理后随事件刷新）。 */
export function RoleRequestBadge() {
  const list = useRemote(RoleRequestAdminEndpoints.list, {
    query: { status: 'pending', limit: 1 },
  });
  const { refresh } = list;
  useEffect(() => {
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh]);
  const count = list.data?.pendingCount ?? 0;
  return count > 0 ? <span className="alert-badge">{count}</span> : null;
}

export function RoleRequestsPage() {
  const [tab, setTab] = useState<'list' | 'config'>('list');
  return (
    <>
      <h1>制作申请</h1>
      <p className="hint">
        用户在「角色创建 ›
        申请制作」提交的角色需求。完成前请先在「角色库」建好并上架角色，再在这里选中它。
      </p>
      <div className="card-tabs" role="tablist">
        {(
          [
            ['list', '申请列表'],
            ['config', '价格与开关'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'list' ? <RequestList /> : <ConfigPanel />}
    </>
  );
}

function RequestList() {
  const [status, setStatus] = useState<'' | RoleRequestStatus>('pending');
  const [userId, setUserId] = useState('');
  const [applied, setApplied] = useState({
    status: 'pending' as '' | RoleRequestStatus,
    userId: '',
  });
  const [items, setItems] = useState<AdminRoleRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError('');
      try {
        const page = await api.call(RoleRequestAdminEndpoints.list, {
          query: {
            status: applied.status || undefined,
            userId: applied.userId.trim() || undefined,
            cursor: after,
          },
        });
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setPendingCount(page.pendingCount);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [applied],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <form
        className="panel inline"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ status, userId });
        }}
      >
        <label>
          状态
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | RoleRequestStatus)}
          >
            <option value="">全部</option>
            <option value="pending">待处理{pendingCount ? `（${pendingCount}）` : ''}</option>
            <option value="in_progress">制作中</option>
            <option value="completed">已完成</option>
            <option value="rejected">已拒绝</option>
            <option value="cancelled">已撤回</option>
          </select>
        </label>
        <label>
          用户 ID
          <input value={userId} onChange={(e) => setUserId(e.target.value)} />
        </label>
        <button className="primary">查询</button>
      </form>
      {error && (
        <p role="alert" className="error-banner">
          加载失败：{error} <button onClick={() => void load()}>重试</button>
        </p>
      )}
      {loading && items.length === 0 && <div className="skeleton-line" role="status" />}
      {!loading && !error && items.length === 0 && <p className="hint">没有符合条件的申请</p>}
      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>角色名</th>
              <th>申请人</th>
              <th>类型</th>
              <th>出处</th>
              <th>状态</th>
              <th>最新留言</th>
              <th>提交时间（北京时间）</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.requestId}
                className={selected === r.requestId ? 'selected' : ''}
                onClick={() => setSelected(r.requestId)}
              >
                <td>{r.roleName}</td>
                <td>{r.username ?? '已注销'}</td>
                <td>{basisNames[r.basis ?? ''] ?? '不确定'}</td>
                <td>{r.sourceWork || '—'}</td>
                <td>
                  <Status status={r.status} />
                </td>
                <td>{r.adminMessage ?? '—'}</td>
                <td>{beijing(r.createdAt)}</td>
                <td>{beijing(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cursor && (
        <button disabled={loading} onClick={() => void load(cursor)}>
          加载更多
        </button>
      )}
      {selected && (
        <RequestDrawer
          key={selected}
          requestId={selected}
          onClose={() => setSelected(null)}
          onChanged={(r) => {
            setItems((prev) => prev.map((x) => (x.requestId === r.requestId ? r : x)));
            window.dispatchEvent(new Event(CHANGED));
            void api
              .call(RoleRequestAdminEndpoints.list, { query: { status: 'pending', limit: 1 } })
              .then((page) => setPendingCount(page.pendingCount))
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}

type Action = 'accept' | 'progress' | 'complete' | 'reject';

function RequestDrawer({
  requestId,
  onClose,
  onChanged,
}: {
  requestId: string;
  onClose(): void;
  onChanged(r: AdminRoleRequest): void;
}) {
  const remote = useRemote(RoleRequestAdminEndpoints.get, { params: { requestId } });
  const [data, setData] = useState<AdminRoleRequest | null>(null);
  const r = data ?? remote.data ?? null;
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [addToContacts, setAddToContacts] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run() {
    if (!action) return;
    setPending(true);
    setError('');
    try {
      const params = { requestId };
      const msg = text.trim();
      const result =
        action === 'accept'
          ? await api.call(RoleRequestAdminEndpoints.accept, {
              params,
              body: msg ? { message: msg } : {},
            })
          : action === 'progress'
            ? await api.call(RoleRequestAdminEndpoints.progress, { params, body: { message: msg } })
            : action === 'reject'
              ? await api.call(RoleRequestAdminEndpoints.reject, { params, body: { message: msg } })
              : await api.call(RoleRequestAdminEndpoints.complete, {
                  params,
                  body: { characterId, addToContacts, ...(msg ? { message: msg } : {}) },
                });
      setData(result);
      onChanged(result);
      setMessage(
        { accept: '已接单', progress: '已更新进度', complete: '已完成', reject: '已拒绝' }[action],
      );
      setAction(null);
      setText('');
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.code === 'character_not_available'
          ? '这个角色不存在或还没上架，请先在「角色库」上架'
          : errorText(e),
      );
    } finally {
      setPending(false);
    }
  }
  const open = r && (r.status === 'pending' || r.status === 'in_progress');
  const needText = action === 'progress' || action === 'reject';
  return (
    <aside className="panel stack" role="dialog" aria-label="制作申请详情">
      <div className="page-head">
        <h2>{r ? `「${r.roleName}」` : '制作申请'}</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      {remote.error && !r && <p className="error">{remote.error}</p>}
      {!r && !remote.error && <div className="skeleton-line" role="status" />}
      {r && (
        <>
          <Feedback message={message} />
          <p className="hint">
            申请人：{r.username ?? '已注销'}（用户 ID {r.userId}） · <Status status={r.status} />
            {r.pointsCost > 0 && ` · 价格 ${r.pointsCost} 积分（已扣 ${r.pointsCharged}）`}
          </p>
          <dl className="mm-dl">
            <dt>类型</dt>
            <dd>{basisNames[r.basis ?? ''] ?? '不确定'}</dd>
            <dt>分类</dt>
            <dd>{r.categoryId ?? '未选'}</dd>
            <dt>出处</dt>
            <dd>{r.sourceWork || '—'}</dd>
            <dt>参考资料</dt>
            <dd className="pre-wrap">{r.referenceText || '—'}</dd>
            <dt>补充说明</dt>
            <dd className="pre-wrap">{r.note || '—'}</dd>
            <dt>参考图</dt>
            <dd>
              {r.referenceImages.length === 0
                ? '—'
                : r.referenceImages.map((image, i) =>
                    image.url ? (
                      <a
                        key={image.mediaId}
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        className="thumb-link"
                      >
                        <img src={image.url} alt={`参考图 ${i + 1}`} width={72} height={72} />
                      </a>
                    ) : (
                      <span key={image.mediaId} className="hint">
                        已删除{' '}
                      </span>
                    ),
                  )}
            </dd>
            {r.characterId && (
              <>
                <dt>关联角色</dt>
                <dd>
                  {r.characterId}
                  {r.addedToContacts ? '（已加到用户通讯录）' : '（未自动添加）'}
                </dd>
              </>
            )}
          </dl>
          <h3>处理记录</h3>
          <table>
            <thead>
              <tr>
                <th>时间（北京时间）</th>
                <th>状态</th>
                <th>留言</th>
              </tr>
            </thead>
            <tbody>
              {r.history.map((h, i) => (
                <tr key={i}>
                  <td>{beijing(h.at)}</td>
                  <td>
                    <Status status={h.status} />
                  </td>
                  <td>{h.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {open && !action && (
            <div className="button-row">
              {r.status === 'pending' && (
                <button className="primary" onClick={() => setAction('accept')}>
                  接单
                </button>
              )}
              <button onClick={() => setAction('progress')}>填写进度</button>
              <button onClick={() => setAction('complete')}>完成并选择角色</button>
              <button className="danger" onClick={() => setAction('reject')}>
                拒绝
              </button>
            </div>
          )}
          {action && (
            <div className="panel stack" role="dialog" aria-label="处理申请">
              <h3>
                {
                  {
                    accept: '接单',
                    progress: '填写进度',
                    complete: '完成并选择角色',
                    reject: '拒绝申请',
                  }[action]
                }
              </h3>
              {action === 'complete' && (
                <>
                  <CharacterPicker value={characterId} onChange={setCharacterId} />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={addToContacts}
                      onChange={(e) => setAddToContacts(e.target.checked)}
                    />
                    自动加到申请人的通讯录（通讯录已满时不加，用户收到通知后可自己添加）
                  </label>
                </>
              )}
              <label>
                {needText ? '留言（必填，用户可见）' : '留言（选填，用户可见）'}
                <textarea maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {error && (
                <p role="alert" className="error-banner">
                  {error}
                </p>
              )}
              <div className="button-row">
                <button onClick={() => setAction(null)}>取消</button>
                <button
                  className={action === 'reject' ? 'danger' : 'primary'}
                  disabled={
                    pending || (needText && !text.trim()) || (action === 'complete' && !characterId)
                  }
                  onClick={() => void run()}
                >
                  {pending ? '正在提交…' : '确认'}
                </button>
              </div>
              {AUDIT}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

/** 已上架预设角色选择器（按名字搜索）。 */
function CharacterPicker({ value, onChange }: { value: string; onChange(id: string): void }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useRemote(CharacterAdminEndpoints.list, {
    query: { status: 'published', q: search || undefined },
  });
  return (
    <div className="stack">
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <label>
          搜索已上架角色
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="角色名" />
        </label>
        <button>搜索</button>
      </form>
      {list.error && <p className="error">{list.error}</p>}
      <label>
        选择角色
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">请选择</option>
          {list.data?.items.map((c) => (
            <option key={c.characterId} value={c.characterId}>
              {c.name}
              {c.works.length ? `（${c.works.join('、')}）` : ''}
            </option>
          ))}
        </select>
      </label>
      {list.data && list.data.items.length === 0 && (
        <small className="hint">没有找到已上架的角色，请先去「角色库」新建并上架</small>
      )}
    </div>
  );
}

function ConfigPanel() {
  const remote = useRemote(RoleRequestAdminEndpoints.getConfig);
  const [form, setForm] = useState<{
    enabled: boolean;
    pointsCost: string;
    maxOpenPerUser: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current =
    form ??
    (remote.data
      ? {
          enabled: remote.data.enabled,
          pointsCost: String(remote.data.pointsCost),
          maxOpenPerUser: String(remote.data.maxOpenPerUser),
        }
      : null);
  async function save() {
    if (!current) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const saved = await api.call(RoleRequestAdminEndpoints.updateConfig, {
        body: {
          enabled: current.enabled,
          pointsCost: Number(current.pointsCost) || 0,
          maxOpenPerUser: Number(current.maxOpenPerUser) || 1,
        },
      });
      setForm({
        enabled: saved.enabled,
        pointsCost: String(saved.pointsCost),
        maxOpenPerUser: String(saved.maxOpenPerUser),
      });
      setMessage('已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  if (remote.error && !current) return <p className="error">{remote.error}</p>;
  if (!current) return <div className="skeleton-line" role="status" />;
  return (
    <div className="panel stack">
      <label className="check">
        <input
          type="checkbox"
          checked={current.enabled}
          onChange={(e) => setForm({ ...current, enabled: e.target.checked })}
        />
        开放申请（关闭后用户端入口提示「暂未开放」）
      </label>
      <label>
        每次申请价格（积分）
        <input
          type="number"
          min={0}
          max={1_000_000}
          value={current.pointsCost}
          onChange={(e) => setForm({ ...current, pointsCost: e.target.value })}
        />
      </label>
      <small className="hint">
        扣积分方式尚未确定：目前只记录价格、不实际扣除（用户端会显示价格）。建议保持 0。
      </small>
      <label>
        每人同时未完成的申请上限
        <input
          type="number"
          min={1}
          max={50}
          value={current.maxOpenPerUser}
          onChange={(e) => setForm({ ...current, maxOpenPerUser: e.target.value })}
        />
      </label>
      <Feedback message={message} error={error} />
      <div className="button-row">
        <button className="primary" disabled={pending} onClick={() => void save()}>
          {pending ? '正在保存…' : '保存'}
        </button>
      </div>
      <small className="hint">此操作会记入审计记录</small>
    </div>
  );
}
