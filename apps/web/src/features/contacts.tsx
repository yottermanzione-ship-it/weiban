import { EcologySignatureLine, MurmursRow } from './murmurs.js';
import { SearchField } from './search-field.js';
import { WebCharacterSearch } from './web-character-search.js';
/*
 * 通讯录（规格 4.6）、发现（4.8）、角色广场（5.2）、角色资料页（4.12）。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CharacterEndpoints,
  ContactCardEndpoints,
  ContactsEndpoints,
  MomentsEndpoints,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useOnboardingDraft } from '../data/onboarding-draft.js';
import { AddFriendEntries } from './role-plaza.js';
import { useCharacterNames } from '../data/character-names.js';
import { useStars } from '../data/stars.js';
import { CharacterName } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { CharacterStatus } from './character-status.js';
import { ContactAvatarEditor } from './contact-avatar-editor.js';
import { FamiliarityLine } from './growth.js';
import { PersonaUpdateBadge } from './supplement.js';
import { RecentRow } from './timeline.js';
import { RelationsRow } from './relations.js';
import { useNewFriendsDot } from './new-friends.js';
import { useMomentsBadge } from './moments.js';
import { PRIVATE_MODE_CALL_HINT, useCall, useCallAccess } from './call.js';
import { PlazaOriginNote, PlazaTab } from './plaza.js';
import { MediaImg } from './media.js';
import { OldIcon } from './old-icons.js';
import { useAchievementsDot, useCardsDot } from './cards.js';
import {
  ActionSheet,
  ComingSoonRow,
  EmptyState,
  GroupHeader,
  MenuGroup,
  MenuRow,
  NavBar,
  NavIcon,
  Sheet,
} from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

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

/**
 * 分组用的角色姓名：这次打开里读到过的名字记住，切回通讯录时先用上次的名字分组。
 * 否则姓名还没读到时好友会全部落进 # 组，读完再整页重排一遍（按账号区分，容量有上限）。
 */
const rememberedNames = new Map<string, string>();
const REMEMBERED_LIMIT = 200;
let nameScope = '';
function ownNameScope(): void {
  const next = api.ownerKey();
  if (next === nameScope) return;
  nameScope = next;
  rememberedNames.clear();
}
function rememberName(characterId: string, name: string) {
  rememberedNames.delete(characterId);
  rememberedNames.set(characterId, name);
  if (rememberedNames.size <= REMEMBERED_LIMIT) return;
  const oldest = rememberedNames.keys().next();
  if (!oldest.done) rememberedNames.delete(oldest.value);
}
function stableNames(ids: string[], names: Record<string, string>): Record<string, string> {
  ownNameScope();
  const merged: Record<string, string> = {};
  for (const id of ids) {
    const live = names[id];
    if (live) rememberName(id, live);
    const name = live || rememberedNames.get(id);
    if (name) merged[id] = name;
  }
  return merged;
}

function ContactRow({
  characterId,
  remark,
  pending,
}: {
  characterId: string;
  remark: string | null;
  pending: boolean;
}) {
  return (
    <Link to={`/characters/${characterId}`} className="contact-row">
      <CharacterAvatar id={characterId} size={40} radius={4} />
      <span className="contact-name">
        <CharacterName id={characterId} fallback={remark} />
      </span>
      {pending && <small className="pending-text">等待通过</small>}
    </Link>
  );
}

const INDEX_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

/**
 * 右侧字母索引（照微信，总经理 2026-10-14 反馈）：固定在右侧、在标题栏与标签栏之间垂直居中；
 * 始终列出 ↑ ☆ A–Z #（字号 10、每格 16 高）；按住上下滑动逐个定位，左侧弹出放大字母气泡，当前字母绿底白字。
 * 没有对应分组的字母定位到后面最近的分组（再没有就前面最近的）。
 */
function LetterIndex({
  starred,
  present,
  onJump,
}: {
  starred: boolean;
  present: string[];
  onJump(letter: string): void;
}) {
  const letters = ['↑', ...(starred ? ['☆'] : []), ...INDEX_LETTERS];
  const column = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ letter: string; index: number } | null>(null);
  const last = useRef('');
  const hideTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const resolve = (letter: string) => {
    if (letter === '↑' || present.includes(letter)) return letter;
    const order = letters.slice(1);
    const at = order.indexOf(letter);
    return (
      order.slice(at + 1).find((l) => present.includes(l)) ??
      order
        .slice(0, at)
        .reverse()
        .find((l) => present.includes(l))
    );
  };
  const pick = (clientY: number) => {
    const el = column.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const index = Math.max(
      0,
      Math.min(
        letters.length - 1,
        Math.floor(((clientY - rect.top) / rect.height) * letters.length),
      ),
    );
    const letter = letters[index]!;
    window.clearTimeout(hideTimer.current);
    setActive({ letter, index });
    if (letter === last.current) return;
    last.current = letter;
    const target = resolve(letter);
    if (target) onJump(target);
  };
  const end = () => {
    last.current = '';
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setActive(null), 250);
  };
  return (
    <div className="letter-index-rail">
      <div
        ref={column}
        className="letter-index"
        role="navigation"
        aria-label="字母索引"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pick(event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) pick(event.clientY);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {letters.map((letter) => (
          <button
            key={letter}
            type="button"
            tabIndex={-1}
            className={active?.letter === letter && letter !== '↑' ? 'on' : ''}
            aria-label={letter === '☆' ? '星标朋友' : letter === '↑' ? '回到顶部' : letter}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onJump(resolve(letter) ?? letter);
            }}
          >
            {letter === '↑' ? <OldIcon name="wechat/search" size={10} /> : letter}
          </button>
        ))}
        {active && active.letter !== '↑' && (
          <span
            className="letter-bubble"
            aria-hidden
            style={{ transform: `translateY(${active.index * 16 - 17}px)` }}
          >
            {active.letter}
          </span>
        )}
      </div>
    </div>
  );
}

export function ContactsPage() {
  const { state } = useChat();
  const newFriendsDot = useNewFriendsDot();
  const stars = useStars();
  const [query, setQuery] = useState('');
  const contactIds = state.contacts.map((contact) => contact.characterId);
  const names = stableNames(contactIds, useCharacterNames(contactIds));
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
  const starred = contacts.filter((c) => stars.isStarred(c.characterId));
  const sections: Array<[string, typeof contacts]> = [
    ...(starred.length && !query ? [['☆', starred] as [string, typeof contacts]] : []),
    ...ordered,
  ];
  const jump = (letter: string) => {
    if (letter === '↑') {
      window.scrollTo({ top: 0 });
      return;
    }
    document
      .getElementById(`letter-${letter === '☆' ? 'star' : letter}`)
      ?.scrollIntoView({ block: 'start' });
  };
  return (
    <main className="contacts-page">
      <NavBar
        title="通讯录"
        back={false}
        right={
          <>
            <NavIcon name="wechat/search" label="搜索" to="/search" />
            <NavIcon name="wechat/add_circle" label="添加朋友" to="/contacts/add" />
          </>
        }
      />
      <div className="search-strip">
        <SearchField
          aria-label="搜索通讯录"
          placeholder="搜索"
          value={query}
          onClear={() => setQuery('')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {!query && (
        <>
          <MenuGroup className="contact-fixed">
            <MenuRow
              to="/contacts/new"
              icon="wechat/person"
              tint="orange"
              tile
              label="新的朋友"
              chevron={false}
              right={
                newFriendsDot ? <span className="red-dot" aria-label="有新的朋友" /> : undefined
              }
            />
            <ComingSoonRow id="chatOnly" iconSize={40} chevron={false} />
            <MenuRow
              to="/contacts/groups"
              icon="wechat/chat_pair"
              tint="green"
              tile
              label="群聊"
              chevron={false}
            />
            <ComingSoonRow id="official" tile chevron={false} />
            <ComingSoonRow id="services" tile chevron={false} />
          </MenuGroup>
          <h2 className="group-header letter-header static">
            <span>我的企业</span>
          </h2>
          <MenuGroup className="contact-fixed">
            <ComingSoonRow id="workContacts" iconSize={40} tile chevron={false} />
          </MenuGroup>
        </>
      )}
      {sections.map(([letter, list]) => (
        <section key={letter} id={`letter-${letter === '☆' ? 'star' : letter}`}>
          <h2 className="group-header letter-header">
            <span>{letter === '☆' ? '星标朋友' : letter}</span>
          </h2>
          <div className="contact-group">
            {list.map((contact) => (
              <ContactRow
                key={contact.characterId}
                characterId={contact.characterId}
                remark={contact.remark}
                pending={contact.status === 'pending'}
              />
            ))}
          </div>
        </section>
      ))}
      {state.initialized && state.contacts.length === 0 && (
        <EmptyState icon="wechat/person" title="还没有添加角色" desc="去角色广场挑一位 TA 吧" />
      )}
      {contacts.length > 0 && <p className="contacts-count">{contacts.length} 个朋友</p>}
      {sections.length > 0 && (
        <LetterIndex
          starred={sections.some(([letter]) => letter === '☆')}
          present={sections.map(([letter]) => letter)}
          onJump={jump}
        />
      )}
    </main>
  );
}

/** 发现（4.8）：朋友圈、角色广场、搜一搜、小程序；用不上的入口照常显示，点了提示「暂未开放」。 */
export function DiscoverPage() {
  const [searchParams] = useSearchParams();
  const cards = useCardsDot();
  const achievements = useAchievementsDot();
  const badge = useMomentsBadge();
  if (searchParams.get('onboarding') === '1') return <RolePlazaPage onboarding />;
  const interactions = badge?.unseenInteractionCount ?? 0;
  const latest = badge && badge.unseenPostCount > 0 ? badge.characterIds[0] : undefined;
  return (
    <main className="discover-page">
      <NavBar
        title="发现"
        back={false}
        right={<NavIcon name="wechat/search" label="搜索" to="/search" />}
      />
      <MenuGroup>
        <MenuRow
          to="/moments"
          image="wechat/discover_moments.png"
          iconSize={24}
          label="朋友圈"
          badge={
            interactions > 0 ? (
              <span className="count-badge">{interactions > 99 ? '99+' : interactions}</span>
            ) : undefined
          }
          right={
            latest ? (
              <span className="latest-avatar">
                <CharacterAvatar id={latest} size={37} radius={3} />
                <span className="red-dot" />
              </span>
            ) : undefined
          }
        />
      </MenuGroup>
      {/* 总经理 10-14 确认（Q7）：角色广场放在朋友圈下面单独一组；Q6：不要摇一摇、购物 */}
      <MenuGroup>
        <MenuRow to="/plaza" icon="drawn/people" tint="orange" tile label="角色广场" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="channels" />
        <ComingSoonRow id="live" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="scan" />
        <ComingSoonRow id="listen" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="topstories" />
        <MenuRow
          icon="wechat/search"
          tint="red"
          tile
          label="搜一搜"
          onClick={() => showToast('暂未开放', 2000, 'info')}
        />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="games" />
        <MenuRow
          to="/miniapps"
          icon="wechat/discover_mini_program"
          tint="purple"
          label="小程序"
          dot={cards.any || achievements.any}
        />
      </MenuGroup>
    </main>
  );
}

/**
 * 通讯录 › 添加朋友（10-14 裁定 2.3）：搜索 + 顶部「角色广场」「角色创建」两行 + 推荐角色列表；
 * 首次引导（onboarding）也用这一页的列表部分。
 */
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
        <NavBar title="先加一个你喜欢的 TA" back={false} />
        <MenuGroup>
          <MenuRow
            label="重新选择角色"
            disabled={draft.saving}
            onClick={() => void draft.choose(null)}
          />
        </MenuGroup>
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
    <main className="role-plaza">
      <NavBar
        title={onboarding ? '角色广场' : '添加朋友'}
        back={!onboarding}
        fallback="/contacts"
        subtitle={
          onboarding ? <small className="nav-subtitle">先加一个你喜欢的 TA 吧</small> : undefined
        }
      />
      {onboarding && <OnboardingExits />}
      {onboarding && draft.error && <p role="alert">{draft.error}</p>}
      <form
        className="search-strip"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
          setCursor(undefined);
          setPrevious([]);
        }}
      >
        <SearchField
          aria-label="搜索角色"
          placeholder={onboarding ? '搜索角色' : '搜索角色名'}
          value={query}
          onClear={() => {
            setQuery('');
            setSearch('');
            setCursor(undefined);
            setPrevious([]);
          }}
          maxLength={50}
          enterKeyHint="search"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (!next.trim()) {
              setSearch('');
              setCursor(undefined);
              setPrevious([]);
            }
          }}
        />
        <button type="submit" className="search-strip-submit" disabled={!query.trim()}>
          搜索
        </button>
      </form>
      {!onboarding && !search && <AddFriendEntries />}
      {!onboarding && <GroupHeader>{search ? '搜索结果' : '推荐角色'}</GroupHeader>}
      {roles.error && <p role="alert">{roles.error}</p>}
      {roles.loading && !roles.data && (
        <div className="role-loading" role="status" aria-label="正在读取角色">
          {[0, 1, 2, 3].map((n) => (
            <div className="role-skeleton" key={n}>
              <i />
              <span />
            </div>
          ))}
        </div>
      )}
      {!!roles.data?.items.length && (
        <MenuGroup>
          {roles.data?.items.map((role) =>
            onboarding ? (
              <MenuRow
                key={role.characterId}
                disabled={draft.saving}
                onClick={() => void draft.choose(role.characterId)}
                leading={<CharacterAvatar id={role.characterId} profile={role} size={40} />}
                label={role.name}
                subtitle={`${role.tagline}${role.added ? ' · 已添加' : ''}`}
              />
            ) : (
              <MenuRow
                key={role.characterId}
                to={`/characters/${role.characterId}`}
                leading={<CharacterAvatar id={role.characterId} profile={role} size={40} />}
                label={role.name}
                subtitle={`${role.tagline}${role.added ? ' · 已添加' : ''}`}
              />
            ),
          )}
        </MenuGroup>
      )}
      {!roles.loading && roles.data?.items.length === 0 && (
        <>
          <EmptyState icon="wechat/search" title="没有找到角色" />
          {search && <WebCharacterSearch key={search} query={search} />}
        </>
      )}
      {(previous.length > 0 || roles.data?.nextCursor) && (
        <div className="pager-row">
          {previous.length > 0 && (
            <button
              type="button"
              disabled={roles.loading}
              onClick={() => {
                setCursor(previous.at(-1));
                setPrevious(previous.slice(0, -1));
              }}
            >
              上一页
            </button>
          )}
          {roles.data?.nextCursor && (
            <button
              type="button"
              disabled={roles.loading}
              onClick={() => {
                setPrevious([...previous, cursor]);
                setCursor(roles.data?.nextCursor ?? undefined);
              }}
            >
              下一页
            </button>
          )}
        </div>
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
    <>
      <MenuGroup>
        <MenuRow
          label="自己创建一个角色"
          disabled={busy}
          onClick={() => void leave('/characters/custom/new')}
        />
        <MenuRow label="先随便看看" disabled={busy} onClick={() => void leave('/chat')} />
      </MenuGroup>
      <p className="hint page-note">之后也可以在「通讯录 → 添加角色」里加 TA</p>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

/** 资料页「朋友圈」行右侧缩略图（最多 4 张，49×49 圆角 2）。 */
function MomentThumbs({ characterId }: { characterId: string }) {
  const posts = useRemote(MomentsEndpoints.listCharacterPosts, {
    params: { characterId },
    query: { limit: 6 },
    networkOnly: true,
  });
  const images =
    posts.data?.items.flatMap((post) => post.images.map((image) => image.mediaId)).slice(0, 4) ??
    [];
  if (!images.length) return null;
  return (
    <span className="moment-thumbs">
      {images.map((mediaId) => (
        <MediaImg key={mediaId} mediaId={mediaId} />
      ))}
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
  const stars = useStars();
  const callAccess = useCallAccess(characterId);
  const callEntry = callAccess.visible;
  const { start: startCall } = useCall();
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
  const [restore, setRestore] = useState(false);
  const [sheet, setSheet] = useState<'avatar' | 'intro' | 'greet' | 'more' | null>(null);
  const greetInput = useRef<HTMLInputElement>(null);
  // 从角色广场点「添加到通讯录」过来（?add=1）：资料读到后直接打开打招呼弹层
  const autoAdd = !onboarding && query.get('add') === '1';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoAdd || autoOpened.current || !profile.data || !state.initialized || contact) return;
    autoOpened.current = true;
    setSheet('greet');
    window.setTimeout(() => greetInput.current?.focus(), 50);
  }, [autoAdd, profile.data, state.initialized, contact]);
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
      setSheet(null);
      showToast('已发送验证申请，等待对方通过', 2000, 'success');
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
  const active = contact?.status === 'active';
  const data = profile.data;
  const starred = stars.isStarred(characterId);
  return (
    <Content className="profile-page">
      {!onboarding && (
        <NavBar
          title="详细资料"
          fallback="/contacts"
          right={
            contact ? (
              <NavIcon name="wechat/more" label="资料设置" onClick={() => setSheet('more')} />
            ) : undefined
          }
        />
      )}
      <div className="profile-head">
        {active ? (
          // 同旧版 friend_profile_page：好友点头像换头像，只对自己生效（avatarSource: 'user'）。
          <button
            type="button"
            className="avatar-button"
            aria-label="设置头像"
            onClick={() => setSheet('avatar')}
          >
            <CharacterAvatar id={characterId} profile={data} size={64} radius={8} />
          </button>
        ) : (
          <CharacterAvatar id={characterId} profile={data} size={64} radius={8} />
        )}
        <div className="profile-head-text">
          <h2>
            <span>{contact?.remark || data?.name || '角色资料'}</span>
            <CharacterStatus
              key={characterId}
              characterId={characterId}
              enabled={!onboarding && active}
            />
            {contact && (
              <button
                type="button"
                className={`star-toggle ${starred ? 'on' : ''}`}
                aria-label={starred ? '取消星标' : '设为星标朋友'}
                aria-pressed={starred}
                onClick={() => stars.toggle(characterId)}
              >
                <OldIcon name={starred ? 'wechat/star_filled' : 'wechat/star'} size={22} />
              </button>
            )}
          </h2>
          {contact?.remark && data && <p>昵称：{data.name}</p>}
          {/* v5 角色生态：角色在生态里改过的状态 / 签名（只对自己可见）。 */}
          {!onboarding && active ? (
            <EcologySignatureLine characterId={characterId} tagline={data?.tagline} enabled />
          ) : (
            data?.tagline && <p>签名：{data.tagline}</p>
          )}
          {!onboarding && contact?.conversationId && <FamiliarityLine characterId={characterId} />}
          {!onboarding && active && <PersonaUpdateBadge characterId={characterId} />}
          {!onboarding && data?.kind === 'custom' && contact && (
            <PlazaOriginNote characterId={characterId} />
          )}
        </div>
      </div>
      {(error || profile.error) && (
        <p role="alert" className="notice-bar">
          {error || profile.error}
        </p>
      )}
      {contact && !onboarding && (
        <MenuGroup>
          <MenuRow label="设置备注和头像" to={`/characters/${characterId}/remark`} />
        </MenuGroup>
      )}
      {!onboarding && active && (
        <MenuGroup>
          <MenuRow
            to={`/characters/${characterId}/moments`}
            label="朋友圈"
            right={<MomentThumbs characterId={characterId} />}
          />
          {contact?.conversationId && <RecentRow characterId={characterId} />}
          <MenuRow to={`/characters/${characterId}/memories`} label="我们的记忆" />
          {contact?.conversationId && <MurmursRow characterId={characterId} />}
        </MenuGroup>
      )}
      <MenuGroup>
        {!onboarding && active && <MenuRow to={`/characters/${characterId}/cards`} label="卡册" />}
        <MenuRow
          label="简介"
          subtitle={data?.intro || data?.tagline || undefined}
          onClick={() => setSheet('intro')}
        />
        {!onboarding && active && data?.kind === 'custom' && (
          <RelationsRow characterId={characterId} />
        )}
      </MenuGroup>
      {contact?.conversationId ? (
        <MenuGroup className="action-rows">
          <Link className="profile-action" to={`/chat/${contact.conversationId}`}>
            <OldIcon name="wechat/chat" size={20} />
            发消息
          </Link>
          {!onboarding && callEntry && (
            <button
              type="button"
              className={callAccess.privateMode ? 'profile-action muted' : 'profile-action'}
              aria-disabled={callAccess.privateMode || undefined}
              onClick={() =>
                callAccess.privateMode
                  ? showToast(PRIVATE_MODE_CALL_HINT, 3000, 'info')
                  : startCall(characterId)
              }
            >
              <OldIcon name="wechat/voice_call" size={20} />
              语音通话
            </button>
          )}
        </MenuGroup>
      ) : contact?.status === 'pending' ? (
        <MenuGroup className="action-rows">
          <span className="profile-action pending">等待通过…</span>
        </MenuGroup>
      ) : (
        <MenuGroup className="action-rows">
          <button
            type="button"
            className="profile-action"
            disabled={pending || !data}
            onClick={() => {
              setSheet('greet');
              window.setTimeout(() => greetInput.current?.focus(), 50);
            }}
          >
            添加到通讯录
          </button>
          {referrer && (
            <button
              type="button"
              className="profile-action muted"
              disabled={pending}
              onClick={() => {
                setPending(true);
                setError('');
                void api
                  .call(ContactCardEndpoints.dismissRecommendation, { params: { characterId } })
                  .then(() => showToast('好的，不会再推荐 TA'))
                  .catch((e) => setError(friendlyError(e)))
                  .finally(() => setPending(false));
              }}
            >
              不感兴趣
            </button>
          )}
        </MenuGroup>
      )}
      {!onboarding && data && (
        <MenuGroup>
          <MenuRow to={`/support/new?targetType=character&targetId=${characterId}`} label="投诉" />
        </MenuGroup>
      )}
      {data?.showPublicSourceNotice && (
        <p className="hint page-note">本角色根据公开资料创作，不代表本人</p>
      )}
      {sheet === 'greet' && (
        <Sheet
          title="申请添加朋友"
          onClose={() => setSheet(null)}
          closeLabel="取消"
          action={
            <button
              type="button"
              className="small-primary primary"
              disabled={pending}
              onClick={() => void add()}
            >
              发送
            </button>
          }
        >
          <div className="field-sheet">
            <p className="hint">发送添加朋友申请</p>
            <input
              ref={greetInput}
              value={greeting}
              maxLength={50}
              placeholder="打个招呼吧"
              onChange={(event) => setGreeting(event.target.value)}
            />
          </div>
        </Sheet>
      )}
      {sheet === 'avatar' && contact && (
        <Sheet title="设置头像" onClose={() => setSheet(null)} closeLabel="取消">
          <ContactAvatarEditor characterId={characterId} titled={false} />
        </Sheet>
      )}
      {sheet === 'intro' && data && (
        <Sheet title="简介" onClose={() => setSheet(null)}>
          <div className="intro-sheet">
            {data.tagline && <p className="intro-tagline">{data.tagline}</p>}
            {data.intro && <p>{data.intro}</p>}
            {data.showPublicSourceNotice && <small>本角色根据公开资料创作，不代表本人</small>}
          </div>
        </Sheet>
      )}
      {sheet === 'more' && contact && (
        <ActionSheet
          onClose={() => setSheet(null)}
          items={[
            {
              label: '设置备注和头像',
              onClick: () => navigate(`/characters/${characterId}/remark`),
            },
            {
              label: starred ? '取消星标朋友' : '设为星标朋友',
              onClick: () => stars.toggle(characterId),
            },
            ...(contact.conversationId
              ? [
                  {
                    label: '聊天信息',
                    onClick: () => navigate(`/chat/${contact.conversationId}/settings`),
                  },
                ]
              : []),
          ]}
        />
      )}
      {restore && (
        <Dialog
          title="恢复好友"
          actions={[
            { label: '重新认识', onClick: () => void add('fresh') },
            { label: '恢复旧记录', primary: true, onClick: () => void add('restore') },
          ]}
        >
          <p>之前删除过这位角色，选择恢复旧记录或重新认识</p>
        </Dialog>
      )}
    </Content>
  );
}
