import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { NewFriendsEndpoints, type NewFriendItem } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useCharacterNames } from '../data/character-names.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { CharacterAvatar } from './character-avatar.js';

/*
 * 新的朋友（CHR-04、CHR-05；social-l4.md 第 4 节）。
 * 数据来自 GET /contacts/new-friends（L4 后端收尾补上），「不感兴趣」「已看过」「删除记录」都在服务器，多设备同步；
 * 收到 data.changed(new_friends) 重新拉取。
 */

function isNewFriendsChange(update: { type: string; data?: unknown }) {
  return (
    update.type === 'data.changed' &&
    (update.data as { section?: string } | undefined)?.section === 'new_friends'
  );
}

/** 「新的朋友」列表（随 data.changed 刷新）。 */
export function useNewFriends() {
  const remote = useRemote(NewFriendsEndpoints.list);
  const { refresh } = remote;
  useUpdates((update) => {
    if (isNewFriendsChange(update)) refresh();
  });
  return remote;
}

/** 通讯录「新的朋友」行与底部标签的红点：服务器给的未看过名片推荐数。 */
export function useNewFriendsDot(): boolean {
  const { data } = useNewFriends();
  return (data?.unseenCount ?? 0) > 0;
}

const statusText: Record<string, string | null> = {
  can_add: null,
  pending: '等待中',
  added: '已添加',
  dismissed: '已忽略',
};

export function NewFriendsPage() {
  const navigate = useNavigate();
  const { state } = useChat();
  const remote = useNewFriends();
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api.call(NewFriendsEndpoints.markSeen).catch(() => {});
  }, []);
  const items = (remote.data?.items ?? []).filter((item) => !removed.includes(item.itemId));
  const names = useCharacterNames(
    items.flatMap((item) =>
      item.recommenderCharacterId
        ? [item.characterId, item.recommenderCharacterId]
        : [item.characterId],
    ),
  );
  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
  const recent = Date.now() - 3 * 86400000;
  const groups: Array<[string, NewFriendItem[]]> = [
    ['近三天', items.filter((r) => new Date(r.createdAt).getTime() >= recent)],
    ['更早', items.filter((r) => new Date(r.createdAt).getTime() < recent)],
  ];
  function remove(item: NewFriendItem) {
    setRemoved((list) => [...list, item.itemId]);
    void api.call(NewFriendsEndpoints.remove, { params: { itemId: item.itemId } }).catch((e) => {
      setRemoved((list) => list.filter((id) => id !== item.itemId));
      setError(friendlyError(e));
    });
  }
  return (
    <main>
      <Link to="/contacts">‹ 通讯录</Link>
      <h1 className="page-title">新的朋友</h1>
      <Link className="panel row-link" to="/discover">
        <MagnifyingGlass size={18} aria-hidden /> 搜索角色
      </Link>
      {error && <p role="alert">{error}</p>}
      {remote.loading && !remote.data && (
        <p role="status" className="empty">
          正在读取…
        </p>
      )}
      {remote.error && !remote.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={remote.refresh}>重试</button>
        </div>
      )}
      {remote.data && items.length === 0 && (
        <div className="empty">
          <p>还没有新朋友</p>
          <p className="hint">TA 的朋友们会通过名片介绍给你</p>
        </div>
      )}
      {groups.map(
        ([label, list]) =>
          list.length > 0 && (
            <section key={label}>
              <h2 className="group-label">{label}</h2>
              <div className="panel rows">
                {list.map((item) => {
                  const status = statusText[item.status] ?? null;
                  const ref = item.recommenderCharacterId;
                  const to = `/characters/${item.characterId}${ref ? `?ref=${ref}` : ''}`;
                  return (
                    <div key={item.itemId} className="friend-row">
                      <Link to={to} className="role-row grow-link">
                        <CharacterAvatar id={item.characterId} size={48} />
                        <span className="conversation-copy">
                          <span>{nameOf(item.characterId)}</span>
                          <small>
                            {item.kind === 'card_recommendation' && ref
                              ? `${nameOf(ref)} 推荐`
                              : '来自 角色广场'}
                          </small>
                        </span>
                      </Link>
                      {status ? (
                        <small>{status}</small>
                      ) : (
                        <button className="primary" onClick={() => navigate(to)}>
                          添加
                        </button>
                      )}
                      <button
                        className="text-button"
                        aria-label="删除这条记录"
                        onClick={() => remove(item)}
                      >
                        删除
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ),
      )}
    </main>
  );
}
