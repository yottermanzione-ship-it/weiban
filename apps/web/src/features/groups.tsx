import { SearchField } from './search-field.js';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChatEndpoints,
  ChatGroupEndpoints,
  GROUP_MEMBER_LIMIT,
  GROUP_MIN_CHARACTERS,
  GroupCompanionEndpoints,
  MembershipEndpoints,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { Name, groupMembers } from './chat.js';
import { OldIcon } from './old-icons.js';
import { listTime } from './time-format.js';
import {
  CheckCircle,
  EmptyState,
  MenuGroup,
  MenuRow,
  NavBar,
  SwitchRow,
  SyncPendingState,
} from './shell-kit.js';
import { AlertDialog, showSnackbar, showToast } from './toast.js';
import { FieldPage } from './edit-page.js';
import { AvatarEditor } from './avatar-editor.js';
import { MediaImg } from './media.js';

function groupError(e: unknown): string {
  if (e instanceof ApiFailure && e.status === 422 && e.code === 'limit_reached')
    return `群里最多 ${GROUP_MEMBER_LIMIT} 个角色`;
  // 10-25（会员 v6）：群聊是 PRO+ 权益，服务端返回 403 membership_required 时引导开通。
  if (e instanceof ApiFailure && e.code === 'membership_required')
    return '群聊是 PRO+ 会员权益，开通后才能发起群聊、在群里发消息';
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
      <NavBar title="群聊" fallback="/contacts" />
      {groups.length === 0 ? (
        <EmptyState
          icon="wechat/chat_pair"
          title="还没有群聊"
          desc="在会话列表右上角「发起群聊」可以建群"
        />
      ) : (
        <>
          <MenuGroup className="group-list">
            {groups.map((g) => (
              <Link key={g.conversationId} to={`/chat/${g.conversationId}`} className="group-row">
                <GroupAvatar
                  ids={groupMembers(g).map((m) => m.refId)}
                  mediaId={g.group?.avatarMediaId}
                  size={44}
                />
                <span className="group-row-text">
                  <span>
                    <Name conversation={g} />
                  </span>
                  <small>{groupMembers(g).length + 1} 位成员</small>
                </span>
                <small className="group-row-time">
                  {listTime(g.lastMessage?.createdAt ?? g.updatedAt)}
                </small>
                <OldIcon name="wechat/chevron_right" size={20} className="menu-caret" />
              </Link>
            ))}
          </MenuGroup>
          <p className="contacts-count">{groups.length} 个群聊</p>
        </>
      )}
    </main>
  );
}

/** 群头像：最多 4 个成员头像拼成宫格；没有成员时橙底白色群组图标（3.12）。 */
export function GroupAvatar({
  ids,
  mediaId,
  size = 48,
}: {
  ids: string[];
  mediaId?: string | null;
  size?: number;
}) {
  if (mediaId)
    return (
      <span className="group-avatar custom-group-avatar" style={{ width: size, height: size }}>
        <MediaImg key={mediaId} mediaId={mediaId} alt="群头像" />
      </span>
    );
  const cell = Math.floor((size - 4) / 2);
  return (
    <span
      className={`group-avatar ${ids.length === 0 ? 'empty' : ''}`}
      style={{ width: size, height: size, gridTemplateColumns: `repeat(2, ${cell}px)` }}
      aria-hidden
    >
      {ids.length === 0 ? (
        <OldIcon name="wechat/chat_pair" size={Math.round(size * 0.52)} />
      ) : (
        ids.slice(0, 4).map((id) => <CharacterAvatar key={id} id={id} size={cell} radius={2} />)
      )}
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
  // 10-25（会员 v6）：发起群聊只对 PRO+ 开放；「添加成员」不是建群，旧群仍可由免费用户维护成员。
  // 服务端同样校验（403 membership_required），这里只提前引导，不作为唯一防线。
  const membership = useRemote(MembershipEndpoints.get);
  const createLocked = !addTo && membership.data?.tier === 'free';
  const nameOf = (id: string) =>
    contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  const total = locked.length + picked.length;
  const full = total >= GROUP_MEMBER_LIMIT;
  const enough = addTo ? picked.length >= 1 : total >= GROUP_MIN_CHARACTERS;
  const list = contacts
    .filter((c) => !query || nameOf(c.characterId).includes(query))
    .sort((a, b) => nameOf(a.characterId).localeCompare(nameOf(b.characterId), 'zh-CN'));
  async function done() {
    if (pending || !enough || createLocked) return;
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
  if (createLocked)
    return (
      <main className="select-members">
        <NavBar
          title="发起群聊"
          left={
            <button
              type="button"
              className="text-button text-action plain-text"
              onClick={() => navigate(-1)}
            >
              取消
            </button>
          }
        />
        <p className="notice-bar" role="status">
          群聊是 PRO+ 会员权益，开通后即可发起群聊。
          <Link to="/membership">去开通 ›</Link>
        </p>
        <EmptyState
          icon="wechat/chat_pair"
          title="还不能发起群聊"
          desc="已加入的旧群仍可以查看历史消息，只是暂时不能在里面发言"
        />
      </main>
    );
  return (
    <main className="select-members">
      <NavBar
        title={addTo ? '添加成员' : '发起群聊'}
        left={
          <button
            type="button"
            className="text-button text-action plain-text"
            disabled={pending}
            onClick={() => navigate(-1)}
          >
            取消
          </button>
        }
        right={
          <button
            className="primary"
            disabled={pending || !enough}
            aria-busy={pending}
            onClick={() => void done()}
          >
            {pending
              ? addTo
                ? '正在添加…'
                : '正在建群…'
              : `完成${total > 0 ? `(${addTo ? picked.length : total})` : ''}`}
          </button>
        }
      />
      {picked.length > 0 && (
        <div className="picked-strip">
          {picked.map((id) => (
            <button
              key={id}
              type="button"
              disabled={pending}
              onClick={() => setPicked((v) => v.filter((x) => x !== id))}
              aria-label={`取消选择${nameOf(id)}`}
            >
              <CharacterAvatar id={id} size={44} radius={6} />
              <small>{nameOf(id)}</small>
            </button>
          ))}
        </div>
      )}
      <div className="search-strip">
        <SearchField
          placeholder="搜索"
          aria-label="搜索"
          value={query}
          disabled={pending}
          onClear={() => setQuery('')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {full && <p className="hint page-note">群里最多 {GROUP_MEMBER_LIMIT} 个角色</p>}
      {error && (
        <p role="alert" className="notice-bar">
          {error}
        </p>
      )}
      {!state.initialized && (
        <p className="page-note" role="status">
          正在读取通讯录…
        </p>
      )}
      {state.initialized && contacts.length === 0 && (
        <EmptyState icon="wechat/person" title="通讯录里还没有角色" />
      )}
      <MenuGroup>
        {list.map((c) => {
          const isLocked = locked.includes(c.characterId);
          const checked = isLocked || picked.includes(c.characterId);
          const disabled = pending || isLocked || (!checked && full);
          return (
            <button
              key={c.characterId}
              type="button"
              className="select-row"
              aria-pressed={checked}
              disabled={disabled}
              onClick={() =>
                setPicked((v) =>
                  checked ? v.filter((id) => id !== c.characterId) : [...v, c.characterId],
                )
              }
            >
              <CheckCircle checked={checked} disabled={isLocked} />
              <CharacterAvatar id={c.characterId} size={46} radius={6} />
              <span>{nameOf(c.characterId)}</span>
            </button>
          );
        })}
      </MenuGroup>
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
  const [avatarOpen, setAvatarOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [confirm, setConfirm] = useState<'clear' | 'dissolve' | null>(null);
  const [pending, setPending] = useState(false);
  const [switchBusy, setSwitchBusy] = useState<Record<string, boolean>>({});
  const [switchValues, setSwitchValues] = useState<Record<string, boolean>>({});
  async function toggle(key: string, value: boolean, operation: () => Promise<unknown>) {
    const had = Object.hasOwn(switchValues, key);
    const before = switchValues[key];
    setSwitchBusy((items) => ({ ...items, [key]: true }));
    setSwitchValues((items) => ({ ...items, [key]: value }));
    setError('');
    try {
      assertOwner();
      await operation();
    } catch (e) {
      setSwitchValues((items) => {
        const next = { ...items };
        if (had) next[key] = before!;
        else delete next[key];
        return next;
      });
      setError(groupError(e));
    } finally {
      setSwitchBusy((items) => ({ ...items, [key]: false }));
    }
  }
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!conversation || conversation.type !== 'group')
    return (
      <main>
        <NavBar title="聊天信息" fallback="/chat" />
        {state.initialized ? (
          <p className="empty">这个群聊已解散</p>
        ) : (
          <SyncPendingState icon="wechat/chat" label="正在读取群聊…" />
        )}
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
      if (done) setMessage(done);
      after?.();
    } catch (e) {
      setError(groupError(e));
    } finally {
      setPending(false);
    }
  }
  async function updateAvatar(mediaId: string | null) {
    assertOwner();
    await api.call(ChatGroupEndpoints.updateAvatar, {
      params: { conversationId },
      body: { mediaId },
    });
    await synchronize();
    setMessage(mediaId ? '已设置群头像' : '已恢复成员拼图');
  }
  async function restoreAvatar() {
    try {
      await updateAvatar(null);
    } catch (e) {
      showToast(groupError(e), 2500, 'error');
    }
  }
  return (
    <main className="chat-info-page">
      <NavBar title={`聊天信息 (${members.length + 1})`} fallback={`/chat/${conversationId}`} />
      <div className="member-panel">
        {members.map((m) => (
          <div key={m.participantId} className="member-cell">
            {removing && members.length > 1 && (
              <button
                className="member-remove"
                aria-label={`移出${nameOf(m.refId)}`}
                disabled={pending}
                onClick={() =>
                  // U2：移出成员可撤销——不再确认，底部撤销条「撤销」用拉人进群接口把 TA 加回来
                  void change(
                    () =>
                      api.call(ChatGroupEndpoints.removeMember, {
                        params: { conversationId, characterId: m.refId },
                      }),
                    '',
                    () =>
                      showSnackbar({
                        text: `已将 ${nameOf(m.refId)} 移出群聊`,
                        onAction: () =>
                          change(
                            () =>
                              api.call(ChatGroupEndpoints.addMembers, {
                                params: { conversationId },
                                body: { characterIds: [m.refId] },
                              }),
                            `已把 ${nameOf(m.refId)} 加回群聊`,
                          ),
                      }),
                  )
                }
              >
                −
              </button>
            )}
            <Link to={`/characters/${m.refId}`}>
              <CharacterAvatar id={m.refId} size={46} radius={6} />
            </Link>
            <small>{nameOf(m.refId)}</small>
          </div>
        ))}
        {!removing && (
          <Link
            className="member-cell"
            aria-label="添加成员"
            to={`/groups/new?add=${conversationId}`}
            aria-disabled={members.length >= GROUP_MEMBER_LIMIT}
            onClick={(e) => {
              if (members.length >= GROUP_MEMBER_LIMIT) e.preventDefault();
            }}
          >
            <span className="member-action">
              <OldIcon name="wechat/add" size={26} />
            </span>
            <small>添加</small>
          </Link>
        )}
        <button
          type="button"
          className="member-cell"
          aria-label={removing ? '完成' : '移出成员'}
          disabled={!removing && members.length <= 1}
          onClick={() => setRemoving((v) => !v)}
        >
          <span className="member-action">{removing ? '✓' : '−'}</span>
          <small>{removing ? '完成' : '移出'}</small>
        </button>
      </div>
      {members.length <= 1 && (
        <p className="hint page-note">群里至少要有 1 个角色，不想要这个群可以「删除并退出」</p>
      )}
      <MenuGroup>
        <MenuRow
          label="群头像"
          onClick={() => setAvatarOpen(true)}
          right={
            <GroupAvatar
              ids={members.map((m) => m.refId)}
              mediaId={conversation.group?.avatarMediaId}
              size={40}
            />
          }
        />
        <MenuRow
          label="群聊名称"
          value={conversation.title ?? '未命名'}
          onClick={() => {
            setTitle(conversation.group?.titleCustomized ? (conversation.title ?? '') : '');
            setRenaming(true);
          }}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow to={`/chat/${conversationId}/search`} label="查找聊天记录" />
      </MenuGroup>
      <MenuGroup>
        <SwitchRow
          label="消息免打扰"
          checked={switchValues.muted ?? conversation.state.muted}
          disabled={!!switchBusy.muted}
          onChange={(muted) =>
            void toggle('muted', muted, () =>
              api.call(ChatEndpoints.updateState, { params: { conversationId }, body: { muted } }),
            )
          }
        />
        <SwitchRow
          label="置顶聊天"
          checked={switchValues.pinned ?? conversation.state.pinned}
          disabled={!!switchBusy.pinned}
          onChange={(pinned) =>
            void toggle('pinned', pinned, () =>
              api.call(ChatEndpoints.updateState, {
                params: { conversationId },
                body: { pinned },
              }),
            )
          }
        />
      </MenuGroup>
      {companion.data && (
        <MenuGroup>
          <SwitchRow
            label="角色自主聊天"
            subtitle="开启后，你不在时群里的角色也会偶尔聊几句"
            checked={switchValues.selfChatEnabled ?? companion.data.selfChatEnabled}
            disabled={!!switchBusy.selfChatEnabled}
            onChange={(selfChatEnabled) =>
              void toggle('selfChatEnabled', selfChatEnabled, () =>
                api.call(GroupCompanionEndpoints.updateSettings, {
                  params: { conversationId },
                  body: { selfChatEnabled },
                }),
              )
            }
          />
          <SwitchRow
            label="秒回"
            checked={switchValues.instantReply ?? companion.data.instantReply}
            disabled={!!switchBusy.instantReply}
            onChange={(instantReply) =>
              void toggle('instantReply', instantReply, () =>
                api.call(GroupCompanionEndpoints.updateSettings, {
                  params: { conversationId },
                  body: { instantReply },
                }),
              )
            }
          />
        </MenuGroup>
      )}
      {companion.error && !companion.data && <p role="alert">{companion.error}</p>}
      {message && (
        <p role="status" className="hint page-note">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="notice-bar">
          {error}
        </p>
      )}
      <MenuGroup>
        <MenuRow
          label="清空聊天记录"
          danger
          center
          chevron={false}
          disabled={pending}
          onClick={() => setConfirm('clear')}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow
          label="删除并退出"
          danger
          center
          chevron={false}
          disabled={pending}
          onClick={() => setConfirm('dissolve')}
        />
      </MenuGroup>
      {renaming && (
        <FieldPage
          title="群聊名称"
          initial={title}
          maxLength={16}
          pending={pending}
          placeholder={members.map((m) => nameOf(m.refId)).join('、')}
          onClose={() => setRenaming(false)}
          onSave={(value) =>
            void change(
              () =>
                api.call(ChatGroupEndpoints.renameGroup, {
                  params: { conversationId },
                  body: { title: value || null },
                }),
              '已保存',
              () => setRenaming(false),
            )
          }
        />
      )}
      {/* U2：群头像直接弹出 拍照 / 从相册选择 / 恢复成员拼图 的 Action Sheet，选完进全屏裁剪 */}
      {avatarOpen && (
        <AvatarEditor
          sheet
          onClose={() => setAvatarOpen(false)}
          purpose="group_avatar"
          label="群头像"
          onSaved={updateAvatar}
          onRestore={conversation.group?.avatarMediaId ? () => void restoreAvatar() : undefined}
        />
      )}
      {confirm === 'clear' && (
        <AlertDialog
          title="清空这个群的聊天记录？"
          message="清空后不能恢复。"
          confirmLabel="清空聊天记录"
          pending={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void change(() => clearHistory(conversationId), '已清空', () => setConfirm(null))
          }
        />
      )}
      {confirm === 'dissolve' && (
        <AlertDialog
          title="删除并退出群聊？"
          message="这个群会解散，聊天记录也会删除，不能恢复。"
          confirmLabel="删除并退出"
          pending={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void change(
              () => api.call(ChatGroupEndpoints.dissolveGroup, { params: { conversationId } }),
              '已退出',
              () => {
                setConfirm(null);
                navigate('/chat', { replace: true });
              },
            )
          }
        />
      )}
    </main>
  );
}
