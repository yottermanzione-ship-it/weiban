/**
 * L6 管理后台：宠物图鉴（ADM-04 第 5 条、PLAY-02）与「注销未完成」（ADM-10）。
 * 设计 admin-content.md 4.4、第 6 节。注销页只显示删除进度，不显示账号的任何内容，也没有取消注销入口。
 */
import { useState, type FormEvent } from 'react';
import {
  IdentityAdminEndpoints,
  MediaAdminEndpoints,
  PetSpeciesAdminEndpoints,
  type PendingAccountDeletion,
  type PetSpecies,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { adminMediaUrl } from '../data/media-url.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

const stages = [
  ['baby', '幼年'],
  ['junior', '少年'],
  ['adult', '成年'],
] as const;
type StageKey = (typeof stages)[number][0];

interface AppearanceDraft {
  appearanceId?: string;
  name: string;
  listed?: boolean;
  images: Partial<Record<StageKey, { mediaId: string; url: string }>>;
}

function toDrafts(species: PetSpecies | null): AppearanceDraft[] {
  return (species?.appearances ?? []).map((a) => ({
    appearanceId: a.appearanceId,
    name: a.name,
    listed: a.listed ?? true,
    images: { baby: a.images.baby, junior: a.images.junior, adult: a.images.adult },
  }));
}

// ---------- 宠物图鉴 ----------

export function PetSpeciesPage() {
  const list = useRemote(PetSpeciesAdminEndpoints.listSpecies);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PetSpecies | 'new' | null>(null);
  const [drafts, setDrafts] = useState<AppearanceDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<PetSpecies | null>(null);
  const items = list.data?.items ?? [];
  const selected = items.find((s) => s.speciesId === selectedId) ?? items[0] ?? null;

  function open(target: PetSpecies | 'new') {
    setEditing(target);
    setDrafts(target === 'new' ? [{ name: '', images: {} }] : toDrafts(target));
    setMessage('');
    setError('');
  }
  const complete =
    drafts.length > 0 && drafts.every((d) => d.name.trim() && stages.every(([k]) => d.images[k]));

  async function uploadStage(index: number, stage: StageKey, file: File) {
    setError('');
    try {
      const media = await api.call(MediaAdminEndpoints.adminUpload, {
        query: { purpose: 'pet_art' },
        file,
      });
      setDrafts((list) =>
        list.map((d, i) =>
          i === index
            ? { ...d, images: { ...d.images, [stage]: { mediaId: media.mediaId, url: media.url } } }
            : d,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const listed = form.get('listed') === 'on';
    if (listed && !complete) {
      setError('每个外观的三个阶段图片都传齐后才能上架');
      return;
    }
    const body = {
      name: String(form.get('name') ?? '').trim(),
      intro: String(form.get('intro') ?? '').trim(),
      presetNames: String(form.get('presetNames') ?? '')
        .split(/[,，、\s]+/)
        .map((n) => n.trim())
        .filter(Boolean)
        .slice(0, 30),
      listed,
      appearances: drafts.map((d) => ({
        ...(d.appearanceId ? { appearanceId: d.appearanceId } : {}),
        name: d.name.trim(),
        listed: d.listed ?? true,
        imageMediaIds: {
          baby: d.images.baby?.mediaId ?? '',
          junior: d.images.junior?.mediaId ?? '',
          adult: d.images.adult?.mediaId ?? '',
        },
      })),
    };
    setPending(true);
    setError('');
    try {
      const saved =
        editing === 'new'
          ? await api.call(PetSpeciesAdminEndpoints.createSpecies, { body })
          : await api.call(PetSpeciesAdminEndpoints.updateSpecies, {
              params: { speciesId: editing.speciesId },
              body,
            });
      setMessage('已保存');
      setEditing(null);
      setSelectedId(saved.speciesId);
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  async function toggleListed(species: PetSpecies) {
    setPending(true);
    setError('');
    try {
      await api.call(PetSpeciesAdminEndpoints.updateSpecies, {
        params: { speciesId: species.speciesId },
        body: { listed: !species.listed },
      });
      setMessage(species.listed ? '已下架' : '已上架');
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>宠物图鉴</h1>
        <button className="primary" onClick={() => open('new')}>
          新建物种
        </button>
      </div>
      <p className="inline-tip">
        每个外观需要幼年、少年、成年三张图（透明底
        512×512，同一外观三张看得出是同一只）。不显示稀有度、没有限定款。
      </p>
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={list.refresh}>重试</button>
        </p>
      )}
      <Feedback message={message} error={editing ? undefined : error} />
      {list.data && items.length === 0 && !editing && (
        <p className="hint">
          还没有物种 <button onClick={() => open('new')}>新建物种</button>
        </p>
      )}
      {editing && (
        <form className="panel stack" onSubmit={(e) => void save(e)}>
          <h2>{editing === 'new' ? '新建物种' : `编辑：${editing.name}`}</h2>
          <label>
            名称 *
            <input
              name="name"
              required
              maxLength={12}
              defaultValue={editing === 'new' ? '' : editing.name}
            />
          </label>
          <label>
            简介（≤ 50 字）
            <input
              name="intro"
              maxLength={50}
              defaultValue={editing === 'new' ? '' : editing.intro}
            />
          </label>
          <label>
            预设名字（起名兜底，用逗号分隔，每个 ≤ 8 字）
            <input
              name="presetNames"
              defaultValue={editing === 'new' ? '' : editing.presetNames.join('，')}
            />
          </label>
          <fieldset>
            <legend>外观</legend>
            {drafts.map((d, index) => (
              <div key={d.appearanceId ?? `new-${index}`} className="array-item">
                <label>
                  外观名 *
                  <input
                    required
                    maxLength={12}
                    value={d.name}
                    onChange={(e) =>
                      setDrafts((list) =>
                        list.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={d.listed ?? true}
                    onChange={(event) =>
                      setDrafts((items) =>
                        items.map((item, position) =>
                          position === index ? { ...item, listed: event.target.checked } : item,
                        ),
                      )
                    }
                  />
                  这个外观上架
                </label>
                <div className="button-row">
                  {stages.map(([stage, label]) => (
                    <label key={stage} className="stage-upload">
                      {label}
                      {d.images[stage] ? (
                        <img
                          className="asset-thumb"
                          src={adminMediaUrl(d.images[stage]!.url)}
                          alt={`${d.name}${label}`}
                        />
                      ) : (
                        <span className="hint">未上传</span>
                      )}
                      <input
                        type="file"
                        accept="image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadStage(index, stage, file);
                        }}
                      />
                    </label>
                  ))}
                </div>
                {!d.appearanceId && drafts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}
                  >
                    移除这个外观
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDrafts((list) => [...list, { name: '', images: {} }])}
            >
              新增外观
            </button>
            <p className="hint">已有外观只能改图，不能删除（已经被领养的不受影响）。</p>
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              name="listed"
              disabled={!complete}
              defaultChecked={editing === 'new' ? false : editing.listed}
            />
            上架{!complete && '（三个阶段图片传齐后才能上架）'}
          </label>
          <Feedback error={error} />
          <div className="button-row">
            <button className="primary" disabled={pending || drafts.length === 0}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      {items.length > 0 && (
        <div className="split-view">
          <table>
            <thead>
              <tr>
                <th>物种</th>
                <th>状态</th>
                <th>外观数</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr
                  key={s.speciesId}
                  className={selected?.speciesId === s.speciesId ? 'selected' : ''}
                  onClick={() => setSelectedId(s.speciesId)}
                >
                  <td>{s.name}</td>
                  <td>
                    <span className={s.listed ? 'tag success' : 'tag'}>
                      {s.listed ? '上架' : '已下架'}
                    </span>
                  </td>
                  <td>{s.appearances.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected && (
            <div>
              <div className="page-head">
                <h2>{selected.name}</h2>
                <div className="button-row">
                  <button onClick={() => open(selected)}>编辑</button>
                  <button
                    className={selected.listed ? 'danger' : ''}
                    disabled={pending}
                    onClick={() =>
                      selected.listed ? setConfirm(selected) : void toggleListed(selected)
                    }
                  >
                    {selected.listed ? '下架' : '上架'}
                  </button>
                </div>
              </div>
              <p className="hint">{selected.intro}</p>
              <table>
                <thead>
                  <tr>
                    <th>外观</th>
                    <th>幼年</th>
                    <th>少年</th>
                    <th>成年</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.appearances.map((a) => (
                    <tr key={a.appearanceId}>
                      <td>
                        {a.name}
                        <span className={(a.listed ?? true) ? 'tag success' : 'tag'}>
                          {(a.listed ?? true) ? '上架' : '已下架'}
                        </span>
                      </td>
                      {stages.map(([stage, label]) => (
                        <td key={stage}>
                          <img
                            className="asset-thumb"
                            src={adminMediaUrl(a.images[stage].url)}
                            alt={`${a.name}${label}`}
                            loading="lazy"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {confirm && (
        <div className="panel" role="dialog" aria-label="确认下架">
          <p>下架「{confirm.name}」？下架后不能再被选择领养，已经领养的不受影响。</p>
          <div className="button-row">
            <button onClick={() => setConfirm(null)}>取消</button>
            <button
              className="danger"
              disabled={pending}
              onClick={() => void toggleListed(confirm)}
            >
              下架
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- 注销未完成 ----------

const moduleNames: Record<string, string> = {
  identity: '账号',
  realtime: '实时连接',
  push: '推送',
  media: '图片与文件',
  model_access: '模型设置',
  billing: '余额与明细',
  characters: '角色',
  contacts: '通讯录',
  chat: '聊天',
  policy: '内容规则',
  ai_runtime: '记忆与推演',
  proactive: '主动消息',
  moments: '朋友圈',
  growth: '养成（卡片、成就、宠物）',
  importer: '导入',
  library: '收藏',
  health: '经期日记',
  calls: '通话',
  plaza: '人设广场',
  play: '互动玩法',
};

function beijing(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 菜单角标：未完成的注销条数（0 时不显示）。 */
export function PendingDeletionBadge() {
  const list = useRemote(IdentityAdminEndpoints.listPendingDeletions);
  const count = list.data?.items.length ?? 0;
  return count > 0 ? <span className="alert-badge">{count}</span> : null;
}

export function AccountDeletionsPage() {
  const list = useRemote(IdentityAdminEndpoints.listPendingDeletions);
  const [detail, setDetail] = useState<PendingAccountDeletion | null>(null);
  const [confirm, setConfirm] = useState<PendingAccountDeletion | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const items = [...(list.data?.items ?? [])].sort((a, b) =>
    a.requestedAt.localeCompare(b.requestedAt),
  );

  async function retry(item: PendingAccountDeletion) {
    setConfirm(null);
    setPending(item.userId);
    setError('');
    setMessage('');
    try {
      const result = await api.call(IdentityAdminEndpoints.retryDeletion, {
        params: { userId: item.userId },
      });
      if (result.modules.every((m) => m.purged)) setMessage(`${item.username} 的数据已全部删除`);
      else setMessage('已重新触发删除');
      list.refresh();
    } catch (e) {
      // 404：账号已经删除完毕（不在注销中）。
      if (e instanceof ApiFailure && e.status === 404) {
        setMessage(`${item.username} 的数据已全部删除`);
        list.refresh();
      } else setError(errorText(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <h1>注销未完成</h1>
      <p className="inline-tip">这里只显示删除进度，不显示账号的任何内容。注销不能撤销。</p>
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={list.refresh}>重试</button>
        </p>
      )}
      <Feedback message={message} error={error} />
      {list.loading && !list.data && <div className="skeleton-line" role="status" />}
      {list.data && items.length === 0 && <p className="hint">没有未完成的注销</p>}
      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>用户名</th>
              <th>申请注销时间（北京时间）</th>
              <th>最近手动重新触发</th>
              <th>模块进度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const done = item.modules.filter((m) => m.purged).length;
              return (
                <tr key={item.userId} onClick={() => setDetail(item)}>
                  <td>{item.username}</td>
                  <td>{beijing(item.requestedAt)}</td>
                  <td>{beijing(item.lastRetriggeredAt)}</td>
                  <td>
                    {done} / {item.modules.length} 已完成
                    {done < item.modules.length && <span className="tag warning">未完成</span>}
                  </td>
                  <td>
                    <button
                      disabled={pending === item.userId}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirm(item);
                      }}
                    >
                      {pending === item.userId ? '正在触发…' : '重新触发删除'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {confirm && (
        <div className="panel" role="dialog" aria-label="重新触发删除">
          <p>只会对还没完成的模块再执行一次删除；如果其实都已完成，会直接完成账号删除。</p>
          <div className="button-row">
            <button onClick={() => setConfirm(null)}>取消</button>
            <button className="primary" onClick={() => void retry(confirm)}>
              重新触发
            </button>
          </div>
        </div>
      )}
      {detail && (
        <div className="panel" role="dialog" aria-label={`${detail.username} 的删除进度`}>
          <div className="page-head">
            <h2>{detail.username} 的删除进度</h2>
            <button onClick={() => setDetail(null)}>关闭</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>模块</th>
                <th>状态</th>
                <th>删除条数</th>
                <th>完成时间（北京时间）</th>
              </tr>
            </thead>
            <tbody>
              {detail.modules.map((m, i) => (
                <tr key={`${m.module}-${i}`}>
                  <td>{moduleNames[m.module] ?? '其他模块'}</td>
                  <td>
                    <span className={m.purged ? 'tag success' : 'tag warning'}>
                      {m.purged ? '已完成' : '未完成'}
                    </span>
                  </td>
                  <td>{m.deletedRows ?? '—'}</td>
                  <td>{beijing(m.purgedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
