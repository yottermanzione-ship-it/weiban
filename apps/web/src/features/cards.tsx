import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  BookmarkSimple,
  BowlFood,
  Cake,
  CalendarBlank,
  CalendarCheck,
  Camera,
  CaretLeft,
  CaretRight,
  Cards,
  ChatCircle,
  CookingPot,
  DeviceMobile,
  EnvelopeOpen,
  EnvelopeSimple,
  FlagBanner,
  FrameCorners,
  Gift,
  HandTap,
  Headphones,
  HourglassMedium,
  IdentificationCard,
  JarLabel,
  ListChecks,
  Microphone,
  Moon,
  Notebook,
  PawPrint,
  PenNib,
  Phone,
  PhoneIncoming,
  Question,
  Ruler,
  Sparkle,
  ThumbsUp,
  Ticket,
  UsersThree,
  Image as ImageIcon,
} from './old-icons.js';
import {
  GrowthCardEndpoints,
  type Achievement,
  type CardAlbum,
  type GrowthCard,
} from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { useSeenRecord } from '../data/seen.js';
import { CharacterAvatar } from './character-avatar.js';
import { familiarityNames } from './growth.js';
import { openShare } from './share.js';
import { showToast } from './toast.js';
import { useBack } from './shell-kit.js';

/*
 * 卡册、熟悉度总览、成就页（GRW-03、GRW-05、GRW-06；设计 cards-familiarity.md、me-and-services.md 3.1/3.2）。
 * 只奖励不催促：没有倒计时、没有百分比进度条、没有「再聊 X 条」。
 */

type IconType = ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold' }>;

/** 卡片类型 → 颜色令牌与占位图标（cards-familiarity.md 第 6 节「卡面素材占位」）。 */
export function cardStyle(kind: string): { color: string; Icon: IconType; group: string } {
  switch (kind) {
    case 'anniversary':
      return { color: 'var(--wb-color-card-memorial)', Icon: CalendarBlank, group: 'anniversary' };
    case 'familiarity':
      return { color: 'var(--wb-color-card-familiarity)', Icon: Moon, group: 'familiarity' };
    case 'holiday':
      return { color: 'var(--wb-color-card-festival)', Icon: Gift, group: 'holiday' };
    case 'pet':
      return { color: 'var(--wb-color-card-moment)', Icon: PawPrint, group: 'moment' };
    default:
      return { color: 'var(--wb-color-card-moment)', Icon: Sparkle, group: 'moment' };
  }
}

const cardGroups = [
  ['anniversary', '纪念卡', '和 TA 认识满 7 天，会收到第一张纪念卡'],
  ['familiarity', '熟悉度卡', '熟悉度升级时会收到熟悉度卡'],
  ['holiday', '节日卡', '节日当天和 TA 聊天，就会收到节日卡'],
  ['moment', '瞬间卡', '一起经历的特别时刻会变成瞬间卡'],
] as const;

function useDisplayName(ids: string[]) {
  const { state } = useChat();
  const names = useCharacterNames(ids);
  return (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';
}

function shortDate(date: string) {
  const [, m, d] = date.split('-').map(Number);
  return `${m} 月 ${d} 日`;
}

// ---------- 卡册红点（只存本机「看过的张数」） ----------

type CardSeen = Record<string, number>;

/** 卡册宫格 / 总览红点：某角色已收集张数比上次查看时多。 */
export function useCardsDot() {
  const albums = useRemote(GrowthCardEndpoints.listAlbums);
  const [seen, save] = useSeenRecord<CardSeen>('cards');
  const { refresh } = albums;
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'cards'
    )
      refresh();
  });
  const items = albums.data?.items;
  useEffect(() => {
    if (items && seen === null)
      save(Object.fromEntries(items.map((a) => [a.characterId, a.obtainedCount])));
  }, [items, seen, save]);
  const isNew = (characterId: string, count: number) =>
    seen !== null && count > (seen[characterId] ?? 0);
  return {
    albums,
    isNew,
    any: !!items?.some((a) => isNew(a.characterId, a.obtainedCount)),
    markSeen: (characterId: string, count: number) => {
      if (seen !== null && (seen[characterId] ?? 0) !== count)
        save({ ...seen, [characterId]: count });
    },
  };
}

// ---------- 卡册总览（服务 › 卡册） ----------

export function CardAlbumsPage() {
  const { albums, isNew } = useCardsDot();
  const items = albums.data?.items ?? [];
  const name = useDisplayName(items.map((a) => a.characterId));
  const sorted = [...items].sort(
    (a, b) =>
      Number(isNew(b.characterId, b.obtainedCount)) -
        Number(isNew(a.characterId, a.obtainedCount)) ||
      (b.latestObtainedOn ?? '').localeCompare(a.latestObtainedOn ?? ''),
  );
  const total = items.reduce((sum, a) => sum + a.obtainedCount, 0);
  return (
    <main>
      <h1 className="page-title">卡册</h1>
      {albums.loading && !albums.data && (
        <div className="stack" role="status" aria-label="正在读取卡册">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-line skeleton-row" />
          ))}
        </div>
      )}
      {albums.error && !albums.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={albums.refresh}>重试</button>
        </div>
      )}
      {albums.data && items.length === 0 && (
        <div className="empty">
          <p>还没有角色，去添加一个吧</p>
          <Link to="/plaza">去角色广场</Link>
        </div>
      )}
      {items.length > 0 && (
        <>
          <p className="big-count">
            共收集 <strong>{total}</strong> 张
          </p>
          <div className="panel rows">
            {sorted.map((album) => (
              <Link key={album.characterId} to={`/characters/${album.characterId}/cards`}>
                <CharacterAvatar id={album.characterId} size={40} />
                <span className="overview-name">{name(album.characterId)}</span>
                <small>{album.obtainedCount} 张</small>
                {isNew(album.characterId, album.obtainedCount) && (
                  <span className="red-dot" aria-label="有新卡片" />
                )}
                <CaretRight />
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

// ---------- 某角色的卡册 ----------

export function CardFace({ card, large = false }: { card: GrowthCard; large?: boolean }) {
  const { color, Icon } = cardStyle(card.kind);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="card-face" style={{ background: color }}>
      {(!card.face.url || failed || !loaded) && (
        <span className="card-face-icon" aria-hidden>
          <Icon size={large ? 32 : 24} />
        </span>
      )}
      {card.face.url && !failed && (
        <img
          src={card.face.url}
          alt=""
          loading="lazy"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function CardAlbumPage() {
  const { characterId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const album = useRemote(GrowthCardEndpoints.getAlbum, { params: { characterId } });
  const { refresh } = album;
  const { markSeen } = useCardsDot();
  const name = useDisplayName([characterId]);
  const back = useBack(`/characters/${characterId}`);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'cards'
    )
      refresh();
  });
  const obtained = useMemo(
    () => [...(album.data?.obtained ?? [])].sort((a, b) => a.serialNo - b.serialNo),
    [album.data],
  );
  useEffect(() => {
    if (album.data) markSeen(characterId, album.data.obtained.length);
  }, [album.data, characterId, markSeen]);
  const openId = params.get('card');
  const view = params.get('view') === 'moments' ? 'moments' : 'cards';
  const openIndex = obtained.findIndex((c) => c.cardId === openId);
  const latest = obtained.reduce<string | null>(
    (max, c) => (!max || c.obtainedOn > max ? c.obtainedOn : max),
    null,
  );
  const open = (cardId: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (cardId) next.set('card', cardId);
        else next.delete('card');
        return next;
      },
      { replace: true },
    );
  return (
    <main>
      <header className="page-header">
        <button className="text-button" aria-label="返回" onClick={back}>
          <CaretLeft size={24} />
        </button>
        <h1>和 {name(characterId)} 的卡册</h1>
        <span />
      </header>
      {album.loading && !album.data && <AlbumSkeleton />}
      {album.error && !album.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={refresh}>重试</button>
        </div>
      )}
      {album.data && obtained.length === 0 && album.data.locked.length === 0 && (
        <div className="empty">
          <p>和 TA 认识满 7 天，会收到第一张纪念卡</p>
        </div>
      )}
      {album.data && (obtained.length > 0 || album.data.locked.length > 0) && (
        <>
          <p className="big-count">
            已收集 <strong>{obtained.length}</strong> 张
            {latest && <small className="hint"> 最近获得：{shortDate(latest)}</small>}
          </p>
          <div className="plaza-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={view === 'cards'}
              onClick={() =>
                setParams(
                  (p) => {
                    const next = new URLSearchParams(p);
                    next.delete('view');
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              卡片
            </button>
            <button
              role="tab"
              aria-selected={view === 'moments'}
              onClick={() =>
                setParams(
                  (p) => {
                    const next = new URLSearchParams(p);
                    next.set('view', 'moments');
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              我们的瞬间
            </button>
          </div>
          {view === 'cards' ? (
            <AlbumGroups album={album.data} obtained={obtained} onOpen={open} />
          ) : (
            <MomentsTimeline cards={obtained} onOpen={open} />
          )}
        </>
      )}
      {openIndex >= 0 && (
        <CardDetail
          cards={obtained}
          index={openIndex}
          onIndex={(i) => open(obtained[i]?.cardId ?? null)}
          onClose={() => open(null)}
        />
      )}
    </main>
  );
}

function AlbumSkeleton() {
  return (
    <div className="stack" role="status" aria-label="正在读取卡册">
      <div className="skeleton-line" />
      {[0, 1].map((g) => (
        <div key={g} className="card-grid">
          {[0, 1, 2].map((i) => (
            <span key={i} className="card-tile skeleton-card" />
          ))}
        </div>
      ))}
    </div>
  );
}

function AlbumGroups({
  album,
  obtained,
  onOpen,
}: {
  album: CardAlbum;
  obtained: GrowthCard[];
  onOpen(cardId: string): void;
}) {
  return (
    <>
      {cardGroups.map(([group, title, emptyText]) => {
        const cards = obtained.filter((c) => cardStyle(c.kind).group === group);
        const locked =
          group === 'anniversary' || group === 'familiarity'
            ? album.locked.filter((c) => cardStyle(c.kind).group === group)
            : [];
        const { color } = cardStyle(group);
        return (
          <section key={group}>
            <h2 className="section-label">
              <span className="type-dot" style={{ background: color }} aria-hidden />
              {title}
            </h2>
            {cards.length === 0 && locked.length === 0 ? (
              <p className="hint">{emptyText}</p>
            ) : (
              <div className="card-grid">
                {cards.map((card) => (
                  <button
                    key={card.cardId}
                    className="card-tile"
                    onClick={() => onOpen(card.cardId)}
                    aria-label={`No.${String(card.serialNo).padStart(3, '0')} ${card.title}`}
                  >
                    <CardFace card={card} />
                    <span className="card-tile-title">{card.title}</span>
                  </button>
                ))}
                {locked.map((card, i) => (
                  <div key={`locked-${i}`} className="card-tile locked" aria-label="未获得">
                    <span className="card-face silhouette" aria-hidden>
                      <Cards size={24} />
                    </span>
                    <span className="card-tile-title">{card.title}</span>
                    <small>{card.condition}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

/** 卡片详情（cards-familiarity.md 3.3）：全屏遮罩、点卡片翻面、左右切换、生成分享图。 */
function CardDetail({
  cards,
  index,
  onIndex,
  onClose,
}: {
  cards: GrowthCard[];
  index: number;
  onIndex(index: number): void;
  onClose(): void;
}) {
  const navigate = useNavigate();
  const card = cards[index]!;
  const [back, setBack] = useState(false);
  const [opened, saveOpened] = useSeenRecord<string[]>('cards-opened');
  const [pop, setPop] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => {
    setBack(false);
    if (opened && !opened.includes(card.cardId)) {
      setPop(true);
      saveOpened([...opened.slice(-500), card.cardId]);
    } else if (!opened) saveOpened([card.cardId]);
  }, [card.cardId, opened, saveOpened]);
  const serial = `No.${String(card.serialNo).padStart(3, '0')}`;
  return (
    <div
      className="card-detail-scrim"
      role="dialog"
      aria-label="卡片详情"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`card-detail ${pop ? 'card-pop' : ''}`}
        onAnimationEnd={() => setPop(false)}
        onPointerDown={(e: PointerEvent) => {
          start.current = e.clientX;
        }}
        onPointerUp={(e: PointerEvent) => {
          const dx = start.current === null ? 0 : e.clientX - start.current;
          start.current = null;
          if (dx < -50 && index < cards.length - 1) onIndex(index + 1);
          else if (dx > 50 && index > 0) onIndex(index - 1);
          else setBack((b) => !b);
        }}
      >
        <div className="card-side" style={{ opacity: back ? 0 : 1 }} aria-hidden={back}>
          <CardFace card={card} large />
          <strong>{card.title}</strong>
          <p>{card.line}</p>
          <small className="hint">
            {serial} · {card.obtainedOn}
          </small>
        </div>
        <div className="card-side card-back" style={{ opacity: back ? 1 : 0 }} aria-hidden={!back}>
          <small className="hint">{serial}</small>
          <p>{card.line || card.title}</p>
          <small className="hint">获得于 {card.obtainedOn}</small>
        </div>
      </div>
      <div className="button-row">
        <button
          className="icon-button"
          aria-label="上一张"
          disabled={index === 0}
          onClick={() => onIndex(index - 1)}
        >
          <CaretLeft size={20} />
        </button>
        <button
          className="tonal"
          onClick={() => openShare(navigate, { kind: 'card', cardId: card.cardId })}
        >
          生成分享图
        </button>
        <button className="text-button" onClick={onClose}>
          关闭
        </button>
        <button
          className="icon-button"
          aria-label="下一张"
          disabled={index >= cards.length - 1}
          onClick={() => onIndex(index + 1)}
        >
          <CaretRight size={20} />
        </button>
      </div>
    </div>
  );
}

// ---------- 熟悉度总览（服务 › 熟悉度） ----------

const moons = ['◔', '◑', '◐', '◕', '●'] as const;

export function FamiliarityOverviewPage() {
  const list = useRemote(GrowthCardEndpoints.listFamiliarity);
  const items = list.data?.items ?? [];
  const name = useDisplayName(items.map((i) => i.characterId));
  return (
    <main>
      <h1 className="page-title">熟悉度</h1>
      {list.loading && !list.data && <div className="skeleton-line" role="status" />}
      {list.error && !list.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={list.refresh}>重试</button>
        </div>
      )}
      {list.data && items.length === 0 && (
        <div className="empty">
          <p>还没有角色，去添加一个吧</p>
          <Link to="/plaza">去角色广场</Link>
        </div>
      )}
      <div className="panel rows">
        {items.map((info) => {
          const progress =
            info.pointsToNextLevel === null
              ? 1
              : info.pointsInLevel / (info.pointsInLevel + info.pointsToNextLevel);
          return (
            <Link key={info.characterId} to={`/characters/${info.characterId}`}>
              <CharacterAvatar id={info.characterId} size={40} />
              <span className="overview-name">
                {name(info.characterId)}
                <small className="hint">
                  {moons[info.level - 1]} L{info.level} {familiarityNames[info.level - 1]}
                  {info.pointsToNextLevel !== null &&
                    ` · 距 L${info.level + 1} 还差 ${info.pointsToNextLevel} 点`}
                </small>
                <span className="meter" aria-hidden>
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
              </span>
              <CaretRight />
            </Link>
          );
        })}
      </div>
      {items.length > 0 && <p className="hint center">多聊天、多互动，就会越来越熟</p>}
    </main>
  );
}

// ---------- 成就 ----------

const achievementGroups = [
  ['acquaintance', '相识', 'var(--wb-color-achievement-meet)'],
  ['chat_call', '聊天与通话', 'var(--wb-color-achievement-chat)'],
  ['group_moments', '群聊与朋友圈', 'var(--wb-color-achievement-social)'],
  ['collect', '收藏与卡片', 'var(--wb-color-achievement-collect)'],
  ['anniversary', '纪念日与熟悉度', 'var(--wb-color-achievement-memorial)'],
  ['play', '互动玩法', 'var(--wb-color-achievement-play)'],
] as const;

/** 徽章插画占位（cards-familiarity.md 5.3）：按编号用 Phosphor 图标。 */
const badgeIcons: Record<number, IconType> = {
  1: EnvelopeOpen,
  2: ChatCircle,
  3: IdentificationCard,
  4: UsersThree,
  5: FlagBanner,
  6: HandTap,
  7: DeviceMobile,
  8: Notebook,
  9: ImageIcon,
  10: Microphone,
  11: Headphones,
  12: Phone,
  13: PhoneIncoming,
  14: CookingPot,
  15: Ticket,
  16: Camera,
  17: PenNib,
  18: ThumbsUp,
  19: BookmarkSimple,
  20: JarLabel,
  21: FrameCorners,
  22: Cards,
  23: BookOpen,
  24: CalendarBlank,
  25: CalendarCheck,
  26: Cake,
  27: Moon,
  28: Moon,
  29: BowlFood,
  30: Ruler,
  31: ListChecks,
  32: Question,
  33: EnvelopeSimple,
  34: HourglassMedium,
};

function useAchievementList() {
  const list = useRemote(GrowthCardEndpoints.listAchievements);
  const { refresh } = list;
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'achievements'
    )
      refresh();
  });
  return list;
}

/** 成就宫格红点：有比上次离开成就页更晚获得的成就。 */
export function useAchievementsDot() {
  const list = useAchievementList();
  const [seen, save] = useSeenRecord<string>('achievements');
  useEffect(() => {
    if (list.data && seen === null) save(new Date().toISOString());
  }, [list.data, seen, save]);
  const isNew = (a: Achievement) => !!a.unlockedAt && seen !== null && a.unlockedAt > seen;
  return {
    list,
    isNew,
    any: !!list.data?.items.some(isNew),
    markSeen: () => save(new Date().toISOString()),
  };
}

export function AchievementsPage() {
  const { list, isNew, markSeen } = useAchievementsDot();
  const [open, setOpen] = useState<Achievement | null>(null);
  const markRef = useRef(markSeen);
  useEffect(() => {
    markRef.current = markSeen;
  });
  // 离开成就页后红点消失（cards-familiarity.md 5.1）。
  useEffect(() => () => markRef.current(), []);
  const items = list.data?.items ?? [];
  const unlocked = items.filter((a) => a.unlockedAt).length;
  return (
    <main>
      <h1 className="page-title">成就</h1>
      <p className="big-count center">
        已获得{' '}
        <strong>
          {list.data ? unlocked : '—'} / {list.data ? items.length : '—'}
        </strong>
      </p>
      {list.loading && !list.data && (
        <div className="badge-grid" role="status" aria-label="正在读取成就">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="badge skeleton-badge" />
          ))}
        </div>
      )}
      {list.error && !list.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={list.refresh}>重试</button>
        </div>
      )}
      {achievementGroups.map(([group, title, color]) => {
        const groupItems = items
          .filter((a) => a.group === group)
          .sort((a, b) =>
            a.unlockedAt && b.unlockedAt
              ? a.unlockedAt.localeCompare(b.unlockedAt)
              : a.unlockedAt
                ? -1
                : b.unlockedAt
                  ? 1
                  : a.no - b.no,
          );
        if (groupItems.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="section-label">{title}</h2>
            <div className="badge-grid">
              {groupItems.map((a) => {
                const Icon = badgeIcons[a.no] ?? Sparkle;
                return (
                  <button key={a.no} className="badge-cell" onClick={() => setOpen(a)}>
                    <span
                      className={`badge ${a.unlockedAt ? '' : 'locked'}`}
                      style={a.unlockedAt ? { background: color } : undefined}
                    >
                      <Icon size={28} weight={a.no === 28 ? 'fill' : 'regular'} />
                      {isNew(a) && <span className="red-dot" aria-label="新获得" />}
                    </span>
                    <small>{a.name}</small>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {open && (
        <div
          className="dialog-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(null);
          }}
        >
          <div className="sheet-panel" role="dialog" aria-label={open.name}>
            <strong>{open.name}</strong>
            <p>{open.condition}</p>
            {open.unlockedAt ? (
              <small className="hint">
                获得于 {new Date(open.unlockedAt).toLocaleDateString('zh-CN')}
              </small>
            ) : open.progress ? (
              <small className="hint">
                {open.progress.current} / {open.progress.target}
              </small>
            ) : (
              <small className="hint">还没有获得</small>
            )}
            <button onClick={() => setOpen(null)}>知道了</button>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * 获得成就的轻提示（成就型 Toast 3 秒，最多连续 3 枚，cards-familiarity.md 第 6 节）。
 * 收到 data.changed(achievements) 后重拉，按 unlockedAt 找出新获得的（T-076 交接）。
 */
export function AchievementWatcher() {
  const { session } = useAuth();
  const known = useRef<Set<number> | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    known.current = null;
    const load = () =>
      void api
        .call(GrowthCardEndpoints.listAchievements, { networkOnly: true })
        .then((r) => {
          const now = new Set(r.items.filter((a) => a.unlockedAt).map((a) => a.no));
          if (known.current) {
            const fresh = r.items.filter((a) => a.unlockedAt && !known.current!.has(a.no));
            fresh.slice(0, 3).forEach((a, i) => {
              timers.current.push(
                window.setTimeout(() => showToast(`获得成就「${a.name}」`, 3000), i * 3000),
              );
            });
          }
          known.current = now;
        })
        .catch(() => {});
    load();
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; data?: { section?: string } }>).detail;
      if (detail?.type === 'data.changed' && detail.data?.section === 'achievements') load();
    };
    window.addEventListener('weiban:update', listener);
    const pending = timers.current;
    return () => {
      window.removeEventListener('weiban:update', listener);
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, [session?.user.userId]);
  return null;
}

/**
 * 「我们的瞬间」视图（保留旧版好交互，docs/refactor/02 第 7.2 节）：
 * 把已获得的卡片按获得日期排成一条时间线，像回看你们的「第一次……」。只用已有卡片数据。
 */
function MomentsTimeline({ cards, onOpen }: { cards: GrowthCard[]; onOpen(cardId: string): void }) {
  const list = [...cards].sort(
    (a, b) => a.obtainedOn.localeCompare(b.obtainedOn) || a.serialNo - b.serialNo,
  );
  if (list.length === 0) return <p className="empty">还没有瞬间，慢慢来</p>;
  return (
    <ol className="moments-line" aria-label="我们的瞬间">
      {list.map((card) => (
        <li key={card.cardId}>
          <time dateTime={card.obtainedOn}>{shortDate(card.obtainedOn)}</time>
          <button type="button" className="text-button" onClick={() => onOpen(card.cardId)}>
            <strong>{card.title}</strong>
          </button>
          {card.line && <small className="hint">{card.line}</small>}
        </li>
      ))}
    </ol>
  );
}
