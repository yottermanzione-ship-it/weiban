import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CharacterEndpoints, ContactsEndpoints } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterName } from './chat.js';
export function ContactsPage() {
  const { state } = useChat();
  const names = useCharacterNames(state.contacts.map((contact) => contact.characterId));
  const contacts = [...state.contacts].sort((a, b) =>
    (a.remark || names[a.characterId] || '').localeCompare(
      b.remark || names[b.characterId] || '',
      'zh-CN',
    ),
  );
  return (
    <main>
      <h1 className="page-title">通讯录</h1>
      <Link className="plain" to="/discover">
        添加角色
      </Link>
      <div className="panel rows">
        {contacts.map((contact) => (
          <Link key={contact.characterId} to={`/characters/${contact.characterId}`}>
            <CharacterName id={contact.characterId} fallback={contact.remark} />
            <small>{contact.status === 'pending' ? '等待通过好友申请' : ''}</small>
          </Link>
        ))}
      </div>
      {state.initialized && state.contacts.length === 0 && <p className="empty">还没有添加角色</p>}
    </main>
  );
}
export function DiscoverPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const roles = useRemote(CharacterEndpoints.searchPlaza, {
    query: { q: search || undefined, cursor, limit: 50 },
  });
  return (
    <main>
      <h1 className="page-title">角色广场</h1>
      <form
        className="message-composer"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
          setCursor(undefined);
          setPrevious([]);
        }}
      >
        <label>
          搜索角色
          <input value={query} maxLength={50} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button>搜索</button>
      </form>
      {roles.error && <p role="alert">{roles.error}</p>}
      {roles.loading && <p role="status">正在读取角色…</p>}
      <div className="panel rows">
        {roles.data?.items.map((role) => (
          <Link key={role.characterId} to={`/characters/${role.characterId}`}>
            <strong>{role.name}</strong>
            <small>
              {role.tagline}
              {role.added && ' · 已添加'}
            </small>
          </Link>
        ))}
      </div>
      {!roles.loading && roles.data?.items.length === 0 && <p className="empty">没有找到角色</p>}
      {previous.length > 0 && (
        <button
          disabled={roles.loading}
          onClick={() => {
            setCursor(previous.at(-1));
            setPrevious(previous.slice(0, -1));
          }}
        >
          上一页角色
        </button>
      )}
      {roles.data?.nextCursor && (
        <button
          disabled={roles.loading}
          onClick={() => {
            setPrevious([...previous, cursor]);
            setCursor(roles.data?.nextCursor ?? undefined);
          }}
        >
          下一页角色
        </button>
      )}
    </main>
  );
}
export function CharacterPage() {
  const { characterId = '' } = useParams();
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  const { state } = useChat();
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const [greeting, setGreeting] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [restore, setRestore] = useState(false);
  async function add(restoreMode?: 'restore' | 'fresh') {
    setPending(true);
    setError('');
    try {
      await api.call(ContactsEndpoints.add, {
        body: { characterId, greeting: greeting || null, restoreMode },
      });
      setRestore(false);
      setMessage('已发送好友申请，请稍等 TA 通过');
      profile.refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'restore_choice_required') setRestore(true);
      else setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <h1 className="page-title">{contact?.remark || profile.data?.name || '角色资料'}</h1>
      {profile.data && (
        <div className="panel stack">
          <h2>{profile.data.name}</h2>
          <p>{profile.data.tagline}</p>
          <p>{profile.data.intro}</p>
          <p>{profile.data.tags.join(' · ')}</p>
          {profile.data.showPublicSourceNotice && <small>本角色根据公开资料创作，不代表本人</small>}
        </div>
      )}
      {(error || profile.error) && <p role="alert">{error || profile.error}</p>}
      {message && <p role="status">{message}</p>}
      {contact?.conversationId ? (
        <Link className="plain" to={`/chat/${contact.conversationId}`}>
          发消息
        </Link>
      ) : contact?.status === 'pending' ? (
        <p>等待通过好友申请</p>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label>
            打招呼
            <input
              value={greeting}
              maxLength={50}
              onChange={(event) => setGreeting(event.target.value)}
            />
          </label>
          <button className="primary" disabled={pending || !profile.data}>
            添加到通讯录
          </button>
        </form>
      )}
      {restore && (
        <div className="panel" role="dialog" aria-label="恢复好友">
          <p>之前删除过这位角色，选择恢复旧记录或重新认识</p>
          <button disabled={pending} onClick={() => void add('restore')}>
            恢复旧记录
          </button>
          <button disabled={pending} onClick={() => void add('fresh')}>
            重新认识
          </button>
        </div>
      )}
    </main>
  );
}
