/**
 * 关系网（ADM-02、SOC-01；设计 docs/design/pages/admin-content.md 第 3 节）。
 * 接口：RelationAdminEndpoints。一条关系双向生效；预设角色之间公开依据必填；真人与虚构之间不能建立关系。
 */
import { useState, type FormEvent } from 'react';
import {
  CharacterAdminEndpoints,
  RelationAdminEndpoints,
  type CharacterRelation,
  type RelationCloseness,
  type RelationType,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

const typeNames: Record<RelationType, string> = {
  groupmate: '同团成员',
  costar: '合作演员',
  friend: '朋友',
  mentor: '师徒',
  family: '家人',
  colleague: '同事',
  in_work: '作品中的关系',
  other: '其他',
};
const closenessNames: Record<RelationCloseness, string> = {
  acquaintance: '点头之交',
  familiar: '熟悉',
  close: '亲密',
};

interface Draft {
  relation: CharacterRelation | null;
  a: string;
  b: string;
  type: RelationType;
  label: string;
  closeness: RelationCloseness;
  evidence: string;
}

export function RelationsPage() {
  const [characterId, setCharacterId] = useState('');
  const [typeFilter, setTypeFilter] = useState<RelationType | ''>('');
  const [closenessFilter, setClosenessFilter] = useState<RelationCloseness | ''>('');
  const characters = useRemote(CharacterAdminEndpoints.list);
  const list = useRemote(RelationAdminEndpoints.listRelations, {
    query: { characterId: characterId || undefined },
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<CharacterRelation | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const all = characters.data?.items ?? [];
  const nameOf = (id: string) => all.find((c) => c.characterId === id)?.name ?? id.slice(0, 8);
  const basisOf = (id: string) => all.find((c) => c.characterId === id)?.classification.basis;
  const rows = (list.data?.items ?? [])
    .filter((r) => r.ownerUserId === null)
    .filter((r) => !typeFilter || r.type === typeFilter)
    .filter((r) => !closenessFilter || r.closeness === closenessFilter)
    .map((r) =>
      characterId && r.characterBId === characterId
        ? { ...r, characterAId: r.characterBId, characterBId: r.characterAId }
        : r,
    );
  const related = (a: string) =>
    (list.data?.items ?? [])
      .filter((r) => r.characterAId === a || r.characterBId === a)
      .map((r) => (r.characterAId === a ? r.characterBId : r.characterAId));
  const mixed =
    !!draft?.a &&
    !!draft.b &&
    (basisOf(draft.a) === 'real_person') !== (basisOf(draft.b) === 'real_person');
  async function run(operation: () => Promise<unknown>, done: string, after: () => void) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(done);
      after();
      list.refresh();
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.status === 409
          ? '这两个角色已经有关系了'
          : e instanceof ApiFailure && e.status === 422
            ? '真人和虚构角色之间不能建立关系'
            : errorText(e),
      );
    } finally {
      setPending(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || mixed || !draft.evidence.trim()) return;
    const label = draft.label.trim() || null;
    void run(
      () =>
        draft.relation
          ? api.call(RelationAdminEndpoints.updateRelation, {
              params: { relationId: draft.relation.relationId },
              body: {
                type: draft.type,
                label,
                closeness: draft.closeness,
                evidence: draft.evidence.trim(),
              },
            })
          : api.call(RelationAdminEndpoints.createRelation, {
              body: {
                characterAId: draft.a,
                characterBId: draft.b,
                type: draft.type,
                label,
                closeness: draft.closeness,
                evidence: draft.evidence.trim(),
              },
            }),
      '已保存',
      () => setDraft(null),
    );
  }
  return (
    <>
      <div className="page-head">
        <h1>关系网</h1>
        <button
          className="primary"
          onClick={() =>
            setDraft({
              relation: null,
              a: characterId,
              b: '',
              type: 'friend',
              label: '',
              closeness: 'familiar',
              evidence: '',
            })
          }
        >
          新建关系
        </button>
      </div>
      <div className="panel form-grid">
        <label>
          角色
          <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
            <option value="">全部</option>
            {all.map((c) => (
              <option key={c.characterId} value={c.characterId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          关系类型
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '')}>
            <option value="">全部</option>
            {Object.entries(typeNames).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          亲疏
          <select
            value={closenessFilter}
            onChange={(e) => setClosenessFilter(e.target.value as '')}
          >
            <option value="">全部</option>
            {Object.entries(closenessNames).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Feedback message={message} error={error} />
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={list.refresh}>重试</button>
        </p>
      )}
      {draft && (
        <form className="panel stack" onSubmit={submit}>
          <h2>{draft.relation ? '编辑关系' : '新建关系'}</h2>
          <div className="form-grid">
            <label>
              角色 A *
              <select
                required
                disabled={!!draft.relation}
                value={draft.a}
                onChange={(e) => setDraft({ ...draft, a: e.target.value, b: '' })}
              >
                <option value="">请选择</option>
                {all.map((c) => (
                  <option key={c.characterId} value={c.characterId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              角色 B *
              <select
                required
                disabled={!!draft.relation || !draft.a}
                value={draft.b}
                onChange={(e) => setDraft({ ...draft, b: e.target.value })}
              >
                <option value="">请选择</option>
                {all
                  .filter(
                    (c) =>
                      draft.relation ||
                      (c.characterId !== draft.a && !related(draft.a).includes(c.characterId)),
                  )
                  .map((c) => (
                    <option key={c.characterId} value={c.characterId}>
                      {c.name}
                    </option>
                  ))}
              </select>
              {mixed && <span className="error">真人和虚构角色之间不能建立关系</span>}
            </label>
            <label>
              关系类型 *
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as RelationType })}
              >
                {Object.entries(typeNames).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(draft.type === 'in_work' || draft.type === 'other') && (
            <label>
              补充说明（例：《XX》中的师兄妹）
              <input
                maxLength={30}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
          )}
          <div className="inline">
            亲疏 *
            {(Object.keys(closenessNames) as RelationCloseness[]).map((c) => (
              <button
                type="button"
                key={c}
                className={draft.closeness === c ? 'active' : ''}
                aria-pressed={draft.closeness === c}
                onClick={() => setDraft({ ...draft, closeness: c })}
              >
                {closenessNames[c]}
              </button>
            ))}
          </div>
          <label>
            公开依据 *（文字说明与链接）
            <textarea
              required
              maxLength={500}
              value={draft.evidence}
              onChange={(e) => setDraft({ ...draft, evidence: e.target.value })}
            />
          </label>
          <div className="inline">
            <button
              className="primary"
              disabled={pending || mixed || !draft.a || !draft.b || !draft.evidence.trim()}
            >
              保存
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              取消
            </button>
            {draft.relation && (
              <button type="button" className="danger" onClick={() => setRemoving(draft.relation)}>
                删除
              </button>
            )}
          </div>
        </form>
      )}
      {removing && (
        <div role="dialog" aria-label="删除关系" className="panel stack">
          <p>删除后，两人不会再在群聊、朋友圈互动，也不会再互相提起；已有的聊天记录会保留</p>
          <p className="hint">此操作会记入审计记录</p>
          <div className="inline">
            <button onClick={() => setRemoving(null)}>取消</button>
            <button
              className="danger"
              disabled={pending}
              onClick={() =>
                void run(
                  () =>
                    api.call(RelationAdminEndpoints.deleteRelation, {
                      params: { relationId: removing.relationId },
                    }),
                  '已删除',
                  () => {
                    setRemoving(null);
                    setDraft(null);
                  },
                )
              }
            >
              删除
            </button>
          </div>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>角色 A</th>
            <th>角色 B</th>
            <th>关系类型</th>
            <th>亲疏</th>
            <th>公开依据</th>
            <th>更新时间（北京时间）</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.relationId}>
              <td>{nameOf(r.characterAId)}</td>
              <td>{nameOf(r.characterBId)}</td>
              <td>
                {typeNames[r.type]}
                {r.label ? `（${r.label}）` : ''}
              </td>
              <td>{closenessNames[r.closeness]}</td>
              <td className="ellipsis">{r.evidence}</td>
              <td>
                {new Date(r.updatedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              </td>
              <td>
                <button
                  onClick={() =>
                    setDraft({
                      relation: r,
                      a: r.characterAId,
                      b: r.characterBId,
                      type: r.type,
                      label: r.label ?? '',
                      closeness: r.closeness,
                      evidence: r.evidence ?? '',
                    })
                  }
                >
                  编辑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data && rows.length === 0 && (
        <p className="hint">
          {characterId ? 'TA 还没有关系 · 没有关系的两个角色相遇时会像陌生人一样' : '还没有关系'}
        </p>
      )}
    </>
  );
}
