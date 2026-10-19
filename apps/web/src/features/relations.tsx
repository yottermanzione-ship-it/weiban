import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  UserCustomEndpoints,
  UserRelationEndpoints,
  type CharacterRelation,
  type RelationCloseness,
  type RelationType,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { NavBar } from './shell-kit.js';

/*
 * TA 认识的人（SOC-01 第 3 条；social-l4.md 第 6 节）：只在用户自己的自定义角色之间设置关系，双向生效。
 */

export const relationTypeNames: Record<RelationType, string> = {
  friend: '朋友',
  family: '家人',
  groupmate: '同学',
  colleague: '同事',
  costar: '搭档',
  mentor: '师徒',
  in_work: '作品中的关系',
  other: '其他',
};
export const closenessNames: Record<RelationCloseness, string> = {
  acquaintance: '点头之交',
  familiar: '熟悉',
  close: '亲密',
};
const userTypes: RelationType[] = ['friend', 'family', 'groupmate', 'colleague', 'costar', 'other'];

/** 我的全部自定义角色 ID（GET /characters/custom）。 */
export function useCustomCharacterIds(): string[] | undefined {
  const remote = useRemote(UserCustomEndpoints.list);
  return remote.data?.items.map((c) => c.characterId);
}

/** 资料页「TA 认识的人 N 个 ›」行：只有用户拥有 2 个及以上自定义角色、且本角色是自定义角色时显示。 */
export function RelationsRow({ characterId }: { characterId: string }) {
  const customs = useCustomCharacterIds();
  const relations = useRemote(UserRelationEndpoints.listMyRelations);
  if (!customs || customs.length < 2 || !customs.includes(characterId)) return null;
  const count =
    relations.data?.items.filter(
      (r) => r.characterAId === characterId || r.characterBId === characterId,
    ).length ?? 0;
  return (
    <Link className="panel row-link" to={`/characters/${characterId}/relations`}>
      <span>TA 认识的人</span>
      <small>{count} 个 ›</small>
    </Link>
  );
}

export function RelationsPage() {
  const { characterId = '' } = useParams();
  const { state } = useChat();
  const customs = useCustomCharacterIds();
  const relations = useRemote(UserRelationEndpoints.listMyRelations);
  const names = useCharacterNames(customs ?? []);
  const [editing, setEditing] = useState<{
    relation: CharacterRelation | null;
    otherId: string;
    type: RelationType;
    label: string;
    closeness: RelationCloseness;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  const mine = (relations.data?.items ?? []).filter(
    (r) => r.characterAId === characterId || r.characterBId === characterId,
  );
  const otherOf = (r: CharacterRelation) =>
    r.characterAId === characterId ? r.characterBId : r.characterAId;
  const candidates = (customs?.includes(characterId) ? customs : []).filter(
    (id) => id !== characterId && !mine.some((r) => otherOf(r) === id),
  );
  async function run(operation: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await operation();
      setEditing(null);
      setConfirmDelete(false);
      relations.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <NavBar
        title="TA 认识的人"
        fallback={`/characters/${characterId}`}
        right={
          <button
            type="button"
            className="text-button text-action"
            aria-label="添加关系"
            disabled={pending || relations.loading || candidates.length === 0}
            onClick={() =>
              setEditing({
                relation: null,
                otherId: candidates[0] ?? '',
                type: 'friend',
                label: '',
                closeness: 'familiar',
              })
            }
          >
            ＋
          </button>
        }
      />
      {relations.loading && !relations.data && (
        <div className="stack" role="status" aria-label="正在读取">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}
      {relations.data && mine.length === 0 && (
        <p className="hint">
          还没有设置关系{' '}
          {!relations.loading && candidates.length > 0 && (
            <button
              className="text-button"
              onClick={() =>
                setEditing({
                  relation: null,
                  otherId: candidates[0]!,
                  type: 'friend',
                  label: '',
                  closeness: 'familiar',
                })
              }
            >
              添加
            </button>
          )}
        </p>
      )}
      {mine.length > 0 && (
        <div className="panel rows">
          {mine.map((r) => (
            <button
              key={r.relationId}
              className="role-row"
              onClick={() =>
                setEditing({
                  relation: r,
                  otherId: otherOf(r),
                  type: r.type,
                  label: r.label ?? '',
                  closeness: r.closeness,
                })
              }
            >
              <CharacterAvatar id={otherOf(r)} size={40} />
              {nameOf(otherOf(r))}
              <small className="row-value">
                {r.type === 'other' && r.label ? r.label : relationTypeNames[r.type]} ·{' '}
                {closenessNames[r.closeness]}
              </small>
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        只有你创建的角色之间可以设置关系。设置后 TA 们会在群聊、朋友圈里互相认识。
      </p>
      {customs?.includes(characterId) && customs.length < 2 && (
        <p className="hint">需要至少两个自己创建的角色才能添加关系。</p>
      )}
      {editing && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            const label = editing.type === 'other' ? editing.label.trim() || null : null;
            void run(() =>
              editing.relation
                ? api.call(UserRelationEndpoints.updateMyRelation, {
                    params: { relationId: editing.relation.relationId },
                    body: { type: editing.type, label, closeness: editing.closeness },
                  })
                : api.call(UserRelationEndpoints.createMyRelation, {
                    body: {
                      characterAId: characterId,
                      characterBId: editing.otherId,
                      type: editing.type,
                      label,
                      closeness: editing.closeness,
                    },
                  }),
            );
          }}
        >
          <label>
            对方
            <select
              disabled={!!editing.relation}
              value={editing.otherId}
              onChange={(e) => setEditing({ ...editing, otherId: e.target.value })}
            >
              {(editing.relation ? [editing.otherId] : candidates).map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </select>
          </label>
          <h3 className="group-label">关系类型</h3>
          <div className="chips">
            {userTypes.map((t) => (
              <button
                type="button"
                key={t}
                className="chip"
                aria-pressed={editing.type === t}
                onClick={() => setEditing({ ...editing, type: t })}
              >
                {relationTypeNames[t]}
              </button>
            ))}
          </div>
          {editing.type === 'other' && (
            <label>
              具体关系
              <input
                maxLength={8}
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </label>
          )}
          <h3 className="group-label">亲疏</h3>
          <div className="chips">
            {(Object.keys(closenessNames) as RelationCloseness[]).map((c) => (
              <button
                type="button"
                key={c}
                className="chip"
                aria-pressed={editing.closeness === c}
                onClick={() => setEditing({ ...editing, closeness: c })}
              >
                {closenessNames[c]}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button className="primary" disabled={pending || !editing.otherId}>
              完成
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
          {editing.relation && (
            <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
              删除关系
            </button>
          )}
        </form>
      )}
      {confirmDelete && editing?.relation && (
        <div role="dialog" aria-label="删除关系" className="panel">
          <p>删除后，TA 们不会再在群聊、朋友圈互动，也不会再互相提起；以前的聊天记录会保留</p>
          <button
            className="danger"
            disabled={pending}
            onClick={() =>
              void run(() =>
                api.call(UserRelationEndpoints.deleteMyRelation, {
                  params: { relationId: editing.relation!.relationId },
                }),
              )
            }
          >
            删除
          </button>
          <button onClick={() => setConfirmDelete(false)}>取消</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
