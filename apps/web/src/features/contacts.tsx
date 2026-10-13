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
import { useCharacterNames } from '../data/character-names.js';
import { useStars } from '../data/stars.js';
import { CharacterName } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { ContactAvatarEditor } from './contact-avatar-editor.js';
import { FamiliarityLine } from './growth.js';
import { PersonaUpdateBadge } from './supplement.js';
import { RecentRow } from './timeline.js';
import { RelationsRow } from './relations.js';
import { useNewFriendsDot } from './new-friends.js';
import { useMomentsBadge } from './moments.js';
import { useCall, useCallEntry } from './call.js';
import { PlazaOriginNote, PlazaTab } from './plaza.js';
import { MediaImg } from './media.js';
import { OldIcon } from './old-icons.js';
import { useAchievementsDot, useCardsDot } from './cards.js';
import { FieldSheet } from './chat-settings.js';
import {
  ActionSheet,
  ComingSoonRow,
  EmptyState,
  IconTile,
  LongPressMenu,
  MenuGroup,
  MenuRow,
  NavBar,
  NavIcon,
  Sheet,
  useLongPress,
  type ActionItem,
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

/** 新建角色的方式（4.6：ActionSheet 变体，每项 72 高 + 40 彩色方块）。 */
export function NewCharacterSheet({ onClose }: { onClose(): void }) {
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <div className="sheet-scrim action-scrim" onClick={onClose}>
      <div className="action-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
        <div className="action-group choice-rows">
          <button type="button" className="choice-row" onClick={() => go('/characters/custom/new')}>
            <IconTile icon="wechat/note" tint="green" size="md" />
            <span>
              <strong>自己写一个 TA</strong>
              <small>填名字、性格、说话方式</small>
            </span>
          </button>
          <button type="button" className="choice-row" onClick={() => go('/imports')}>
            <IconTile icon="wechat/chat" tint="orange" size="md" />
            <span>
              <strong>从聊天记录生成 TA</strong>
              <small>粘贴、上传文件或截图</small>
            </span>
          </button>
          <button type="button" className="choice-row" onClick={() => go('/plaza')}>
            <IconTile icon="wechat/person" tint="blue" size="md" />
            <span>
              <strong>去人设广场挑一个</strong>
              <small>看看大家创作的角色</small>
            </span>
          </button>
        </div>
        <div className="action-group">
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  characterId,
  remark,
  pending,
  onMenu,
}: {
  characterId: string;
  remark: string | null;
  pending: boolean;
  onMenu(at: { x: number; y: number }): void;
}) {
  const press = useLongPress(onMenu);
  return (
    <Link to={`/characters/${characterId}`} className="contact-row" {...press}>
      <CharacterAvatar id={characterId} size={40} radius={4} />
      <span className="contact-name">
        <CharacterName id={characterId} fallback={remark} />
      </span>
      {pending && <small className="pending-text">等待通过</small>}
    </Link>
  );
}

export function ContactsPage() {
  const { state, synchronize } = useChat();
  const navigate = useNavigate();
  const newFriendsDot = useNewFriendsDot();
  const stars = useStars();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [remarking, setRemarking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
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
  const starred = contacts.filter((c) => stars.isStarred(c.characterId));
  const sections: Array<[string, typeof contacts]> = [
    ...(starred.length && !query ? [['☆', starred] as [string, typeof contacts]] : []),
    ...ordered,
  ];
  const jump = (letter: string) =>
    document
      .getElementById(`letter-${letter === '☆' ? 'star' : letter}`)
      ?.scrollIntoView({ block: 'start' });
  const menuItems = (id: string): ActionItem[] => {
    const contact = state.contacts.find((c) => c.characterId === id);
    return [
      ...(contact?.conversationId
        ? [{ label: '发消息', onClick: () => navigate(`/chat/${contact.conversationId}`) }]
        : []),
      { label: '设置备注', onClick: () => setRemarking(id) },
      { label: '删除', danger: true, onClick: () => setRemoving(id) },
    ];
  };
  const remarkContact = state.contacts.find((c) => c.characterId === remarking);
  return (
    <main className="contacts-page">
      <NavBar
        title="通讯录"
        back={false}
        right={
          <>
            <NavIcon name="wechat/search" label="搜索" to="/search" />
            <NavIcon name="wechat/add_circle" label="添加角色" to="/discover/plaza" />
          </>
        }
      />
      <div className="search-strip">
        <label className="search-entry">
          <OldIcon name="wechat/search" size={17} />
          <input
            aria-label="搜索通讯录"
            placeholder="搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {!query && (
        <MenuGroup className="contact-fixed">
          <MenuRow
            to="/contacts/new"
            icon="wechat/person"
            tint="orange"
            tile
            label="新的朋友"
            chevron={false}
            right={newFriendsDot ? <span className="red-dot" aria-label="有新的朋友" /> : undefined}
          />
          <MenuRow
            onClick={() => setCreating(true)}
            icon="wechat/add"
            tint="green"
            tile
            label="新建角色"
            chevron={false}
          />
          <MenuRow
            to="/contacts/groups"
            icon="wechat/chat_pair"
            tint="green"
            tile
            label="群聊"
            chevron={false}
          />
          <MenuRow
            to="/discover/plaza"
            icon="drawn/people"
            tint="blue"
            tile
            label="角色广场"
            chevron={false}
          />
          <ComingSoonRow id="tags" />
          <ComingSoonRow id="official" />
        </MenuGroup>
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
                onMenu={(at) => setMenu({ id: contact.characterId, at })}
              />
            ))}
          </div>
        </section>
      ))}
      {state.initialized && state.contacts.length === 0 && (
        <EmptyState icon="wechat/person" title="还没有添加角色" desc="去角色广场挑一位 TA 吧" />
      )}
      {contacts.length > 0 && <p className="contacts-count">{contacts.length} 个角色</p>}
      {sections.length > 0 && (
        <nav
          className="letter-index"
          aria-label="字母索引"
          onPointerMove={(event) => {
            if (event.buttons === 0 && event.pointerType === 'mouse') return;
            const el = document.elementFromPoint(event.clientX, event.clientY);
            const letter = (el as HTMLElement | null)?.dataset?.letter;
            if (letter) jump(letter);
          }}
        >
          {sections.map(([letter]) => (
            <button
              key={letter}
              type="button"
              data-letter={letter}
              onClick={() => jump(letter)}
              aria-label={letter === '☆' ? '星标朋友' : letter}
            >
              {letter}
            </button>
          ))}
        </nav>
      )}
      {creating && <NewCharacterSheet onClose={() => setCreating(false)} />}
      {menu && (
        <LongPressMenu at={menu.at} items={menuItems(menu.id)} onClose={() => setMenu(null)} />
      )}
      {remarking && (
        <FieldSheet
          title="设置备注"
          initial={remarkContact?.remark ?? ''}
          maxLength={20}
          onClose={() => setRemarking(null)}
          onSave={(value) => {
            const id = remarking;
            setRemarking(null);
            void api
              .call(ContactsEndpoints.update, {
                params: { characterId: id },
                body: { remark: value || null },
              })
              .then(() => synchronize())
              .then(() => showToast('已保存', 2000, 'success'))
              .catch((e) => showToast(friendlyError(e)));
          }}
        />
      )}
      {removing && (
        <Dialog
          actions={[
            { label: '取消', onClick: () => setRemoving(null) },
            {
              label: '删除',
              danger: true,
              onClick: () => {
                const id = removing;
                setRemoving(null);
                void api
                  .call(ContactsEndpoints.remove, {
                    params: { characterId: id },
                    query: { mode: 'soft' },
                  })
                  .then(() => synchronize())
                  .catch((e) => showToast(friendlyError(e)));
              },
            },
          ]}
        >
          <p>删除后角色和聊天将从列表移除，30 天内重新添加可恢复</p>
        </Dialog>
      )}
    </main>
  );
}

/** 发现（4.8）：朋友圈、角色广场、搜一搜、小程序；参照产品有、微伴暂不做的入口标「暂未开放」。 */
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
      <MenuGroup>
        <MenuRow to="/discover/plaza" icon="drawn/people" tint="orange" label="角色广场" />
        <ComingSoonRow id="live" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="scan" />
        <ComingSoonRow id="shake" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="topstories" />
        <MenuRow to="/search" icon="wechat/discover_search.png" tint="red" label="搜一搜" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="channels" />
        <ComingSoonRow id="listen" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="shop" />
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
        title="角色广场"
        back={!onboarding}
        fallback="/discover"
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
          setSearch(query);
          setCursor(undefined);
          setPrevious([]);
        }}
      >
        <label className="search-entry">
          <OldIcon name="wechat/search" size={17} />
          <input
            aria-label="搜索角色"
            placeholder="搜索角色"
            value={query}
            maxLength={50}
            enterKeyHint="search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </form>
      {roles.error && <p role="alert">{roles.error}</p>}
      {roles.loading && (
        <p role="status" className="empty">
          正在读取角色…
        </p>
      )}
      <MenuGroup>
        {roles.data?.items.map((role) =>
          onboarding ? (
            <MenuRow
              key={role.characterId}
              disabled={draft.saving}
              onClick={() => void draft.choose(role.characterId)}
              label={
                <>
                  <CharacterAvatar id={role.characterId} profile={role} size={40} />
                  <span className="row-name">{role.name}</span>
                </>
              }
              subtitle={`${role.tagline}${role.added ? ' · 已添加' : ''}`}
            />
          ) : (
            <MenuRow
              key={role.characterId}
              to={`/characters/${role.characterId}`}
              label={
                <>
                  <CharacterAvatar id={role.characterId} profile={role} size={40} />
                  <span className="row-name">{role.name}</span>
                </>
              }
              subtitle={`${role.tagline}${role.added ? ' · 已添加' : ''}`}
            />
          ),
        )}
      </MenuGroup>
      {!roles.loading && roles.data?.items.length === 0 && (
        <EmptyState icon="wechat/search" title="没有找到角色" />
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
      {!onboarding && (
        <MenuGroup>
          <MenuRow to="/plaza" icon="drawn/people" tint="blue" label="看看大家创作的角色" />
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
  const callEntry = useCallEntry(characterId);
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
  const [sheet, setSheet] = useState<
    'remark' | 'intro' | 'greet' | 'more' | 'relationship' | null
  >(null);
  const greetInput = useRef<HTMLInputElement>(null);
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
      showToast('已发送好友申请', 2000, 'success');
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
  const saveContact = (body: { remark?: string | null; relationship?: string }) => {
    setPending(true);
    void api
      .call(ContactsEndpoints.update, {
        params: { characterId },
        body: {
          remark: body.remark !== undefined ? body.remark : (contact?.remark ?? null),
          addressAs: contact?.addressAs ?? null,
          relationship: body.relationship ?? contact?.relationship ?? '朋友',
        },
      })
      .then(() => synchronize())
      .then(() => {
        setSheet(null);
        showToast('已保存', 2000, 'success');
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setPending(false));
  };
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
        <CharacterAvatar id={characterId} profile={data} size={64} radius={8} />
        <div className="profile-head-text">
          <h2>
            <span>{contact?.remark || data?.name || '角色资料'}</span>
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
          {data?.tagline && <p>签名：{data.tagline}</p>}
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
          <MenuRow label="设置备注和头像" onClick={() => setSheet('remark')} />
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
          <MenuRow to={`/characters/${characterId}/memories`} label="TA 记得的事" />
        </MenuGroup>
      )}
      <MenuGroup>
        {!onboarding && active && <MenuRow to={`/characters/${characterId}/cards`} label="卡册" />}
        {!onboarding && active && (
          <MenuRow
            label="关系类型"
            value={contact?.relationship || '朋友'}
            onClick={() => setSheet('relationship')}
          />
        )}
        <MenuRow
          label="简介与作品"
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
            <button type="button" className="profile-action" onClick={() => startCall(characterId)}>
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
      {sheet === 'remark' && contact && (
        <RemarkSheet
          characterId={characterId}
          initial={contact.remark ?? ''}
          pending={pending}
          onClose={() => setSheet(null)}
          onSave={(remark) => saveContact({ remark: remark || null })}
        />
      )}
      {sheet === 'relationship' && (
        <FieldSheet
          title="关系类型"
          initial={contact?.relationship ?? '朋友'}
          maxLength={30}
          required
          pending={pending}
          onClose={() => setSheet(null)}
          onSave={(relationship) => saveContact({ relationship: relationship || '朋友' })}
        />
      )}
      {sheet === 'intro' && data && (
        <Sheet title="简介与作品" onClose={() => setSheet(null)}>
          <div className="intro-sheet">
            {data.tagline && <p className="intro-tagline">{data.tagline}</p>}
            {data.intro && <p>{data.intro}</p>}
            {data.tags.length > 0 && <p className="hint">{data.tags.join(' · ')}</p>}
            {data.showPublicSourceNotice && <small>本角色根据公开资料创作，不代表本人</small>}
          </div>
        </Sheet>
      )}
      {sheet === 'more' && contact && (
        <ActionSheet
          onClose={() => setSheet(null)}
          items={[
            { label: '设置备注和头像', onClick: () => setSheet('remark') },
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

function RemarkSheet({
  characterId,
  initial,
  pending,
  onClose,
  onSave,
}: {
  characterId: string;
  initial: string;
  pending: boolean;
  onClose(): void;
  onSave(value: string): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Sheet
      title="设置备注和头像"
      onClose={onClose}
      closeLabel="取消"
      action={
        <button
          type="button"
          className="small-primary primary"
          disabled={pending}
          onClick={() => onSave(value.trim())}
        >
          完成
        </button>
      }
    >
      <div className="field-sheet">
        <p className="hint">备注名</p>
        <input
          value={value}
          maxLength={20}
          placeholder="添加备注名"
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <ContactAvatarEditor characterId={characterId} />
    </Sheet>
  );
}
