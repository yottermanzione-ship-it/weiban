/**
 * L7 管理后台：人设广场管理（ADM-09，设计 admin.md 第 3 节 + admin-content.md 第 7 节）、
 * 行为规划切换（ADM-05 第 10 条，admin-content.md 第 5 节）、每日一问题库（ADM-04 第 5 条，admin-content.md 4.6）。
 * 所有写操作服务器写审计；确认框底部写明「此操作会记入审计记录」。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import {
  AdminPlazaReport,
  AdminPlazaWork,
  AdminDailyQuestion,
  DailyQuestionAdminEndpoints,
  PlannerAdminEndpoints,
  PlannerConfigEntry,
  PlanningDecisionRecord,
  PlazaAdminEndpoints,
  type PlazaSnapshot,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

type Work = z.infer<typeof AdminPlazaWork>;
type Report = z.infer<typeof AdminPlazaReport>;
type Question = z.infer<typeof AdminDailyQuestion>;
type PlannerEntry = z.infer<typeof PlannerConfigEntry>;
type Decision = z.infer<typeof PlanningDecisionRecord>;

const AUDIT = <small className="hint">此操作会记入审计记录</small>;

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
const basisNames: Record<string, string> = {
  original: '原创',
  fictional: '虚构',
  real_person: '真人',
};
const realKindNames: Record<string, string> = {
  celebrity: '公众人物',
  historical: '历史人物',
  private_person: '身边真人',
};
const statusNames: Record<string, [string, string]> = {
  listed: ['展示中', 'tag success'],
  unlisted_by_author: ['作者下架', 'tag'],
  removed_by_admin: ['管理员下架', 'tag danger'],
  author_banned: ['作者停权', 'tag warning'],
};
const reasonNames: Record<string, string> = {
  rights: '侵犯他人权益',
  hard_boundary: '违反底线规则',
  inappropriate: '不适宜的内容',
  other: '其他',
};
interface Facts {
  basis: string;
  realPersonKind: string | null;
  ageSetting: string;
  childAppearance: boolean;
}
function classText(c: Facts) {
  const head =
    c.basis === 'real_person'
      ? `真人 · ${realKindNames[c.realPersonKind ?? ''] ?? ''}`
      : `${basisNames[c.basis] ?? ''} · ${c.ageSetting === 'minor' ? '未满 18 岁' : '已满 18 岁'}`;
  return c.childAppearance ? `${head} · 儿童外貌` : head;
}
/** 与服务器 policy.compareClassification 同一规则：只能更严（界面预先拦，服务器仍会再判一次）。 */
function looser(prev: Facts, next: Facts) {
  return (
    (prev.basis === 'real_person' &&
      (next.basis !== 'real_person' || prev.realPersonKind !== next.realPersonKind)) ||
    (prev.basis !== 'real_person' && next.basis !== 'real_person' && prev.basis !== next.basis) ||
    (prev.ageSetting === 'minor' && next.ageSetting !== 'minor') ||
    (prev.childAppearance && !next.childAppearance)
  );
}

function ConfirmBox({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel,
  disabled,
  error,
}: {
  title: string;
  children?: ReactNode;
  onCancel(): void;
  onConfirm(): void;
  confirmLabel: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="panel stack" role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {children}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="button-row">
        <button onClick={onCancel}>取消</button>
        <button className="primary" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
      {AUDIT}
    </div>
  );
}

function SnapshotView({ snapshot }: { snapshot: PlazaSnapshot }) {
  if (snapshot.kind === 'preset_variant')
    return (
      <dl>
        <dt>基于的预设角色</dt>
        <dd>{snapshot.presetCharacterId}</dd>
        <dt>改版设定</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>{snapshot.variantText}</dd>
      </dl>
    );
  const rows: Array<[string, string]> = [
    ['名字', snapshot.name],
    ['分类', classText(snapshot.classification)],
    ['儿童特征检测', snapshot.classification.childFeaturesDetected ? '检出' : '未检出'],
    ['人设描述', snapshot.description],
    ['说话方式', snapshot.speechStyle],
    ['口头禅', snapshot.catchphrases.join(' / ')],
    ['示例对话', snapshot.exampleDialogue],
    ['标签', snapshot.tags.join('、')],
    ['生日', snapshot.birthday ?? '—'],
    ['音色', snapshot.voiceName ?? '—'],
    ['头像', snapshot.avatarMediaId ? '有' : '默认头像'],
  ];
  return (
    <dl>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- 人设广场管理（ADM-09） ----------

export function PlazaAdminPage() {
  const [tab, setTab] = useState<'works' | 'reports' | 'bans'>('works');
  const pending = useRemote(PlazaAdminEndpoints.listReports, { query: { status: 'pending' } });
  const pendingCount = pending.data?.items.length ?? 0;
  return (
    <>
      <h1>人设广场</h1>
      <div className="card-tabs" role="tablist">
        {(
          [
            ['works', '作品'],
            ['reports', pendingCount > 0 ? `举报 ${pendingCount}` : '举报'],
            ['bans', '发布权限'],
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
      {tab === 'works' && <WorksTab />}
      {tab === 'reports' && <ReportsTab onChanged={pending.refresh} />}
      {tab === 'bans' && <BansTab />}
    </>
  );
}

/** 菜单角标：待处理举报数。 */
export function PlazaReportBadge() {
  const pending = useRemote(PlazaAdminEndpoints.listReports, { query: { status: 'pending' } });
  const count = pending.data?.items.length ?? 0;
  return count > 0 ? <span className="alert-badge">{count}</span> : null;
}

function usePaged<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError('');
      try {
        const page = await fetchPage(after);
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [fetchPage],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { items, setItems, cursor, loading, error, load };
}

function WorksTab() {
  const [filters, setFilters] = useState({
    authorUserId: '',
    kind: '',
    basis: '',
    status: '',
    minReports: '',
  });
  const [applied, setApplied] = useState(filters);
  const fetchPage = useCallback(
    (cursor?: string) =>
      api.call(PlazaAdminEndpoints.listWorks, {
        query: {
          authorUserId: applied.authorUserId.trim() || undefined,
          kind: (applied.kind || undefined) as 'custom_character' | undefined,
          basis: (applied.basis || undefined) as 'original' | undefined,
          status: (applied.status || undefined) as 'listed' | undefined,
          minReports: applied.minReports ? Number(applied.minReports) : undefined,
          cursor,
        },
      }),
    [applied],
  );
  const list = usePaged<Work>(fetchPage);
  const [detail, setDetail] = useState<Work | null>(null);
  return (
    <>
      <form
        className="panel inline"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filters);
        }}
      >
        <label>
          作者用户 ID
          <input
            value={filters.authorUserId}
            onChange={(e) => setFilters({ ...filters, authorUserId: e.target.value })}
          />
        </label>
        <label>
          类型
          <select
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
          >
            <option value="">全部</option>
            <option value="custom_character">自定义角色</option>
            <option value="preset_variant">预设改版</option>
          </select>
        </label>
        <label>
          分类
          <select
            value={filters.basis}
            onChange={(e) => setFilters({ ...filters, basis: e.target.value })}
          >
            <option value="">全部</option>
            <option value="original">原创</option>
            <option value="fictional">虚构</option>
            <option value="real_person">真人</option>
          </select>
        </label>
        <label>
          状态
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">全部</option>
            <option value="listed">展示中</option>
            <option value="unlisted_by_author">作者下架</option>
            <option value="removed_by_admin">管理员下架</option>
            <option value="author_banned">作者停权</option>
          </select>
        </label>
        <label>
          被举报次数 ≥
          <input
            type="number"
            min={0}
            value={filters.minReports}
            onChange={(e) => setFilters({ ...filters, minReports: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const empty = { authorUserId: '', kind: '', basis: '', status: '', minReports: '' };
            setFilters(empty);
            setApplied(empty);
          }}
        >
          重置
        </button>
        <button className="primary">查询</button>
      </form>
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={() => void list.load()}>重试</button>
        </p>
      )}
      {list.loading && list.items.length === 0 && <div className="skeleton-line" role="status" />}
      {!list.loading && !list.error && list.items.length === 0 && (
        <p className="hint">广场还没有作品</p>
      )}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>作品名</th>
              <th>作者广场昵称</th>
              <th>类型</th>
              <th>分类</th>
              <th>当前版本</th>
              <th>状态</th>
              <th>赞</th>
              <th>添加</th>
              <th>举报次数</th>
              <th>发布时间（北京时间）</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((w) => {
              const [label, cls] = statusNames[w.status] ?? ['未知', 'tag'];
              return (
                <tr
                  key={w.workId}
                  className={detail?.workId === w.workId ? 'selected' : ''}
                  onClick={() => setDetail(w)}
                >
                  <td>{w.name}</td>
                  <td>{w.author.deleted ? '已注销用户' : w.author.nickname}</td>
                  <td>
                    {w.kind === 'preset_variant'
                      ? `预设改版 · ${w.basedOnPresetName ?? ''}`
                      : '自定义角色'}
                  </td>
                  <td>
                    {w.snapshot.kind === 'custom_character'
                      ? classText(w.snapshot.classification)
                      : '沿用预设'}
                  </td>
                  <td>{w.currentVersion}</td>
                  <td>
                    <span className={cls}>{label}</span>
                  </td>
                  <td>{w.likeCount}</td>
                  <td>{w.adoptCount}</td>
                  <td>{w.reportCount}</td>
                  <td>{beijing(w.publishedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {list.cursor && (
        <button disabled={list.loading} onClick={() => void list.load(list.cursor ?? undefined)}>
          加载更多
        </button>
      )}
      {detail && (
        <WorkDrawer
          key={detail.workId}
          work={detail}
          onClose={() => setDetail(null)}
          onChanged={(w) => {
            setDetail(w);
            list.setItems((prev) => prev.map((x) => (x.workId === w.workId ? w : x)));
          }}
        />
      )}
    </>
  );
}

function WorkDrawer({
  work,
  onClose,
  onChanged,
}: {
  work: Work;
  onClose(): void;
  onChanged(work: Work): void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [version, setVersion] = useState<{
    snapshot: PlazaSnapshot;
    settings: { tagline: string; publishNote: string; allowRemix: boolean; commentsOpen: boolean };
  } | null>(null);
  const [versionError, setVersionError] = useState('');
  const [dialog, setDialog] = useState<'remove' | 'restore' | 'tighten' | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current: Facts | null =
    work.snapshot.kind === 'custom_character' ? work.snapshot.classification : null;
  const [next, setNext] = useState<Facts | null>(current);
  useEffect(() => {
    if (open === null) return;
    let active = true;
    setVersion(null);
    setVersionError('');
    api
      .call(PlazaAdminEndpoints.getWorkVersion, { params: { workId: work.workId, version: open } })
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch((e) => {
        if (active) setVersionError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [open, work.workId]);
  async function run(action: 'remove' | 'restore' | 'tighten') {
    setPending(true);
    setError('');
    try {
      if (action === 'tighten' && next) {
        const result = await api.call(PlazaAdminEndpoints.tightenClassification, {
          params: { workId: work.workId },
          body: {
            basis: next.basis as 'original',
            realPersonKind:
              next.basis === 'real_person' ? (next.realPersonKind as 'celebrity') : null,
            ageSetting: next.ageSetting as 'adult',
            childAppearance: next.childAppearance,
            reason: reason.trim(),
          },
        });
        onChanged(result.work);
        setMessage(`已更正 ${result.affectedCharacterCount} 个角色`);
      } else {
        const endpoint =
          action === 'remove' ? PlazaAdminEndpoints.removeWork : PlazaAdminEndpoints.restoreWork;
        onChanged(
          await api.call(endpoint, {
            params: { workId: work.workId },
            body: { reason: reason.trim() },
          }),
        );
        setMessage(action === 'remove' ? '已下架' : '已恢复上架');
      }
      setDialog(null);
      setReason('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  const tightenInvalid =
    !current ||
    !next ||
    looser(current, next) ||
    JSON.stringify(current) === JSON.stringify({ ...current, ...next });
  return (
    <aside className="panel stack" role="dialog" aria-label={`作品《${work.name}》`}>
      <div className="page-head">
        <h2>《{work.name}》</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      <Feedback message={message} />
      <p className="hint">
        作者：{work.author.deleted ? '已注销用户' : work.author.nickname}（用户 ID{' '}
        {work.authorUserId}）{work.removedReason && ` · 下架原因：${work.removedReason}`}
      </p>
      <p>
        一句话介绍：{work.settings.tagline}
        <br />
        发布说明：{work.settings.publishNote || '—'}
        <br />
        {work.settings.allowRemix ? '允许改编' : '不允许改编'} ·{' '}
        {work.settings.commentsOpen ? '开放评论' : '关闭评论'}
      </p>
      <h2>版本</h2>
      <table>
        <tbody>
          {[...work.versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <tr key={v.version}>
                <td>版本 {v.version}</td>
                <td>{beijing(v.createdAt)}</td>
                <td>{v.changeNote ?? '—'}</td>
                <td>
                  <button onClick={() => setOpen(open === v.version ? null : v.version)}>
                    {open === v.version ? '收起' : '查看完整内容'}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {open !== null && (
        <div className="panel">
          {versionError && <p className="error">{versionError}</p>}
          {!version && !versionError && <div className="skeleton-line" role="status" />}
          {version && <SnapshotView snapshot={version.snapshot} />}
        </div>
      )}
      <div className="button-row">
        {work.status === 'removed_by_admin' ? (
          <button onClick={() => setDialog('restore')}>恢复上架</button>
        ) : (
          <button className="danger" onClick={() => setDialog('remove')}>
            下架
          </button>
        )}
        {current ? (
          <button onClick={() => setDialog('tighten')}>更正分类</button>
        ) : (
          <small className="hint">预设改版沿用预设角色的分类，请在「角色库」修改</small>
        )}
      </div>
      {(dialog === 'remove' || dialog === 'restore') && (
        <ConfirmBox
          title={dialog === 'remove' ? '下架这个作品？' : '恢复上架？'}
          confirmLabel={dialog === 'remove' ? '下架' : '恢复上架'}
          disabled={pending || !reason.trim()}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(dialog)}
        >
          {dialog === 'remove' && <p>作者会收到通知，且不能自行重新上架。</p>}
          <label>
            原因（必填）
            <textarea maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmBox>
      )}
      {dialog === 'tighten' && current && next && (
        <ConfirmBox
          title="更正分类"
          confirmLabel={pending ? '正在更正…' : '确认更正'}
          disabled={pending || !reason.trim() || tightenInvalid}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run('tighten')}
        >
          <p>当前分类：{classText(current)}</p>
          <div className="form-grid">
            <label>
              类型
              <select
                value={next.basis}
                onChange={(e) =>
                  setNext({
                    ...next,
                    basis: e.target.value,
                    realPersonKind:
                      e.target.value === 'real_person'
                        ? (next.realPersonKind ?? 'celebrity')
                        : null,
                  })
                }
              >
                {(['original', 'fictional', 'real_person'] as const).map((b) => (
                  <option
                    key={b}
                    value={b}
                    disabled={looser(current, {
                      ...next,
                      basis: b,
                      realPersonKind:
                        b === 'real_person' ? (current.realPersonKind ?? 'celebrity') : null,
                    })}
                  >
                    {basisNames[b]}
                  </option>
                ))}
              </select>
            </label>
            {next.basis === 'real_person' && (
              <label>
                真人类型
                <select
                  value={next.realPersonKind ?? 'celebrity'}
                  onChange={(e) => setNext({ ...next, realPersonKind: e.target.value })}
                >
                  {(['celebrity', 'historical', 'private_person'] as const).map((k) => (
                    <option
                      key={k}
                      value={k}
                      disabled={looser(current, { ...next, realPersonKind: k })}
                    >
                      {realKindNames[k]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              年龄设定
              <select
                value={next.ageSetting}
                onChange={(e) => setNext({ ...next, ageSetting: e.target.value })}
              >
                <option value="adult" disabled={current.ageSetting === 'minor'}>
                  已满 18 岁
                </option>
                <option value="minor">未满 18 岁</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={next.childAppearance}
                disabled={current.childAppearance}
                onChange={(e) => setNext({ ...next, childAppearance: e.target.checked })}
              />
              儿童外貌
            </label>
          </div>
          {looser(current, next) && <p className="error">只能改得更严格</p>}
          <p className="inline-tip">
            所有由这个作品复制或应用出去的角色都会一起改，正在进行的成人模式会立即退出。
          </p>
          <label>
            原因（必填）
            <textarea maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmBox>
      )}
    </aside>
  );
}

function ReportsTab({ onChanged }: { onChanged(): void }) {
  const [status, setStatus] = useState<'pending' | 'dismissed' | 'actioned' | ''>('pending');
  const fetchPage = useCallback(
    (cursor?: string) =>
      api.call(PlazaAdminEndpoints.listReports, {
        query: { status: status || undefined, cursor },
      }),
    [status],
  );
  const list = usePaged<Report>(fetchPage);
  const [detail, setDetail] = useState<Report | null>(null);
  const [action, setAction] = useState<'dismiss' | 'remove_work' | 'delete_comment' | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [work, setWork] = useState<Work | null>(null);
  useEffect(() => {
    setWork(null);
    if (!detail || detail.target.kind !== 'work') return;
    let active = true;
    const workId = detail.target.workId;
    void api
      .call(PlazaAdminEndpoints.getWork, { params: { workId } })
      .then((value) => {
        if (active) setWork(value);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [detail]);
  async function resolve() {
    if (!detail || !action) return;
    setPending(true);
    setError('');
    try {
      const result = await api.call(PlazaAdminEndpoints.resolveReport, {
        params: { reportId: detail.reportId },
        body: { action, reason: reason.trim() },
      });
      setMessage('已处理，已通知举报人');
      setAction(null);
      setReason('');
      setDetail(null);
      list.setItems((prev) =>
        status === 'pending'
          ? prev.filter((r) => r.reportId !== result.reportId)
          : prev.map((r) => (r.reportId === result.reportId ? result : r)),
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="panel inline">
        <label>
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="pending">待处理</option>
            <option value="dismissed">已驳回</option>
            <option value="actioned">已处理</option>
            <option value="">全部</option>
          </select>
        </label>
      </div>
      <Feedback message={message} />
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={() => void list.load()}>重试</button>
        </p>
      )}
      {list.loading && list.items.length === 0 && <div className="skeleton-line" role="status" />}
      {!list.loading && list.items.length === 0 && <p className="hint">没有待处理的举报</p>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>举报时间（北京时间）</th>
              <th>对象</th>
              <th>原因</th>
              <th>补充说明</th>
              <th>举报人</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.reportId} onClick={() => setDetail(r)}>
                <td>{beijing(r.createdAt)}</td>
                <td>{r.target.kind === 'work' ? '作品' : '评论'}</td>
                <td>{reasonNames[r.reason] ?? '其他'}</td>
                <td className="ellipsis">{r.note ?? '—'}</td>
                <td>{r.reporterUserId}</td>
                <td>
                  <span className={r.status === 'pending' ? 'tag warning' : 'tag'}>
                    {r.status === 'pending'
                      ? '待处理'
                      : r.status === 'dismissed'
                        ? '已驳回'
                        : '已处理'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.cursor && (
        <button disabled={list.loading} onClick={() => void list.load(list.cursor ?? undefined)}>
          加载更多
        </button>
      )}
      {detail && (
        <aside className="panel stack" role="dialog" aria-label="举报详情">
          <div className="page-head">
            <h2>举报详情</h2>
            <button onClick={() => setDetail(null)}>关闭</button>
          </div>
          <p>
            原因：{reasonNames[detail.reason] ?? '其他'}
            <br />
            补充说明：{detail.note ?? '—'}
          </p>
          {detail.target.kind === 'comment' ? (
            <blockquote>{detail.target.text}</blockquote>
          ) : work ? (
            <div className="panel">
              <strong>《{work.name}》</strong>
              <SnapshotView snapshot={work.snapshot} />
            </div>
          ) : (
            <p className="hint">作品 ID {detail.target.workId}</p>
          )}
          {detail.status === 'pending' && (
            <div className="button-row">
              <button onClick={() => setAction('dismiss')}>驳回</button>
              <button
                className="danger"
                onClick={() =>
                  setAction(detail.target.kind === 'work' ? 'remove_work' : 'delete_comment')
                }
              >
                {detail.target.kind === 'work' ? '下架作品' : '删除评论'}
              </button>
            </div>
          )}
          {action && (
            <ConfirmBox
              title={
                action === 'dismiss'
                  ? '驳回举报？'
                  : action === 'remove_work'
                    ? '下架作品？'
                    : '删除评论？'
              }
              confirmLabel="确认"
              disabled={pending || !reason.trim()}
              error={error}
              onCancel={() => setAction(null)}
              onConfirm={() => void resolve()}
            >
              <p>处理后会自动通知举报人。</p>
              <label>
                原因（必填）
                <textarea
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </ConfirmBox>
          )}
        </aside>
      )}
    </>
  );
}

function BansTab() {
  const fetchBans = useCallback(
    (cursor?: string) => api.call(PlazaAdminEndpoints.listBans, { query: { cursor, limit: 50 } }),
    [],
  );
  const bans =
    usePaged<z.infer<typeof PlazaAdminEndpoints.listBans.response>['items'][number]>(fetchBans);
  const [userId, setUserId] = useState('');
  const [period, setPeriod] = useState<'7' | '30' | 'permanent'>('7');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<'ban' | 'unban' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  async function run() {
    setPending(true);
    setError('');
    try {
      if (confirm === 'ban') {
        const until =
          period === 'permanent'
            ? ('permanent' as const)
            : new Date(Date.now() + Number(period) * 86_400_000).toISOString();
        await api.call(PlazaAdminEndpoints.banAuthor, {
          params: { userId: userId.trim() },
          body: { until, reason: reason.trim() },
        });
        setMessage('已停止该用户的发布和评论权限');
      } else {
        await api.call(PlazaAdminEndpoints.unbanAuthor, {
          params: { userId: userId.trim() },
          body: { reason: reason.trim() },
        });
        setMessage('已恢复该用户的权限');
      }
      setConfirm(null);
      setReason('');
      void bans.load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function deleteComment() {
    setPending(true);
    setError('');
    try {
      await api.call(PlazaAdminEndpoints.deleteComment, {
        params: { commentId: deleteId.trim() },
        body: { reason: deleteReason.trim() },
      });
      setMessage('评论已删除');
      setDeleteId('');
      setDeleteReason('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <p className="inline-tip">
        用户 ID 可以在「作品」抽屉里看到。停止期间，TA 的全部作品不展示，也不能发布和评论。
      </p>
      <Feedback message={message} error={confirm ? '' : error} />
      {bans.error && <Feedback error={bans.error} />}
      <div className="panel stack">
        <h2>当前停权用户</h2>
        {!bans.loading && bans.items.length === 0 && <p className="hint">没有停权中的用户</p>}
        {bans.items.map((ban) => (
          <button key={ban.userId} onClick={() => setUserId(ban.userId)}>
            {ban.nickname ?? ban.userId} · {ban.until === 'permanent' ? '永久' : beijing(ban.until)}
            <small>{ban.reason}</small>
          </button>
        ))}
        {bans.cursor && (
          <button disabled={bans.loading} onClick={() => void bans.load(bans.cursor ?? undefined)}>
            加载更多
          </button>
        )}
      </div>
      <div className="panel stack">
        <label>
          用户 ID
          <input value={userId} onChange={(e) => setUserId(e.target.value)} />
        </label>
        <fieldset>
          <legend>期限</legend>
          {(
            [
              ['7', '7 天'],
              ['30', '30 天'],
              ['permanent', '永久'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="check">
              <input type="radio" checked={period === value} onChange={() => setPeriod(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="button-row">
          <button className="danger" disabled={!userId.trim()} onClick={() => setConfirm('ban')}>
            停止发布和评论
          </button>
          <button disabled={!userId.trim()} onClick={() => setConfirm('unban')}>
            恢复权限
          </button>
        </div>
      </div>
      {confirm && (
        <ConfirmBox
          title={confirm === 'ban' ? '停止发布和评论？' : '恢复权限？'}
          confirmLabel={confirm === 'ban' ? '停止' : '恢复'}
          disabled={pending || !reason.trim()}
          error={error}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run()}
        >
          <p>
            {confirm === 'ban'
              ? '停止期间，TA 的全部作品不展示'
              : 'TA 的作品会重新展示（被单独下架的除外）'}
          </p>
          <label>
            原因（必填）
            <textarea maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmBox>
      )}
      <h2>删除评论</h2>
      <div className="panel stack">
        <label>
          评论 ID
          <input value={deleteId} onChange={(e) => setDeleteId(e.target.value)} />
        </label>
        <label>
          原因（必填）
          <textarea
            maxLength={200}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
          />
        </label>
        <button
          className="danger"
          disabled={pending || !deleteId.trim() || !deleteReason.trim()}
          onClick={() => void deleteComment()}
        >
          删除评论
        </button>
        {AUDIT}
      </div>
    </>
  );
}

// ---------- 行为规划（ADM-05 第 10 条） ----------

const decisionTypes = [
  ['reply_form', '回复形式'],
  ['reply_timing', '回复时机'],
  ['quirk', '小巧思'],
  ['proactive_slot', '主动消息时机'],
  ['call_slot', '来电时机'],
  ['moments_plan', '朋友圈'],
  ['play_slot', '玩法时机'],
] as const;
type DecisionType = (typeof decisionTypes)[number][0];
const implNames: Record<string, string> = {
  rules: '纯规则',
  rules_model: '规则 + 便宜模型',
  jev: 'Jev',
};
const fallbackNames: Record<string, string> = {
  low_confidence: '置信度低',
  timeout: '超时',
  error: '出错',
  budget: '预算',
  cost_guard: '成本闸',
  circuit_open: '熔断',
  invalid_choice: '无效选择',
};

export function PlannerPage() {
  const [tab, setTab] = useState<'config' | 'decisions'>('config');
  return (
    <>
      <h1>行为规划</h1>
      <div className="card-tabs" role="tablist">
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>
          决策实现
        </button>
        <button className={tab === 'decisions' ? 'active' : ''} onClick={() => setTab('decisions')}>
          决策记录
        </button>
      </div>
      {tab === 'config' ? <PlannerConfig /> : <PlannerDecisions />}
    </>
  );
}

function PlannerConfig() {
  const config = useRemote(PlannerAdminEndpoints.getConfig);
  const [editing, setEditing] = useState<DecisionType | null>(null);
  const [message, setMessage] = useState('');
  const entryOf = (type: string) => config.data?.items.find((i) => i.decisionType === type);
  return (
    <>
      <p className="inline-tip">
        决策层出错时会自动退回纯规则，用户无感；这里的切换不影响任何频率上限和用户开关。
      </p>
      {config.error && (
        <p role="alert" className="error-banner">
          加载失败：{config.error} <button onClick={config.refresh}>重试</button>
        </p>
      )}
      <Feedback message={message} />
      {config.loading && !config.data && <div className="skeleton-line" role="status" />}
      <table>
        <thead>
          <tr>
            <th>决策类型</th>
            <th>当前实现</th>
            <th>模型</th>
            <th>置信度门槛</th>
            <th>最近评测</th>
            <th>更新时间（北京时间）</th>
            <th>本机熔断至</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {decisionTypes.map(([type, label]) => {
            const entry = entryOf(type);
            return (
              <tr key={type} onClick={() => setEditing(type)}>
                <td>{label}</td>
                <td>{implNames[entry?.implementation ?? 'rules'] ?? '未知'}</td>
                <td>{entry?.modelKey ?? '—'}</td>
                <td>
                  {!entry || entry.implementation === 'rules'
                    ? '—'
                    : entry.confidenceThreshold.toFixed(2)}
                </td>
                <td>{entry?.evalReportId ?? '—'}</td>
                <td>{beijing(entry?.updatedAt)}</td>
                <td>{beijing(entry?.circuitOpenUntil)}</td>
                <td>›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <PlannerDrawer
          key={editing}
          type={editing}
          entry={entryOf(editing)}
          onClose={() => setEditing(null)}
          onSaved={(label) => {
            setEditing(null);
            setMessage(`已保存：${label}`);
            config.refresh();
          }}
        />
      )}
    </>
  );
}

function PlannerDrawer({
  type,
  entry,
  onClose,
  onSaved,
}: {
  type: DecisionType;
  entry?: PlannerEntry;
  onClose(): void;
  onSaved(label: string): void;
}) {
  const label = decisionTypes.find(([t]) => t === type)?.[1] ?? type;
  const initialImpl = (entry?.implementation ?? 'rules') as 'rules' | 'rules_model' | 'jev';
  const [impl, setImpl] = useState(initialImpl);
  const [modelKey, setModelKey] = useState(entry?.modelKey ?? '');
  const [threshold, setThreshold] = useState(entry?.confidenceThreshold ?? 0.55);
  const [report, setReport] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const switching = impl !== initialImpl;
  const valid =
    (!switching || report.trim().length > 0) &&
    (impl === 'rules' || modelKey.trim().length > 0) &&
    threshold >= 0.3 &&
    threshold <= 0.9;
  async function save() {
    setPending(true);
    setError('');
    try {
      await api.call(PlannerAdminEndpoints.updateConfig, {
        params: { decisionType: type },
        body: {
          implementation: impl,
          modelKey: impl === 'rules' ? null : modelKey.trim(),
          confidenceThreshold: Math.round(threshold * 100) / 100,
          evalReportId: report.trim() || null,
        },
      });
      onSaved(label);
    } catch (e) {
      setError(errorText(e));
      setConfirm(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <aside className="panel stack" role="dialog" aria-label={`${label}的实现`}>
      <div className="page-head">
        <h2>{label}</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      <fieldset>
        <legend>实现</legend>
        {(['rules', 'rules_model', 'jev'] as const).map((value) => (
          <label
            key={value}
            className="check"
            title={value === 'jev' && type === 'play_slot' ? '玩法时机不能使用 Jev' : undefined}
          >
            <input
              type="radio"
              checked={impl === value}
              disabled={value === 'jev' && type === 'play_slot'}
              onChange={() => setImpl(value)}
            />
            {implNames[value]}
          </label>
        ))}
      </fieldset>
      {impl !== 'rules' && (
        <label>
          模型（模型目录中的模型标识）
          <input value={modelKey} onChange={(e) => setModelKey(e.target.value)} />
        </label>
      )}
      <label>
        置信度门槛（0.30～0.90）
        <input
          type="number"
          min={0.3}
          max={0.9}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
      </label>
      <label>
        评测报告编号{switching ? '（切换实现必填）' : '（只改门槛可不填）'}
        <input value={report} maxLength={64} onChange={(e) => setReport(e.target.value)} />
      </label>
      {switching && !report.trim() && (
        <p className="hint">需要先有这类决策、这个实现的评测报告才能切换</p>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="button-row">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={!valid || pending} onClick={() => setConfirm(true)}>
          保存
        </button>
      </div>
      {confirm && (
        <ConfirmBox
          title={
            switching ? `把「${label}」切换为「${implNames[impl]}」？` : `保存「${label}」的设置？`
          }
          confirmLabel={switching ? '切换' : '保存'}
          disabled={pending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void save()}
        >
          {switching && <p>切换前请确认已通过人设稳定检查。</p>}
        </ConfirmBox>
      )}
    </aside>
  );
}

function PlannerDecisions() {
  const [filters, setFilters] = useState({
    userId: '',
    characterId: '',
    decisionType: '',
    fallback: '',
    from: '',
    to: '',
  });
  const [applied, setApplied] = useState(filters);
  const fetchPage = useCallback(
    (cursor?: string) =>
      api.call(PlannerAdminEndpoints.listDecisions, {
        query: {
          userId: applied.userId.trim() || undefined,
          characterId: applied.characterId.trim() || undefined,
          decisionType: (applied.decisionType || undefined) as DecisionType | undefined,
          fallback: (applied.fallback || undefined) as 'timeout' | undefined,
          from: applied.from ? new Date(applied.from).toISOString() : undefined,
          to: applied.to ? new Date(applied.to).toISOString() : undefined,
          cursor,
        },
      }),
    [applied],
  );
  const list = usePaged<Decision>(fetchPage);
  const [detail, setDetail] = useState<Decision | null>(null);
  const typeName = (t: string) => decisionTypes.find(([k]) => k === t)?.[1] ?? t;
  return (
    <>
      <p className="hint">决策记录保留 90 天，不含任何消息原文。</p>
      <form
        className="panel inline"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filters);
        }}
      >
        <label>
          用户 ID
          <input
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
          />
        </label>
        <label>
          角色 ID
          <input
            value={filters.characterId}
            onChange={(e) => setFilters({ ...filters, characterId: e.target.value })}
          />
        </label>
        <label>
          决策类型
          <select
            value={filters.decisionType}
            onChange={(e) => setFilters({ ...filters, decisionType: e.target.value })}
          >
            <option value="">全部</option>
            {decisionTypes.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          退回原因
          <select
            value={filters.fallback}
            onChange={(e) => setFilters({ ...filters, fallback: e.target.value })}
          >
            <option value="">全部</option>
            {Object.entries(fallbackNames).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          起
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          止
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <button className="primary">查询</button>
      </form>
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={() => void list.load()}>重试</button>
        </p>
      )}
      {list.loading && list.items.length === 0 && <div className="skeleton-line" role="status" />}
      {!list.loading && list.items.length === 0 && <p className="hint">没有决策记录</p>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>时间（北京时间）</th>
              <th>用户</th>
              <th>角色</th>
              <th>决策类型</th>
              <th>选择</th>
              <th>置信度</th>
              <th>理由</th>
              <th>实现</th>
              <th>退回原因</th>
              <th>耗时 ms</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((d) => (
              <tr key={d.decisionId} onClick={() => setDetail(d)}>
                <td>{beijing(d.createdAt)}</td>
                <td>{d.userId}</td>
                <td>{d.characterId ?? '—'}</td>
                <td>{typeName(d.decisionType)}</td>
                <td>{d.choice}</td>
                <td>{d.confidence.toFixed(2)}</td>
                <td className="ellipsis" title={d.reason}>
                  {d.reason}
                </td>
                <td>{implNames[d.implementation] ?? d.implementation}</td>
                <td>{d.fallback ? (fallbackNames[d.fallback] ?? d.fallback) : '无'}</td>
                <td>{d.latencyMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.cursor && (
        <button disabled={list.loading} onClick={() => void list.load(list.cursor ?? undefined)}>
          加载更多
        </button>
      )}
      {detail && (
        <aside className="panel stack" role="dialog" aria-label="决策详情">
          <div className="page-head">
            <h2>决策详情</h2>
            <button onClick={() => setDetail(null)}>关闭</button>
          </div>
          <dl>
            {(
              [
                ['决策 ID', detail.decisionId],
                ['时间', beijing(detail.createdAt)],
                ['用户', detail.userId],
                ['角色', detail.characterId ?? '—'],
                ['会话', detail.conversationId ?? '—'],
                ['决策类型', typeName(detail.decisionType)],
                ['可选项', detail.options.join(' / ')],
                ['选择', detail.choice],
                ['置信度', detail.confidence.toFixed(2)],
                ['理由', detail.reason],
                ['实现', implNames[detail.implementation] ?? detail.implementation],
                [
                  '退回原因',
                  detail.fallback ? (fallbackNames[detail.fallback] ?? detail.fallback) : '无',
                ],
                ['耗时', `${detail.latencyMs} ms`],
                ['用量记录', detail.usageRecordId ?? '—'],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </>
  );
}

// ---------- 每日一问题库（ADM-04 第 5 条、PLAY-03） ----------

const questionTags = [
  ['romance', '恋爱'],
  ['child_safe', '适合儿童'],
  ['work', '涉及工作'],
  ['family', '家庭'],
  ['childhood', '童年'],
  ['light', '轻松'],
] as const;
type QuestionTag = (typeof questionTags)[number][0];
const tagName = (t: string) => questionTags.find(([k]) => k === t)?.[1] ?? t;

export function DailyQuestionsPage() {
  const [tag, setTag] = useState<QuestionTag | ''>('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'listed' | 'unlisted'>('');
  const fetchPage = useCallback(
    (cursor?: string) =>
      api.call(DailyQuestionAdminEndpoints.list, { query: { tag: tag || undefined, cursor } }),
    [tag],
  );
  const list = usePaged<Question>(fetchPage);
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = list.items.filter(
    (q) =>
      (!keyword.trim() || q.text.includes(keyword.trim())) &&
      (!statusFilter || (statusFilter === 'listed') === q.listed),
  );
  async function toggle(q: Question) {
    setError('');
    try {
      const updated = await api.call(DailyQuestionAdminEndpoints.update, {
        params: { questionId: q.questionId },
        body: { listed: !q.listed },
      });
      list.setItems((prev) => prev.map((x) => (x.questionId === updated.questionId ? updated : x)));
      setMessage(updated.listed ? '已上架' : '已下架');
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <div className="page-head">
        <h1>每日一问题库</h1>
        <button className="primary" onClick={() => setEditing('new')}>
          新建题目
        </button>
      </div>
      <div className="panel inline">
        <label>
          标签
          <select value={tag} onChange={(e) => setTag(e.target.value as QuestionTag | '')}>
            <option value="">全部</option>
            {questionTags.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">全部</option>
            <option value="listed">已上架</option>
            <option value="unlisted">已下架</option>
          </select>
        </label>
        <label>
          关键词
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </label>
      </div>
      <Feedback message={message} error={error} />
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={() => void list.load()}>重试</button>
        </p>
      )}
      {list.loading && list.items.length === 0 && <div className="skeleton-line" role="status" />}
      {!list.loading && list.items.length === 0 && (
        <p className="hint">
          还没有题目 <button onClick={() => setEditing('new')}>新建题目</button>
        </p>
      )}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>题目</th>
              <th>标签</th>
              <th>状态</th>
              <th>更新时间（北京时间）</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.questionId} onClick={() => setEditing(q)}>
                <td>{q.text}</td>
                <td>
                  {q.tags.map((t) => (
                    <span key={t} className="tag">
                      {tagName(t)}
                    </span>
                  ))}
                </td>
                <td>
                  <span className={q.listed ? 'tag success' : 'tag'}>
                    {q.listed ? '已上架' : '已下架'}
                  </span>
                </td>
                <td>{beijing(q.updatedAt)}</td>
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggle(q);
                    }}
                  >
                    {q.listed ? '下架' : '上架'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.cursor && (
        <button disabled={list.loading} onClick={() => void list.load(list.cursor ?? undefined)}>
          加载更多
        </button>
      )}
      {editing && (
        <QuestionDrawer
          key={editing === 'new' ? 'new' : editing.questionId}
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(q, created) => {
            setEditing(null);
            setMessage('已保存');
            list.setItems((prev) =>
              created ? [q, ...prev] : prev.map((x) => (x.questionId === q.questionId ? q : x)),
            );
          }}
        />
      )}
    </>
  );
}

function QuestionDrawer({
  question,
  onClose,
  onSaved,
}: {
  question: Question | null;
  onClose(): void;
  onSaved(q: Question, created: boolean): void;
}) {
  const [text, setText] = useState(question?.text ?? '');
  const [tags, setTags] = useState<QuestionTag[]>((question?.tags ?? []) as QuestionTag[]);
  const [listed, setListed] = useState(question?.listed ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const length = Array.from(text.trim()).length;
  async function save() {
    setPending(true);
    setError('');
    try {
      const body = { text: text.trim(), tags, listed };
      const result = question
        ? await api.call(DailyQuestionAdminEndpoints.update, {
            params: { questionId: question.questionId },
            body,
          })
        : await api.call(DailyQuestionAdminEndpoints.create, { body });
      onSaved(result, !question);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <aside className="panel stack" role="dialog" aria-label={question ? '编辑题目' : '新建题目'}>
      <div className="page-head">
        <h2>{question ? '编辑题目' : '新建题目'}</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      <label>
        题目（必填，≤ 40 字）
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <small className={length > 40 ? 'error' : 'hint'}>{length}/40</small>
      <fieldset>
        <legend>标签</legend>
        {questionTags.map(([k, l]) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={tags.includes(k)}
              onChange={(e) =>
                setTags(e.target.checked ? [...tags, k] : tags.filter((t) => t !== k))
              }
            />
            {l}
          </label>
        ))}
      </fieldset>
      <ul className="hint">
        {tags.includes('romance') && <li>只有关系类型为恋人的角色会被分到</li>}
        {!tags.includes('child_safe') && <li>儿童角色不会被分到</li>}
        {tags.includes('work') && <li>真人角色不会被分到</li>}
      </ul>
      <label className="check">
        <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
        上架（下架的题目不再出现，已答过的历史保留）
      </label>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="button-row">
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={pending || length === 0 || length > 40}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
      {AUDIT}
    </aside>
  );
}
