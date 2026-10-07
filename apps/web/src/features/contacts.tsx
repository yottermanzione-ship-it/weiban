import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CharacterEndpoints, ContactsEndpoints } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterName } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { ContactAvatarEditor } from './contact-avatar-editor.js';
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
          <Link
            key={contact.characterId}
            to={`/characters/${contact.characterId}`}
            className="role-row"
          >
            <CharacterAvatar id={contact.characterId} />
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
  const [searchParams] = useSearchParams();
  const onboarding = searchParams.get('onboarding') === '1';
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const roles = useRemote(CharacterEndpoints.searchPlaza, {
    query: { q: search || undefined, cursor, limit: 50 },
  });
  if (onboarding && selected)
    return (
      <main>
        <p className="panel" role="note">
          先加一个你喜欢的 TA 吧
        </p>
        <button onClick={() => setSelected(undefined)}>重新选择角色</button>
        <CharacterPage id={selected} onboarding />
      </main>
    );
  return (
    <main>
      <h1 className="page-title">角色广场</h1>
      {onboarding && (
        <p className="panel" role="note">
          先加一个你喜欢的 TA 吧
        </p>
      )}
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
        {roles.data?.items.map((role) =>
          onboarding ? (
            <button
              key={role.characterId}
              className="role-row"
              aria-label={`选择${role.name}`}
              onClick={() => setSelected(role.characterId)}
            >
              <CharacterAvatar id={role.characterId} profile={role} />
              <strong>{role.name}</strong>
              <small>
                {role.tagline}
                {role.added && ' · 已添加'}
              </small>
            </button>
          ) : (
            <Link
              key={role.characterId}
              to={`/characters/${role.characterId}`}
              className="role-row"
            >
              <CharacterAvatar id={role.characterId} profile={role} />
              <strong>{role.name}</strong>
              <small>
                {role.tagline}
                {role.added && ' · 已添加'}
              </small>
            </Link>
          ),
        )}
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
export function CharacterPage({
  id,
  onboarding = false,
}: { id?: string; onboarding?: boolean } = {}) {
  const params = useParams();
  const characterId = id ?? params.characterId ?? '';
  const navigate = useNavigate();
  const { finishOnboarding } = useAuth();
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  const { state, assertOwner, synchronize } = useChat();
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const [greeting, setGreeting] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [restore, setRestore] = useState(false);
  useEffect(() => {
    if (!onboarding || !state.initialized || !contact?.conversationId) return;
    let active = true;
    void finishOnboarding()
      .then((saved) => {
        if (active && saved) navigate(`/chat/${contact.conversationId}`, { replace: true });
      })
      .catch((error) => {
        if (active) setError(friendlyError(error));
      });
    return () => {
      active = false;
    };
  }, [onboarding, state.initialized, contact?.conversationId, navigate, finishOnboarding]);
  async function add(restoreMode?: 'restore' | 'fresh') {
    setPending(true);
    setError('');
    try {
      assertOwner();
      await api.call(ContactsEndpoints.add, {
        body: { characterId, greeting: greeting || null, restoreMode },
      });
      await synchronize();
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
  const Content = onboarding ? 'section' : 'main';
  return (
    <Content>
      <h1 className="page-title">{contact?.remark || profile.data?.name || '角色资料'}</h1>
      {profile.data && (
        <div className="panel stack">
          <CharacterAvatar id={characterId} profile={profile.data} size={64} />
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
      {contact && !onboarding && (
        <ContactAvatarEditor key={characterId} characterId={characterId} />
      )}
      {!onboarding && contact?.conversationId && (
        <Link to={`/chat/${contact.conversationId}/settings`}>设置备注和头像</Link>
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
    </Content>
  );
}
