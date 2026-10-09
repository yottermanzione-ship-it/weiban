/**
 * 公开动态（ADM-03、SIM-03；设计 docs/design/pages/admin-content.md 第 1 节）。
 * 接口：PublicUpdateAdminEndpoints（D-L3-02 交接）。状态 draft → pending → effective / rejected，effective → withdrawn。
 */
import { useState, type FormEvent } from 'react';
import {
  CharacterAdminEndpoints,
  PublicUpdateAdminEndpoints,
  type PublicUpdate,
  type PublicUpdateKind,
  type PublicUpdateSource,
  type PublicUpdateStatus,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

const statusLabels: Record<PublicUpdateStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  effective: '已生效',
  rejected: '已驳回',
  withdrawn: '已撤回',
};
const kindLabels: Record<PublicUpdateKind, string> = {
  new_work: '新作品',
  event: '活动行程',
  award: '获奖',
  other: '其他',
};
const rejectReasons = ['不实', '重复', '不相关', '其他'];

function bjToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}
function statusText(item: PublicUpdate): string {
  if (item.status === 'effective' && item.effectiveDate > bjToday()) return '待生效';
  return statusLabels[item.status];
}
function tone(item: PublicUpdate): string {
  if (item.status === 'effective' && item.effectiveDate <= bjToday()) return 'tag success';
  if (item.status === 'pending') return 'tag warning';
  if (item.status === 'rejected' || item.status === 'withdrawn') return 'tag danger';
  return 'tag';
}
function failure(e: unknown): string {
  return e instanceof ApiFailure && e.status === 409
    ? '这条动态的状态已变化，请刷新后再试'
    : errorText(e);
}

interface Draft {
  characterId: string;
  kind: PublicUpdateKind;
  content: string;
  startDate: string;
  endDate: string;
  effectiveDate: string;
  sourceUrl: string;
}
const blank = (): Draft => ({
  characterId: '',
  kind: 'other',
  content: '',
  startDate: bjToday(),
  endDate: '',
  effectiveDate: bjToday(),
  sourceUrl: '',
});

export function PublicUpdatesPage() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [status, setStatus] = useState<PublicUpdateStatus | ''>('');
  const [source, setSource] = useState<PublicUpdateSource | ''>('');
  const [characterId, setCharacterId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const characters = useRemote(CharacterAdminEndpoints.list);
  const settings = useRemote(PublicUpdateAdminEndpoints.getSettings);
  const list = useRemote(PublicUpdateAdminEndpoints.list, {
    query:
      tab === 'pending'
        ? { status: 'pending', source: 'auto_search', limit: 100 }
        : {
            status: status || undefined,
            source: source || undefined,
            characterId: characterId || undefined,
            limit: 50,
            cursor,
          },
  });
  const pendingCount = useRemote(PublicUpdateAdminEndpoints.list, {
    query: { status: 'pending', source: 'auto_search', limit: 100 },
  });
  const realPeople = (characters.data?.items ?? []).filter(
    (c) => c.classification.basis === 'real_person',
  );
  const [editing, setEditing] = useState<{ item: PublicUpdate | null; draft: Draft } | null>(null);
  const [viewing, setViewing] = useState<PublicUpdate | null>(null);
  const [noting, setNoting] = useState<{
    item: PublicUpdate;
    action: 'reject' | 'withdraw';
  } | null>(null);
  const [searchTarget, setSearchTarget] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows =
    tab === 'pending'
      ? [...(list.data?.items ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : (list.data?.items ?? []);

  async function run(operation: () => Promise<unknown>, done: string, after?: () => void) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(done);
      after?.();
      list.refresh();
      pendingCount.refresh();
    } catch (e) {
      setError(failure(e));
    } finally {
      setPending(false);
    }
  }
  function openNext(current: PublicUpdate) {
    if (tab !== 'pending') {
      setViewing(null);
      return;
    }
    const next = rows.find((r) => r.updateId !== current.updateId);
    setViewing(next ?? null);
    if (!next) setMessage('待审核已全部处理');
  }
  function fields(draft: Draft) {
    return {
      kind: draft.kind,
      content: draft.content,
      startDate: draft.startDate,
      endDate: draft.endDate || null,
      effectiveDate: draft.effectiveDate,
      sourceUrl: draft.sourceUrl,
    };
  }
  function save(event: FormEvent<HTMLFormElement>, mode: 'draft' | 'pending' | 'effective') {
    event.preventDefault();
    if (!editing) return;
    const { item, draft } = editing;
    void run(
      async () => {
        if (!item) {
          await api.call(PublicUpdateAdminEndpoints.create, {
            body: { characterId: draft.characterId, ...fields(draft), status: mode },
          });
        } else if (item.status === 'pending' && mode === 'effective') {
          await api.call(PublicUpdateAdminEndpoints.approve, {
            params: { updateId: item.updateId },
            body: fields(draft),
          });
        } else {
          await api.call(PublicUpdateAdminEndpoints.update, {
            params: { updateId: item.updateId },
            body: fields(draft),
          });
          if (item.status === 'draft' && mode !== 'draft')
            await api.call(PublicUpdateAdminEndpoints.submit, {
              params: { updateId: item.updateId },
            });
        }
      },
      mode === 'effective' ? '已通过' : '已保存',
      () => {
        setEditing(null);
        if (item) openNext(item);
      },
    );
  }
  const draft = editing?.draft;
  const setDraft = (patch: Partial<Draft>) =>
    setEditing((v) => (v ? { ...v, draft: { ...v.draft, ...patch } } : v));
  return (
    <>
      <div className="page-head">
        <h1>公开动态</h1>
        <div className="inline">
          <select
            aria-label="搜索角色"
            value={searchTarget}
            onChange={(e) => setSearchTarget(e.target.value)}
          >
            <option value="">选择要搜索的真人角色</option>
            {realPeople
              .filter((c) => c.status === 'published')
              .map((c) => (
                <option key={c.characterId} value={c.characterId}>
                  {c.name}
                </option>
              ))}
          </select>
          <button
            disabled={pending || !searchTarget || settings.data?.autoSearchEnabled === false}
            title={
              settings.data?.autoSearchEnabled === false
                ? '自动候选搜索已关闭，只能手动录入'
                : undefined
            }
            onClick={() =>
              void (async () => {
                setPending(true);
                setError('');
                setMessage('');
                try {
                  const result = await api.call(PublicUpdateAdminEndpoints.triggerSearch, {
                    params: { characterId: searchTarget },
                  });
                  setMessage(
                    result.outcome === 'ok'
                      ? result.created.length > 0
                        ? `找到 ${result.created.length} 条候选，已放入待审核`
                        : '没有找到新的候选'
                      : result.outcome === 'disabled'
                        ? '自动候选搜索已关闭'
                        : result.outcome === 'not_eligible'
                          ? '这个角色不是已上架的真人角色'
                          : '搜索服务暂不可用，只能手动录入',
                  );
                  list.refresh();
                  pendingCount.refresh();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setPending(false);
                }
              })()
            }
          >
            手动触发搜索
          </button>
          <button
            className="primary"
            onClick={() => {
              setViewing(null);
              setEditing({ item: null, draft: blank() });
            }}
          >
            新建动态
          </button>
        </div>
      </div>
      {settings.data && (
        <label className="inline panel">
          <input
            type="checkbox"
            checked={settings.data.autoSearchEnabled}
            disabled={pending}
            onChange={(e) =>
              void run(
                () =>
                  api.call(PublicUpdateAdminEndpoints.updateSettings, {
                    body: { autoSearchEnabled: e.target.checked },
                  }),
                '已保存',
                settings.refresh,
              )
            }
          />
          每周自动搜索候选（关闭后只保留手动录入）
          {settings.data.lastAutoRunAt && (
            <span className="hint">
              上次执行：
              {new Date(settings.data.lastAutoRunAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
              })}
            </span>
          )}
        </label>
      )}
      <div className="card-tabs">
        <button
          className={tab === 'pending' ? 'active' : ''}
          onClick={() => {
            setTab('pending');
            setCursor(undefined);
          }}
        >
          待审核 {pendingCount.data?.items.length ?? ''}
        </button>
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          全部
        </button>
      </div>
      {tab === 'all' && (
        <div className="panel form-grid">
          <label>
            角色
            <select
              value={characterId}
              onChange={(e) => {
                setCharacterId(e.target.value);
                setCursor(undefined);
              }}
            >
              <option value="">全部</option>
              {realPeople.map((c) => (
                <option key={c.characterId} value={c.characterId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as PublicUpdateStatus | '');
                setCursor(undefined);
              }}
            >
              <option value="">全部</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            来源
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value as PublicUpdateSource | '');
                setCursor(undefined);
              }}
            >
              <option value="">全部</option>
              <option value="manual">手动</option>
              <option value="auto_search">系统候选</option>
            </select>
          </label>
        </div>
      )}
      <Feedback message={message} error={error} />
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={list.refresh}>重试</button>
        </p>
      )}
      {editing && draft && (
        <form className="panel stack" onSubmit={(e) => save(e, 'effective')}>
          <h2>{editing.item ? '编辑动态' : '新建动态'}</h2>
          <label>
            所属角色 *
            <select
              required
              disabled={!!editing.item}
              value={editing.item?.characterId ?? draft.characterId}
              onChange={(e) => setDraft({ characterId: e.target.value })}
            >
              <option value="">请选择真人角色</option>
              {realPeople.map((c) => (
                <option key={c.characterId} value={c.characterId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            类别
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ kind: e.target.value as PublicUpdateKind })}
            >
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            内容 *
            <textarea
              required
              maxLength={200}
              value={draft.content}
              onChange={(e) => setDraft({ content: e.target.value })}
            />
            <span className="hint">角色只会说这里写明的内容，不会补充细节</span>
          </label>
          <div className="form-grid">
            <label>
              开始日期 *
              <input
                type="date"
                required
                value={draft.startDate}
                onChange={(e) => setDraft({ startDate: e.target.value })}
              />
            </label>
            <label>
              结束日期（留空 = 单日/长期）
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft({ endDate: e.target.value })}
              />
            </label>
            <label>
              生效日期 *
              <input
                type="date"
                required
                value={draft.effectiveDate}
                onChange={(e) => setDraft({ effectiveDate: e.target.value })}
              />
            </label>
          </div>
          <label>
            来源链接 *
            <input
              type="url"
              required
              value={draft.sourceUrl}
              onChange={(e) => setDraft({ sourceUrl: e.target.value })}
            />
          </label>
          <div className="inline">
            {(!editing.item || editing.item.status === 'draft') && (
              <button
                type="button"
                disabled={pending}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (form?.reportValidity())
                    save({ preventDefault() {} } as FormEvent<HTMLFormElement>, 'draft');
                }}
              >
                存为草稿
              </button>
            )}
            {(!editing.item || editing.item.status === 'draft') && (
              <button
                type="button"
                disabled={pending}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (form?.reportValidity())
                    save({ preventDefault() {} } as FormEvent<HTMLFormElement>, 'pending');
                }}
              >
                提交审核
              </button>
            )}
            {editing.item?.status === 'pending' && (
              <button
                type="button"
                disabled={pending}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (form?.reportValidity())
                    save({ preventDefault() {} } as FormEvent<HTMLFormElement>, 'draft');
                }}
              >
                只保存修改
              </button>
            )}
            {(!editing.item || editing.item.status === 'pending') && (
              <button className="primary" disabled={pending}>
                {editing.item ? '保存并通过' : '保存并生效'}
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      {viewing && !editing && (
        <section className="panel stack" aria-label="动态详情">
          <h2>
            {viewing.characterName} · {kindLabels[viewing.kind]}{' '}
            <span className={tone(viewing)}>{statusText(viewing)}</span>
          </h2>
          <p>{viewing.content}</p>
          <p className="hint">
            日期：{viewing.startDate}～{viewing.endDate ?? ''} · 生效：{viewing.effectiveDate} ·
            来源：{viewing.source === 'manual' ? '手动' : '系统候选'} · 发现时间：
            {new Date(viewing.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </p>
          <a href={viewing.sourceUrl} target="_blank" rel="noreferrer noopener">
            {viewing.sourceUrl}
          </a>
          {viewing.reviewNote && <p className="hint">备注：{viewing.reviewNote}</p>}
          <div className="inline">
            {viewing.status === 'pending' && (
              <>
                <button
                  className="primary"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () =>
                        api.call(PublicUpdateAdminEndpoints.approve, {
                          params: { updateId: viewing.updateId },
                          body: {},
                        }),
                      '已通过',
                      () => openNext(viewing),
                    )
                  }
                >
                  通过
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    setEditing({
                      item: viewing,
                      draft: {
                        characterId: viewing.characterId,
                        kind: viewing.kind,
                        content: viewing.content,
                        startDate: viewing.startDate,
                        endDate: viewing.endDate ?? '',
                        effectiveDate: bjToday(),
                        sourceUrl: viewing.sourceUrl,
                      },
                    })
                  }
                >
                  修改后通过
                </button>
                <button
                  className="danger"
                  disabled={pending}
                  onClick={() => setNoting({ item: viewing, action: 'reject' })}
                >
                  驳回
                </button>
              </>
            )}
            {viewing.status === 'draft' && (
              <>
                <button
                  disabled={pending}
                  onClick={() =>
                    setEditing({
                      item: viewing,
                      draft: {
                        characterId: viewing.characterId,
                        kind: viewing.kind,
                        content: viewing.content,
                        startDate: viewing.startDate,
                        endDate: viewing.endDate ?? '',
                        effectiveDate: viewing.effectiveDate,
                        sourceUrl: viewing.sourceUrl,
                      },
                    })
                  }
                >
                  编辑
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () =>
                        api.call(PublicUpdateAdminEndpoints.submit, {
                          params: { updateId: viewing.updateId },
                        }),
                      '已提交审核',
                      () => setViewing(null),
                    )
                  }
                >
                  提交审核
                </button>
              </>
            )}
            {viewing.status === 'effective' && (
              <button
                className="danger"
                disabled={pending}
                onClick={() => setNoting({ item: viewing, action: 'withdraw' })}
              >
                撤回
              </button>
            )}
            {(viewing.status === 'draft' || viewing.status === 'rejected') && (
              <button
                className="danger"
                disabled={pending}
                onClick={() => {
                  if (window.confirm('删除这条动态？此操作会记入审计记录'))
                    void run(
                      () =>
                        api.call(PublicUpdateAdminEndpoints.remove, {
                          params: { updateId: viewing.updateId },
                        }),
                      '已删除',
                      () => setViewing(null),
                    );
                }}
              >
                删除
              </button>
            )}
            <button onClick={() => setViewing(null)}>关闭</button>
          </div>
        </section>
      )}
      {noting && (
        <NoteDialog
          action={noting.action}
          pending={pending}
          onCancel={() => setNoting(null)}
          onConfirm={(note) => {
            const { item, action } = noting;
            void run(
              () =>
                api.call(
                  action === 'reject'
                    ? PublicUpdateAdminEndpoints.reject
                    : PublicUpdateAdminEndpoints.withdraw,
                  { params: { updateId: item.updateId }, body: { note } },
                ),
              action === 'reject' ? '已驳回' : '已撤回',
              () => {
                setNoting(null);
                if (action === 'reject') openNext(item);
                else setViewing(null);
              },
            );
          }}
        />
      )}
      <table>
        <thead>
          <tr>
            <th>角色</th>
            <th>内容</th>
            <th>日期范围</th>
            <th>来源</th>
            <th>状态</th>
            <th>生效日期</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.loading && !list.data && (
            <tr>
              <td colSpan={7}>
                <span className="skeleton-line" />
              </td>
            </tr>
          )}
          {rows.map((item) => (
            <tr key={item.updateId}>
              <td>{item.characterName}</td>
              <td className="ellipsis">{item.content}</td>
              <td>
                {item.startDate.slice(5)}～{item.endDate?.slice(5) ?? ''}
              </td>
              <td>
                {item.source === 'manual' ? '手动' : '候选'}{' '}
                <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener">
                  链接
                </a>
              </td>
              <td>
                <span className={tone(item)}>{statusText(item)}</span>
              </td>
              <td>{item.status === 'effective' ? item.effectiveDate.slice(5) : '—'}</td>
              <td>
                <button
                  onClick={() => {
                    setEditing(null);
                    setViewing(item);
                  }}
                >
                  查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data && rows.length === 0 && (
        <p className="hint">{tab === 'pending' ? '没有待审核的候选' : '还没有公开动态'}</p>
      )}
      {tab === 'all' && list.data?.nextCursor && (
        <button onClick={() => setCursor(list.data?.nextCursor ?? undefined)}>下一页</button>
      )}
      {tab === 'all' && cursor && <button onClick={() => setCursor(undefined)}>回到第一页</button>}
    </>
  );
}

function NoteDialog({
  action,
  pending,
  onCancel,
  onConfirm,
}: {
  action: 'reject' | 'withdraw';
  pending: boolean;
  onCancel(): void;
  onConfirm(note: string | null): void;
}) {
  const [reason, setReason] = useState('');
  const [extra, setExtra] = useState('');
  const note = [reason, extra.trim()].filter(Boolean).join('：') || null;
  const required = action === 'withdraw';
  return (
    <div role="dialog" aria-label={action === 'reject' ? '驳回' : '撤回'} className="panel stack">
      <h2>{action === 'reject' ? '驳回这条候选？' : '撤回这条动态？'}</h2>
      {action === 'withdraw' && <p>撤回后角色不会再提起这件事；已经发出的消息不会删除</p>}
      {action === 'reject' && (
        <div className="inline">
          {rejectReasons.map((r) => (
            <button
              key={r}
              className={reason === r ? 'active' : ''}
              aria-pressed={reason === r}
              onClick={() => setReason(reason === r ? '' : r)}
            >
              {r}
            </button>
          ))}
        </div>
      )}
      <label>
        {required ? '原因 *' : '补充（选填）'}
        <input maxLength={400} value={extra} onChange={(e) => setExtra(e.target.value)} />
      </label>
      <p className="hint">此操作会记入审计记录</p>
      <div className="inline">
        <button onClick={onCancel}>取消</button>
        <button
          className="danger"
          disabled={pending || (required && !extra.trim())}
          onClick={() => onConfirm(note)}
        >
          {action === 'reject' ? '驳回' : '撤回'}
        </button>
      </div>
    </div>
  );
}
