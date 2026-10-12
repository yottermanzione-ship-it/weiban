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
import { PersonaUpdateBadge } from './supplement.js';
import { RecentRow } from './timeline.js';
import { RelationsRow } from './relations.js';
import { useNewFriendsDot } from './new-friends.js';
import { useMomentsBadge } from './moments.js';
import { ProfileCallButton } from './call.js';
import { PlazaOriginNote, PlazaTab } from './plaza.js';
import {
  Aperture,
  DownloadSimple,
  MagnifyingGlass,
  PencilSimpleLine,
  Sparkle,
  SquaresFour,
  UserPlus,
  UsersFour,
  UsersThree,
} from '@phosphor-icons/react';
import { useAchievementsDot, useCardsDot } from './cards.js';
import { ComingSoonRow, IconTile, MenuGroup, MenuRow, NavBar, Sheet } from './shell-kit.js';
/** 拼音首字母分组：用中文排序规则和每个字母的边界字比较（浏览器自带，不引第三方库）。 */
const letterBounds = '阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀'.split('');
const boundLetters = 'ABCDEFGHJKLMNOPQRSTWXYZ';
const collator = new Intl.Collator('zh-CN-u-co-pinyin');
function initialOf(name: string): string {
  const first = name.trim().charAt(0);
  if (!first) return '#';
  if (/[a-z]/i.test(first)) return first.toUpperCase();
  if (!/[一-鿿]/.test(first)) return '#';
  let letter = '#';
  for (let i = 0; i < letterBounds.length; i++) {
    if (collator.compare(first, letterBounds[i]!) >= 0) letter = boundLetters[i]!;
    else break;
  }
  return letter;
}

/** 新建角色的方式（通讯录固定行与会话列表 ⊕ 菜单共用）。 */
export function NewCharacterSheet({ onClose }: { onClose(): void }) {
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <Sheet title="新建角色" onClose={onClose} closeLabel="取消">
      <div className="choice-rows">
        <button type="button" className="choice-row" onClick={() => go('/characters/custom/new')}>
          <IconTile icon={PencilSimpleLine} tint="brand" size="lg" />
          <span>
            <strong>自己写一个 TA</strong>
            <small>填名字、性格、说话方式</small>
          </span>
        </button>
        <button type="button" className="choice-row" onClick={() => go('/imports')}>
          <IconTile icon={DownloadSimple} tint="teal" size="lg" />
          <span>
            <strong>从聊天记录生成 TA</strong>
            <small>粘贴、上传文件或截图</small>
          </span>
        </button>
        <button type="button" className="choice-row" onClick={() => go('/plaza')}>
          <IconTile icon={UsersThree} tint="blue" size="lg" />
          <span>
            <strong>去人设广场挑一个</strong>
            <small>看看大家创作的角色</small>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

export function ContactsPage() {
  const { state } = useChat();
  const newFriendsDot = useNewFriendsDot();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const names = useCharacterNames(state.contacts.map((contact) => contact.characterId));
  const label = (c: (typeof state.contacts)[number]) => c.remark || names[c.characterId] || '';
  const contacts = [...state.contacts]
    .filter((c) => !query.trim() || label(c).includes(query.trim()))
    .sort((a, b) => collator.compare(label(a), label(b)));
  const groups = new Map<string, typeof contacts>();
  for (const c of contacts) {
    const letter = initialOf(label(c));
    groups.set(letter, [...(groups.get(letter) ?? []), c]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b),
  );
  return (
    <main>
      <NavBar
        title="通讯录"
        back={false}
        right={
          <Link className="nav-bar-icon" to="/discover/plaza" aria-label="添加角色">
            <UserPlus size={24} />
          </Link>
        }
      />
      <label className="search-entry">
        <MagnifyingGlass size={16} aria-hidden />
        <input
          aria-label="搜索通讯录"
          placeholder="搜索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!query && (
        <MenuGroup>
          <MenuRow
            to="/contacts/new"
            icon={UserPlus}
            tint="orange"
            label="新的朋友"
            dot={newFriendsDot}
          />
          <MenuRow
            onClick={() => setCreating(true)}
            icon={PencilSimpleLine}
            tint="brand"
            label="新建角色"
          />
          <MenuRow to="/contacts/groups" icon={UsersFour} tint="teal" label="群聊" />
          <MenuRow to="/discover/plaza" icon={Sparkle} tint="blue" label="角色广场" />
          <ComingSoonRow id="tags" />
          <ComingSoonRow id="official" />
        </MenuGroup>
      )}
      {ordered.map(([letter, list]) => (
        <section key={letter}>
          <h2 className="letter-label">{letter}</h2>
          <div className="menu-group">
            {list.map((contact) => (
              <Link
                key={contact.characterId}
                to={`/characters/${contact.characterId}`}
                className="menu-row"
              >
                <CharacterAvatar id={contact.characterId} size={40} />
                <span className="menu-label">
                  <CharacterName id={contact.characterId} fallback={contact.remark} />
                </span>
                {contact.status === 'pending' && <small className="hint">等待通过</small>}
              </Link>
            ))}
          </div>
        </section>
      ))}
      {state.initialized && state.contacts.length === 0 && <p className="empty">还没有添加角色</p>}
      {contacts.length > 0 && <p className="contacts-count">{contacts.length} 个角色</p>}
      {creating && <NewCharacterSheet onClose={() => setCreating(false)} />}
    </main>
  );
}

/** 发现（菜单列表，docs/refactor/02a 第 3 节；参照产品有、微伴暂不做的入口显示「暂未开放」）。 */
export function DiscoverPage() {
  const [searchParams] = useSearchParams();
  const cards = useCardsDot();
  const achievements = useAchievementsDot();
  if (searchParams.get('onboarding') === '1') return <RolePlazaPage onboarding />;
  return (
    <main>
      <NavBar title="发现" back={false} />
      <MenuGroup>
        <MenuRow
          to="/moments"
          icon={Aperture}
          tint="lilac"
          label="朋友圈"
          extra={<MomentsBadgeAvatars />}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow to="/discover/plaza" icon={Sparkle} tint="blue" label="角色广场" />
        <ComingSoonRow id="channels" />
        <ComingSoonRow id="live" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="scan" />
        <ComingSoonRow id="listen" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="topstories" />
        <MenuRow to="/search" icon={MagnifyingGlass} tint="gold" label="搜一搜" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="games" />
        <MenuRow
          to="/miniapps"
          icon={SquaresFour}
          tint="brand"
          label="小程序"
          dot={cards.any || achievements.any}
        />
      </MenuGroup>
    </main>
  );
}

/** 发现 › 角色广场（预设角色）；首次引导也用这一页。人设广场是小程序，底部链接过去。 */
export function RolePlazaPage({ onboarding = false }: { onboarding?: boolean }) {
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
      {onboarding ? (
        <h1 className="page-title">角色广场</h1>
      ) : (
        <NavBar title="角色广场" fallback="/discover" />
      )}
      {onboarding && (
        <p className="panel" role="note">
          先加一个你喜欢的 TA 吧
        </p>
      )}
      {onboarding && <OnboardingExits />}
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
      {!onboarding && (
        <MenuGroup>
          <MenuRow to="/plaza" icon={UsersThree} tint="blue" label="看看大家创作的角色" />
        </MenuGroup>
      )}
    </main>
  );
}

/** 小程序「人设广场」首页（原角色广场的「人设广场」分页）。 */
export function PersonaPlazaPage() {
  return (
    <main>
      <NavBar title="人设广场" fallback="/miniapps" />
      <PlazaTab />
    </main>
  );
}

/**
 * 首次引导的两个出口（2026-10-12 总经理试用反馈）：角色广场为空或没有喜欢的角色时不能卡住。
 * 「自己创建一个角色」与「先随便看看」都先结束引导（本机标记），之后仍可从通讯录「添加角色」加 TA。
 */
function OnboardingExits() {
  const { finishOnboarding } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function leave(to: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    const done = await finishOnboarding().catch(() => false);
    setBusy(false);
    if (!done) {
      setError('暂时无法结束引导，请稍后重试');
      return;
    }
    navigate(to, { replace: true });
  }
  return (
    <div className="panel rows">
      <button disabled={busy} onClick={() => void leave('/characters/custom/new')}>
        自己创建一个角色
      </button>
      <button disabled={busy} onClick={() => void leave('/chat')}>
        先随便看看
      </button>
      <small>之后也可以在「通讯录 → 添加角色」里加 TA</small>
      {error && <p role="alert">{error}</p>}
    </div>
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
          {!onboarding && contact?.status === 'active' && (
            <PersonaUpdateBadge characterId={characterId} />
          )}
          {!onboarding && profile.data.kind === 'custom' && contact && (
            <PlazaOriginNote characterId={characterId} />
          )}
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
      {!onboarding && contact?.status === 'active' && (
        <Link className="panel row-link" to={`/characters/${characterId}/cards`}>
          <span>卡册</span>
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
