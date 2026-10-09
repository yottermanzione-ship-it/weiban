import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useAuth } from '../app/auth.js';
import { useChat } from '../app/chat.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';

/*
 * 新的朋友（CHR-04、CHR-05；social-l4.md 第 4 节）。
 * 契约没有「新的朋友」列表接口：本页由本机已同步的名片消息（contact_card）和通讯录记录拼出，
 * 「不感兴趣」与「已看过」记在本机（按账号）。
 */

function storageKey(userId: string, name: string) {
  return `weiban:${name}:${userId}`;
}
function readList(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function markDismissed(userId: string, characterId: string) {
  const key = storageKey(userId, 'dismissed-cards');
  const list = readList(key);
  try {
    if (!list.includes(characterId))
      localStorage.setItem(key, JSON.stringify([...list, characterId]));
  } catch {
    // 本机无法保存时，「已忽略」状态只在本次显示中缺失，服务器的冷却照常生效。
  }
}

interface CardRecord {
  characterId: string;
  name: string;
  recommenderCharacterId: string;
  at: string;
}
function useCards(): CardRecord[] {
  const { state } = useChat();
  const map = new Map<string, CardRecord>();
  for (const m of state.messages) {
    if (m.status !== 'normal' || m.content?.type !== 'contact_card') continue;
    const prev = map.get(m.content.characterId);
    if (!prev || prev.at < m.createdAt)
      map.set(m.content.characterId, {
        characterId: m.content.characterId,
        name: m.content.name,
        recommenderCharacterId: m.content.recommenderCharacterId,
        at: m.createdAt,
      });
  }
  return [...map.values()];
}

/** 通讯录「新的朋友」行与底部标签的红点：有比上次进入本页更新的名片推荐。 */
export function useNewFriendsDot(): boolean {
  const { session } = useAuth();
  const cards = useCards();
  const seen = (() => {
    try {
      return localStorage.getItem(storageKey(session?.user.userId ?? '', 'new-friends-seen')) ?? '';
    } catch {
      return '';
    }
  })();
  return cards.some((c) => c.at > seen);
}

export function NewFriendsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const userId = session?.user.userId ?? '';
  const { state } = useChat();
  const cards = useCards();
  const [dismissed] = useState(() => readList(storageKey(userId, 'dismissed-cards')));
  const [removed, setRemoved] = useState(() => readList(storageKey(userId, 'new-friends-removed')));
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId, 'new-friends-seen'), new Date().toISOString());
    } catch {
      // 忽略：红点下次仍会显示。
    }
  }, [userId]);
  const names = useCharacterNames([
    ...cards.flatMap((c) => [c.characterId, c.recommenderCharacterId]),
    ...state.contacts.map((c) => c.characterId),
  ]);
  const nameOf = (id: string, fallback?: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || fallback || '角色';
  type Row = {
    characterId: string;
    name: string;
    source: string;
    at: string;
    ref: string | null;
  };
  const rows: Row[] = [
    ...cards.map((c) => ({
      characterId: c.characterId,
      name: nameOf(c.characterId, c.name),
      source: `${nameOf(c.recommenderCharacterId)} 推荐`,
      at: c.at,
      ref: c.recommenderCharacterId,
    })),
    ...state.contacts
      .filter((c) => !cards.some((card) => card.characterId === c.characterId))
      .map((c) => ({
        characterId: c.characterId,
        name: nameOf(c.characterId),
        source: '来自 角色广场',
        at: c.addedAt,
        ref: null,
      })),
  ]
    .filter((r) => !removed.includes(`${r.characterId}:${r.at}`))
    .sort((a, b) => b.at.localeCompare(a.at));
  const recent = Date.now() - 3 * 86400000;
  const groups: Array<[string, Row[]]> = [
    ['近三天', rows.filter((r) => new Date(r.at).getTime() >= recent)],
    ['更早', rows.filter((r) => new Date(r.at).getTime() < recent)],
  ];
  function statusOf(row: Row) {
    const contact = state.contacts.find((c) => c.characterId === row.characterId);
    if (contact?.status === 'active') return '已添加';
    if (contact?.status === 'pending') return '等待中';
    if (dismissed.includes(row.characterId)) return '已忽略';
    return null;
  }
  return (
    <main>
      <Link to="/contacts">‹ 通讯录</Link>
      <h1 className="page-title">新的朋友</h1>
      <Link className="panel row-link" to="/discover">
        <MagnifyingGlass size={18} aria-hidden /> 搜索角色
      </Link>
      {rows.length === 0 && (
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
                {list.map((row) => {
                  const status = statusOf(row);
                  const to = `/characters/${row.characterId}${row.ref ? `?ref=${row.ref}` : ''}`;
                  return (
                    <div key={`${row.characterId}:${row.at}`} className="friend-row">
                      <Link to={to} className="role-row grow-link">
                        <CharacterAvatar id={row.characterId} size={48} />
                        <span className="conversation-copy">
                          <span>{row.name}</span>
                          <small>{row.source}</small>
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
                        onClick={() => {
                          const next = [...removed, `${row.characterId}:${row.at}`];
                          setRemoved(next);
                          try {
                            localStorage.setItem(
                              storageKey(userId, 'new-friends-removed'),
                              JSON.stringify(next),
                            );
                          } catch {
                            // 忽略
                          }
                        }}
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
