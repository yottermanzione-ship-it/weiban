import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CharacterEndpoints, ContactCardEndpoints, ContactsEndpoints } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useOnboardingDraft } from '../data/onboarding-draft.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterName } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { ContactAvatarEditor } from './contact-avatar-editor.js';
import { FamiliarityLine } from './growth.js';
import { RecentRow } from './timeline.js';
import { RelationsRow } from './relations.js';
import { useNewFriendsDot } from './new-friends.js';
import { useMomentsBadge } from './moments.js';
import { ProfileCallButton } from './call.js';
export function ContactsPage() {
  const { state } = useChat();
  const newFriendsDot = useNewFriendsDot();
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
      <div className="panel rows">
        <Link to="/contacts/new">
          新的朋友
          {newFriendsDot && <span className="red-dot" aria-label="有新的名片推荐" />}
        </Link>
        <Link to="/contacts/groups">群聊</Link>
        <Link to="/discover">添加角色</Link>
      </div>
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
  const draft = useOnboardingDraft(onboarding);
  const selected = draft.draft?.characterId;
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const roles = useRemote(CharacterEndpoints.searchPlaza, {
    query: { q: search || undefined, cursor, limit: 50 },
  });
  if (onboarding && !draft.ready)
    return (
      <main>
        {draft.error ? <p role="alert">{draft.error}</p> : <p role="status">正在恢复引导…</p>}
        {draft.error && <button onClick={draft.retry}>重试</button>}
      </main>
    );
  if (onboarding && selected)
    return (
      <main>
        <p className="panel" role="note">
          先加一个你喜欢的 TA 吧
        </p>
        <button disabled={draft.saving} onClick={() => void draft.choose(null)}>
          重新选择角色
        </button>
        {draft.error && <p role="alert">{draft.error}</p>}
        <CharacterPage
          key={selected}
          id={selected}
          onboarding
          draftGreeting={draft.draft?.greeting}
          onGreetingChange={draft.greet}
        />
      </main>
    );
  return (
    <main>
      {!onboarding && (
        <Link className="panel row-link" to="/moments">
          <span>朋友圈</span>
          <MomentsBadgeAvatars />
        </Link>
      )}
      <h1 className="page-title">角色广场</h1>
      {onboarding && (
        <p className="panel" role="note">
          先加一个你喜欢的 TA 吧
        </p>
      )}
      {onboarding && draft.error && <p role="alert">{draft.error}</p>}
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
              disabled={draft.saving}
              onClick={() => void draft.choose(role.characterId)}
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
function MomentsBadgeAvatars() {
  const badge = useMomentsBadge();
  if (!badge || badge.unseenPostCount === 0) return null;
  return (
    <span className="badge-avatars" aria-label={`${badge.unseenPostCount} 条新动态`}>
      {badge.characterIds.map((id) => (
        <CharacterAvatar key={id} id={id} size={24} />
      ))}
      <span className="red-dot" />
    </span>
  );
}
export function CharacterPage({
  id,
  onboarding = false,
  draftGreeting,
  onGreetingChange,
}: {
  id?: string;
  onboarding?: boolean;
  draftGreeting?: string;
  onGreetingChange?: (greeting: string) => void;
} = {}) {
  const params = useParams();
  const characterId = id ?? params.characterId ?? '';
  const navigate = useNavigate();
  const { finishOnboarding } = useAuth();
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  const { state, assertOwner, synchronize } = useChat();
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const [query] = useSearchParams();
  const referrer = onboarding ? null : query.get('ref');
  const fromGroup = onboarding ? null : query.get('group');
  const referrerProfile = useRemote(CharacterEndpoints.getProfile, {
    params: { characterId: referrer ?? characterId },
  });
  const referrerName = referrer
    ? state.contacts.find((c) => c.characterId === referrer)?.remark || referrerProfile.data?.name
    : null;
  const [localGreeting, setLocalGreeting] = useState('');
  const [defaulted, setDefaulted] = useState(false);
  useEffect(() => {
    if (defaulted || draftGreeting !== undefined) return;
    if (referrerName) {
      setLocalGreeting(`是 ${referrerName} 推荐我来的`);
      setDefaulted(true);
    } else if (fromGroup) {
      setLocalGreeting(`我们在「${fromGroup}」群里见过`.slice(0, 50));
      setDefaulted(true);
    }
  }, [referrerName, fromGroup, defaulted, draftGreeting]);
  const greeting = draftGreeting ?? localGreeting;
  const setGreeting = onGreetingChange ?? setLocalGreeting;
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
        body: {
          characterId,
          greeting: greeting || null,
          restoreMode,
          referrerCharacterId: referrer ?? null,
        },
      });
      await synchronize();
      setRestore(false);
      setMessage('已发送好友申请，请稍等 TA 通过');
      profile.refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'restore_choice_required') setRestore(true);
      else if (e instanceof ApiFailure && e.code === 'contact_limit_reached')
        setError('通讯录已满 50 个角色，先删除一些再添加吧');
      else if (e instanceof ApiFailure && e.code === 'character_not_available')
        setError('TA 暂时不能添加');
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
          {!onboarding && contact?.conversationId && <FamiliarityLine characterId={characterId} />}
          <p>{profile.data.tagline}</p>
          <p>{profile.data.intro}</p>
          <p>{profile.data.tags.join(' · ')}</p>
          {profile.data.showPublicSourceNotice && <small>本角色根据公开资料创作，不代表本人</small>}
        </div>
      )}
      {(error || profile.error) && <p role="alert">{error || profile.error}</p>}
      {message && <p role="status">{message}</p>}
      {contact?.conversationId ? (
        <>
          <Link className="plain" to={`/chat/${contact.conversationId}`}>
            发消息
          </Link>
          {!onboarding && <ProfileCallButton characterId={characterId} />}
        </>
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
          {referrer && (
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => {
                setPending(true);
                setError('');
                void api
                  .call(ContactCardEndpoints.dismissRecommendation, { params: { characterId } })
                  .then(() => {
                    setMessage('好的，不会再推荐 TA');
                  })
                  .catch((e) => setError(friendlyError(e)))
                  .finally(() => setPending(false));
              }}
            >
              不感兴趣
            </button>
          )}
        </form>
      )}
      {!onboarding && contact?.conversationId && <RecentRow characterId={characterId} />}
      {!onboarding && contact?.status === 'active' && (
        <Link className="panel row-link" to={`/characters/${characterId}/moments`}>
          <span>朋友圈</span>
          <small>›</small>
        </Link>
      )}
      {!onboarding && contact?.status === 'active' && profile.data?.kind === 'custom' && (
        <RelationsRow characterId={characterId} />
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
