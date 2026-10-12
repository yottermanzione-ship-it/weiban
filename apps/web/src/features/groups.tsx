import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChatEndpoints,
  ChatGroupEndpoints,
  GROUP_MEMBER_LIMIT,
  GROUP_MIN_CHARACTERS,
  GroupCompanionEndpoints,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { Name, groupMembers } from './chat.js';

function groupError(e: unknown): string {
  if (e instanceof ApiFailure && e.status === 422 && e.code === 'limit_reached')
    return `群里最多 ${GROUP_MEMBER_LIMIT} 个角色`;
  if (e instanceof ApiFailure && e.code === 'adult_mode_not_eligible')
    return '群里有成员不能使用这个模式';
  if (e instanceof ApiFailure && e.code === 'romance_not_allowed')
    return '群里有成员不能使用恋爱模式';
  return friendlyError(e);
}

/** 通讯录 › 群聊（social-l4.md 2.1）。 */
export function GroupListPage() {
  const { state } = useChat();
  const groups = state.conversations
    // 「不显示该聊天」的群也在这里（隐藏≠退群）；解散的群服务器会删掉，本地不会再有。
    .filter((c) => c.type === 'group')
    .sort((a, b) =>
      (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(
        a.lastMessage?.createdAt ?? a.updatedAt,
      ),
    );
  return (
    <main>
      <Link to="/contacts">‹ 通讯录</Link>
      <h1 className="page-title">群聊</h1>
      {groups.length === 0 ? (
        <div className="empty">
          <p>还没有群聊</p>
          <p className="hint">在会话列表右上角「发起群聊」可以建群</p>
        </div>
      ) : (
        <>
          <div className="panel rows">
            {groups.map((g) => (
              <Link key={g.conversationId} to={`/chat/${g.conversationId}`} className="role-row">
                <GroupAvatar ids={groupMembers(g).map((m) => m.refId)} />
                <Name conversation={g} />
              </Link>
            ))}
          </div>
          <p className="hint center">{groups.length} 个群聊</p>
        </>
      )}
    </main>
  );
}

/** 群头像：最多 4 个成员头像拼成宫格。 */
export function GroupAvatar({ ids }: { ids: string[] }) {
  return (
    <span className="group-avatar" aria-hidden>
      {ids.slice(0, 4).map((id) => (
        <CharacterAvatar key={id} id={id} size={22} />
      ))}
    </span>
  );
}

/**
 * 选择角色页（group-chat.md 第 3 节）：
 * - /groups/new?with=角色ID：发起群聊（聊天信息页「+」带上原角色并锁定）；
 * - /groups/new?add=会话ID：往已有群里加人（已在群里的锁定）。
 */
export function SelectMembersPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { state, synchronize } = useChat();
  const addTo = params.get('add');
  const target = addTo ? state.conversations.find((c) => c.conversationId === addTo) : undefined;
  const locked = useMemo(
    () =>
      target
        ? groupMembers(target).map((m) => m.refId)
        : params.get('with')
          ? [params.get('with')!]
          : [],
    [target, params],
  );
  const contacts = state.contacts.filter((c) => c.status === 'active');
  const names = useCharacterNames(contacts.map((c) => c.characterId));
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [requestId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const nameOf = (id: string) =>
    contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  const total = locked.length + picked.length;
  const full = total >= GROUP_MEMBER_LIMIT;
  const enough = addTo ? picked.length >= 1 : total >= GROUP_MIN_CHARACTERS;
  const list = contacts
    .filter((c) => !query || nameOf(c.characterId).includes(query))
    .sort((a, b) => nameOf(a.characterId).localeCompare(nameOf(b.characterId), 'zh-CN'));
  async function done() {
    setPending(true);
    setError('');
    try {
      if (addTo) {
        await api.call(ChatGroupEndpoints.addMembers, {
          params: { conversationId: addTo },
          body: { characterIds: picked },
        });
        await synchronize();
        navigate(`/chat/${addTo}/group`, { replace: true });
      } else {
        const created = await api.call(ChatGroupEndpoints.createGroup, {
          body: { clientRequestId: requestId, characterIds: [...locked, ...picked] },
        });
        await synchronize();
        navigate(`/chat/${created.conversationId}`, { replace: true });
      }
    } catch (e) {
      setError(groupError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <header className="page-header">
        <button className="text-button" onClick={() => navigate(-1)}>
          取消
        </button>
        <h1>{addTo ? '添加成员' : '发起群聊'}</h1>
        <button className="primary" disabled={pending || !enough} onClick={() => void done()}>
          完成{total > 0 ? `(${addTo ? picked.length : total})` : ''}
        </button>
      </header>
      <label className="search-label">
        搜索
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {full && <p className="hint">群里最多 {GROUP_MEMBER_LIMIT} 个角色</p>}
      {error && <p role="alert">{error}</p>}
      {contacts.length === 0 && <p className="empty">通讯录里还没有角色</p>}
      <div className="panel rows">
        {list.map((c) => {
          const isLocked = locked.includes(c.characterId);
          const checked = isLocked || picked.includes(c.characterId);
          return (
            <label key={c.characterId} className="role-row check-row">
              <input
                type="checkbox"
                checked={checked}
                disabled={isLocked || (!checked && full)}
                onChange={(e) =>
                  setPicked((v) =>
                    e.target.checked
                      ? [...v, c.characterId]
                      : v.filter((id) => id !== c.characterId),
                  )
                }
              />
              <CharacterAvatar id={c.characterId} size={40} />
              {nameOf(c.characterId)}
            </label>
          );
        })}
      </div>
    </main>
  );
}

/** 群聊信息页（group-chat.md、social-l4.md 2.3～2.6）。 */
export function GroupSettingsPage() {
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const { state, synchronize, clearHistory, assertOwner } = useChat();
  const conversation = state.conversations.find((c) => c.conversationId === conversationId);
  const companion = useRemote(GroupCompanionEndpoints.getSettings, {
    params: { conversationId },
  });
  const members = conversation ? groupMembers(conversation) : [];
  const names = useCharacterNames(members.map((m) => m.refId));
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [confirm, setConfirm] = useState<'clear' | 'dissolve' | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!conversation || conversation.type !== 'group')
    return (
      <main>
        <Link to="/chat">返回微伴</Link>
        <p className="empty">{state.initialized ? '这个群聊已解散' : '正在读取…'}</p>
      </main>
    );
  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  async function change(operation: () => Promise<unknown>, done = '已保存', after?: () => void) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      assertOwner();
      await operation();
      await synchronize();
      setMessage(done);
      after?.();
    } catch (e) {
      setError(groupError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <Link to={`/chat/${conversationId}`}>‹ 返回群聊</Link>
      <h1 className="page-title">聊天信息（{members.length + 1}）</h1>
      <div className="panel member-grid">
        {members.map((m) => (
          <div key={m.participantId} className="member-cell">
            {removing && members.length > 1 && (
              <button
                className="member-remove"
                aria-label={`移出${nameOf(m.refId)}`}
                disabled={pending}
                onClick={() =>
                  void change(
                    () =>
                      api.call(ChatGroupEndpoints.removeMember, {
                        params: { conversationId, characterId: m.refId },
                      }),
                    `已将 ${nameOf(m.refId)} 移出群聊`,
                  )
                }
              >
                −
              </button>
            )}
            <Link to={`/characters/${m.refId}`}>
              <CharacterAvatar id={m.refId} size={48} />
            </Link>
            <small>{nameOf(m.refId)}</small>
          </div>
        ))}
        {!removing && (
          <Link
            className="member-cell member-action"
            aria-label="添加成员"
            to={`/groups/new?add=${conversationId}`}
            aria-disabled={members.length >= GROUP_MEMBER_LIMIT}
            onClick={(e) => {
              if (members.length >= GROUP_MEMBER_LIMIT) e.preventDefault();
            }}
          >
            ＋
          </Link>
        )}
        <button
          className="member-cell member-action"
          aria-label={removing ? '完成' : '移出成员'}
          disabled={!removing && members.length <= 1}
          onClick={() => setRemoving((v) => !v)}
        >
          {removing ? '完成' : '−'}
        </button>
      </div>
      {members.length <= 1 && (
        <p className="hint">群里至少要有 1 个角色，不想要这个群可以「删除并退出」</p>
      )}
      <div className="panel rows">
        <button
          className="row-button"
          onClick={() => {
            setTitle(conversation.group?.titleCustomized ? (conversation.title ?? '') : '');
            setRenaming(true);
          }}
        >
          群聊名称
          <small>{conversation.title ?? ''}</small>
        </button>
        <button className="row-button" onClick={() => navigate(`/chat/${conversationId}/search`)}>
          查找聊天记录
        </button>
      </div>
      {renaming && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            const value = title.trim();
            void change(
              () =>
                api.call(ChatGroupEndpoints.renameGroup, {
                  params: { conversationId },
                  body: {
                    title: value || null,
                  },
                }),
              '已保存',
              () => setRenaming(false),
            );
          }}
        >
          <label>
            群聊名称
            <input
              maxLength={16}
              value={title}
              placeholder={members.map((m) => nameOf(m.refId)).join('、')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <small>清空后保存 = 恢复默认名</small>
          <div className="button-row">
            <button className="primary" disabled={pending}>
              完成
            </button>
            <button type="button" onClick={() => setRenaming(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      <div className="panel stack">
        <label className="check">
          <input
            type="checkbox"
            checked={conversation.state.muted}
            disabled={pending}
            onChange={(e) =>
              void change(() =>
                api.call(ChatEndpoints.updateState, {
                  params: { conversationId },
                  body: { muted: e.target.checked },
                }),
              )
            }
          />
          消息免打扰
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={conversation.state.pinned}
            disabled={pending}
            onChange={(e) =>
              void change(() =>
                api.call(ChatEndpoints.updateState, {
                  params: { conversationId },
                  body: { pinned: e.target.checked },
                }),
              )
            }
          />
          置顶聊天
        </label>
      </div>
      {companion.data && (
        <div className="panel stack">
          <h3 className="group-label">微伴</h3>
          <p className="hint">情景预设在聊天输入栏「+」里切换</p>
          <label className="check">
            <input
              type="checkbox"
              checked={companion.data.selfChatEnabled}
              disabled={pending}
              onChange={(e) =>
                void change(
                  () =>
                    api.call(GroupCompanionEndpoints.updateSettings, {
                      params: { conversationId },
                      body: { selfChatEnabled: e.target.checked },
                    }),
                  '已保存',
                  companion.refresh,
                )
              }
            />
            角色自己聊天
          </label>
          <small>开启后，你不在时群里的角色也会偶尔聊几句</small>
          <label className="check">
            <input
              type="checkbox"
              checked={companion.data.instantReply}
              disabled={pending}
              onChange={(e) =>
                void change(
                  () =>
                    api.call(GroupCompanionEndpoints.updateSettings, {
                      params: { conversationId },
                      body: { instantReply: e.target.checked },
                    }),
                  '已保存',
                  companion.refresh,
                )
              }
            />
            秒回
          </label>
        </div>
      )}
      {companion.error && !companion.data && <p role="alert">{companion.error}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="panel rows">
        <button className="row-button" disabled={pending} onClick={() => setConfirm('clear')}>
          清空聊天记录
        </button>
        <button
          className="row-button danger"
          disabled={pending}
          onClick={() => setConfirm('dissolve')}
        >
          删除并退出
        </button>
      </div>
      {confirm && (
        <div
          role="dialog"
          aria-label={confirm === 'clear' ? '清空聊天记录' : '删除并退出'}
          className="panel"
        >
          <p>
            {confirm === 'clear'
              ? '清空这个群的聊天记录？'
              : '删除并退出后，这个群会解散，聊天记录也会删除'}
          </p>
          <button
            className="danger"
            disabled={pending}
            onClick={() =>
              void change(
                async () => {
                  if (confirm === 'clear') await clearHistory(conversationId);
                  else
                    await api.call(ChatGroupEndpoints.dissolveGroup, {
                      params: { conversationId },
                    });
                },
                confirm === 'clear' ? '已清空' : '已退出',
                () => {
                  setConfirm(null);
                  if (confirm === 'dissolve') navigate('/chat', { replace: true });
                },
              )
            }
          >
            确认
          </button>
          <button disabled={pending} onClick={() => setConfirm(null)}>
            取消
          </button>
        </div>
      )}
    </main>
  );
}
