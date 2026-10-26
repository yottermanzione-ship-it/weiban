import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SearchField } from './search-field.js';
import { WebCharacterSearch } from './web-character-search.js';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CaretLeft, ChatCircle, DotsThree, Heart, Storefront, UserList } from './old-icons.js';
import { z } from 'zod';
import {
  CharacterEndpoints,
  CharacterSupplementEndpoints,
  CustomCharacterOriginEndpoints,
  IdentityEndpoints,
  PLAZA_COMMENT_MAX_CHARS,
  PlazaEndpoints,
  UserCustomEndpoints,
  VoiceEndpoints,
  type PlazaAuthor,
  type PlazaComment,
  type PlazaNotice,
  type PlazaPublishDraft,
  type PlazaSnapshot,
  type PlazaWorkCard,
  type PlazaWorkDetail,
  type PrivacyKind,
} from '@weiban/contracts';
import {
  ApiFailure,
  avatarLetters,
  avatarPaletteIndex,
  basisWord,
  personaValue,
} from '@weiban/client-core';
import { PersonaCard, VoiceSampleButton } from './persona-card.js';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { uploadMedia, prepareImage } from '../data/upload.js';
import { CharacterAvatar } from './character-avatar.js';
import { VirtualList } from './virtual-list.js';
import { AlertDialog, Dialog, showSnackbar, showToast } from './toast.js';
import { ActionSheet, Sheet } from './shell-kit.js';

/*
 * 人设广场（PLZ-01～PLZ-07；设计 persona-plaza.md；契约 PlazaEndpoints）。
 * 规则：没有私信、关注入口（PLZ-03 第 6 条）；红点不推送；「添加为我的角色」服务器已自动加进通讯录（T-088），
 * 客户端不再调用 POST /contacts。分类、遮盖、永不发布由服务器保证，界面只说明。
 */

type Notice = z.infer<typeof PlazaNotice>;
type Badge = z.output<(typeof PlazaEndpoints.getBadge)['response']>;
type MyProfile = z.output<(typeof PlazaEndpoints.getMyProfile)['response']>;

const basisNames: Record<string, string> = {
  original: '原创',
  fictional: '虚构',
  real_person: '真人',
};
const realKindNames: Record<string, string> = {
  celebrity: '公众人物',
  historical: '历史人物',
  private_person: '身边真人',
};
const reasonNames = {
  rights: '侵犯他人权益（肖像、隐私、版权）',
  hard_boundary: '违反底线规则（例如儿童角色被标成成年、真人角色被标成原创）',
  inappropriate: '不适宜的内容',
  other: '其他',
} as const;
const privacyNames: Record<string, string> = {
  phone: '手机号',
  id_number: '证件号',
  bank_card: '银行卡号',
  email: '邮箱',
  address: '地址',
  account: '账号',
  plate: '车牌',
  my_profile: '我的资料',
  about_me: '关于我',
  my_nickname: '我的昵称',
  my_memory: '记忆中的信息',
  third_party_name: '他人姓名',
  private_event: '私人经历',
  other_private: '私人信息',
};
/** PLZ-02 第 4 条：永不发布的内容（原文分条）。 */
const neverPublished = [
  '聊天记录',
  '记忆（关于我的事、共同经历、约定）',
  '我的资料、「关于我」、专属称呼',
  '好感度、认识天数、纪念日、卡片、成就',
  '情景模式、人设贴合度、秒回等聊天设置',
  '导入时的原始聊天记录和截图',
  '经期日记等健康数据',
  '宠物',
  '积分与花费',
  '用户为自定义角色之间设定的关系',
];
const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const mark = (index: number) => circled[index] ?? `(${index + 1})`;
const chars = (text: string) => Array.from(text).length;

export function classificationText(c: {
  basis: string;
  realPersonKind: string | null;
  ageSetting: string;
  childAppearance?: boolean;
}): string {
  const head =
    c.basis === 'real_person'
      ? `真人 · ${realKindNames[c.realPersonKind ?? ''] ?? ''}`
      : `${basisNames[c.basis] ?? ''} · ${c.ageSetting === 'minor' ? '未满 18 岁' : '已满 18 岁'}`;
  return c.childAppearance ? `${head} · 儿童外貌` : head;
}

function dateText(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
export function timeText(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${Math.floor(diff)} 分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小时前`;
  return dateText(iso);
}
function code(error: unknown) {
  return error instanceof ApiFailure ? error.code : '';
}
export function authorName(author: PlazaAuthor) {
  return author.deleted ? '已注销用户' : author.nickname;
}

/** 广场头像：有公开图用图，否则非肖像默认头像（default-avatar.md 第 3 节，按 ID 取应援色）。 */
export function PlazaAvatar({
  id,
  name,
  url,
  size = 48,
}: {
  id: string;
  name: string;
  url: string | null;
  size?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const palette = String(avatarPaletteIndex(id)).padStart(2, '0');
  const letters = avatarLetters(name || '广');
  return (
    <span
      className="plaza-avatar"
      role="img"
      aria-label={`${name}头像`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.12,
        background: `var(--wb-support-${palette}-bg)`,
        color: `var(--wb-support-${palette}-on)`,
        fontSize: size * (Array.from(letters).length === 1 ? 0.44 : 0.34),
      }}
    >
      <span aria-hidden="true">{letters}</span>
      {url && !failed && (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
function WorkAvatar({ work, size = 48 }: { work: PlazaWorkCard; size?: number }) {
  return work.kind === 'preset_variant' && work.basedOnPresetId ? (
    <CharacterAvatar id={work.basedOnPresetId} size={size} />
  ) : (
    <PlazaAvatar id={work.workId} name={work.name} url={work.avatarUrl} size={size} />
  );
}
function KindTag({ work, highlight = false }: { work: PlazaWorkCard; highlight?: boolean }) {
  if (work.kind === 'preset_variant')
    return (
      <span className={highlight ? 'tag highlight' : 'tag neutral'}>
        预设改版 · 基于 {work.basedOnPresetName ?? '预设角色'}
      </span>
    );
  return <span className="tag neutral">{basisWord(work.basis) || '自定义'}</span>;
}
function PageHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      <button className="text-button" aria-label="返回" onClick={() => navigate(-1)}>
        <CaretLeft size={24} />
      </button>
      <h1>{title}</h1>
      {right ?? <span />}
    </header>
  );
}

/** 广场红点（PLZ-03 第 4 条：只有红点，不推送）。收到 data.changed(plaza_badge) 时重拉。 */
export function usePlazaBadge() {
  const remote = useRemote(PlazaEndpoints.getBadge, { networkOnly: true });
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === 'plaza_badge'
    )
      remote.refresh();
  });
  return remote.data as Badge | undefined;
}

// ---------- 广场分页（PLZ-01） ----------

/**
 * embedded：放进「角色广场」两个 tab 页里，「我发布的」入口移到页面标题栏。
 * 2026-10-25：排序 / 类型 / 分类筛选按用户要求删除；搜索保留，结果固定按「被用户添加的次数」排热度（服务端排序）。
 */
export function PlazaTab({ embedded = false }: { embedded?: boolean } = {}) {
  const badge = usePlazaBadge();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  return (
    <section aria-label="自定义角色" className="plaza-tab-page">
      {!embedded && (
        <div className="page-header">
          <span />
          <span />
          <Link to="/plaza/me" className="icon-button" aria-label="我发布的">
            <UserList size={24} />
            {badge && badge.myWorksUnseen + badge.reportResultsUnseen > 0 && (
              <span className="red-dot" aria-label="有新消息" />
            )}
          </Link>
        </div>
      )}
      <form
        className="search-strip"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
        }}
      >
        <SearchField
          aria-label="搜索自定义角色"
          placeholder="搜索角色、标签、作者、基于的角色"
          value={query}
          onClear={() => {
            setQuery('');
            setSearch('');
          }}
          maxLength={50}
          enterKeyHint="search"
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (!next.trim()) setSearch('');
          }}
        />
        <button type="submit" className="search-strip-submit" disabled={!query.trim()}>
          搜索
        </button>
      </form>
      <WorkList search={search} sort="added" />
    </section>
  );
}

// ---------- 列表末尾的手动分页行 ----------

/** 下一批的加载状态：idle = 可以点，loading = 在途，error = 失败可重试。 */
export type PageMore = 'idle' | 'loading' | 'error';

const LIST_END_KEY = 'plaza-list-end-row';

type PagedRow<T> = { key: string; item: T | null };

/**
 * 虚拟列表 + 末尾「加载更多」行：只有用户点才取下一批，不会触底自动连拉。
 * 公共 VirtualList 的 API 不动（其他负责人在改），这里把末尾行当成列表最后一项交给它渲染，
 * 于是滚动区仍然只有一个、按钮也留在列表内部。
 */
export function PagedVirtualList<T>({
  items,
  itemKey,
  estimate,
  label,
  render,
  more,
  hasMore,
  onLoadMore,
}: {
  items: T[];
  itemKey(item: T): string;
  estimate: number;
  label: string;
  render(item: T): ReactNode;
  more: PageMore;
  hasMore: boolean;
  onLoadMore(): void;
}) {
  const rows: PagedRow<T>[] = items.map((item) => ({ key: itemKey(item), item }));
  if (items.length) rows.push({ key: LIST_END_KEY, item: null });
  return (
    <VirtualList
      items={rows}
      itemKey={(row) => row.key}
      estimate={estimate}
      label={label}
      render={(row) =>
        row.item ? (
          render(row.item)
        ) : (
          <ListEndRow more={more} hasMore={hasMore} onLoadMore={onLoadMore} />
        )
      }
    />
  );
}

/** 列表最后一行：加载更多 / 正在读取 / 失败重试 / 没有更多。 */
export function ListEndRow({
  more,
  hasMore,
  onLoadMore,
}: {
  more: PageMore;
  hasMore: boolean;
  onLoadMore(): void;
}) {
  if (more === 'loading')
    return (
      <p className="plaza-list-end" role="status">
        <span className="spinner" aria-hidden="true" />
        正在读取…
      </p>
    );
  if (more === 'error')
    return (
      <div className="plaza-list-end">
        <button type="button" className="text-button" onClick={onLoadMore}>
          没读出来，点这里重试
        </button>
      </div>
    );
  if (hasMore)
    return (
      <div className="plaza-list-end">
        <button type="button" className="text-button" onClick={onLoadMore}>
          加载更多
        </button>
      </div>
    );
  return <p className="plaza-list-end plaza-list-end-done">没有更多了</p>;
}

function WorkList({
  search,
  sort,
  authorId,
}: {
  search?: string;
  sort?: 'hot' | 'latest' | 'most_liked' | 'added';
  authorId?: string;
}) {
  const [items, setItems] = useState<PlazaWorkCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState<PageMore>('idle');
  /** 换搜索 / 换排序时让在途的旧请求作废；「加载更多」同一时间只放一批，连点不会拉两批。 */
  const generation = useRef(0);
  const moreInFlight = useRef(false);
  const load = useCallback(
    async (after?: string) => {
      if (after) {
        if (moreInFlight.current) return;
        moreInFlight.current = true;
        setMore('loading');
      } else {
        // 换搜索 / 重试：上一页的游标与在途状态作废，免得旧「加载更多」接到新结果后面。
        setState('loading');
        setMore('idle');
        setCursor(null);
      }
      const gen = after ? generation.current : ++generation.current;
      try {
        const page = await api.call(PlazaEndpoints.listWorks, {
          query: {
            q: search || undefined,
            sort: sort ?? 'latest',
            authorId,
            cursor: after,
            limit: 20,
          },
          networkOnly: true,
        });
        if (gen !== generation.current) return;
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        if (after) setMore('idle');
        else setState('ready');
      } catch {
        if (gen !== generation.current) return;
        if (after) setMore('error');
        else setState('error');
      } finally {
        if (after) moreInFlight.current = false;
      }
    },
    [search, sort, authorId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (state === 'loading' && items.length === 0)
    return (
      <div className="plaza-tab-body" aria-busy="true" role="status" aria-label="正在读取作品">
        {Array.from({ length: authorId ? 3 : 6 }, (_, i) => (
          <div key={i} className="skeleton-row" style={{ height: 88, marginBottom: 4 }} />
        ))}
      </div>
    );
  if (state === 'error' && items.length === 0)
    return (
      <div className="plaza-tab-body">
        <div className="empty">
          <p>加载失败</p>
          <button onClick={() => void load()}>重试</button>
        </div>
      </div>
    );
  if (items.length === 0)
    return (
      <div className="plaza-tab-body">
        <p className="empty">
          {authorId
            ? 'TA 还没有公开的作品'
            : search
              ? `没有找到「${search}」`
              : '还没有人发布角色 · 在和自己的角色聊天时，可以从「聊天信息」发布到这里'}
        </p>
        {!authorId && search && <WebCharacterSearch key={search} query={search} />}
      </div>
    );
  return (
    <PagedVirtualList
      items={items}
      itemKey={(w) => w.workId}
      estimate={88}
      label="人设广场作品"
      render={(work) => <WorkRow work={work} search={search} />}
      more={more}
      hasMore={!!cursor}
      onLoadMore={() => {
        if (cursor) void load(cursor);
      }}
    />
  );
}

/**
 * U4 广场列表卡片（26 号 §3.2）：头像、名字、一句话简介、2–3 个标签、热度；不放长描述。
 * 作品列表接口不带角色标签（契约 PlazaWorkCard 无 tags），标签位先放类型词（原创 / 作品角色 / 预设改版）。
 */
function WorkRow({ work, search }: { work: PlazaWorkCard; search?: string }) {
  const hit = !!search && !!work.basedOnPresetName?.includes(search);
  return (
    <Link to={`/plaza/works/${work.workId}`} className="plaza-card">
      <WorkAvatar work={work} size={52} />
      <span className="plaza-card-main">
        <span className="plaza-card-name">{work.name}</span>
        {work.tagline && <small className="plaza-card-tagline">{work.tagline}</small>}
        <span className="plaza-card-tags">
          <KindTag work={work} highlight={hit} />
          <span className="plaza-card-author">{authorName(work.author)}</span>
        </span>
      </span>
      <PlazaHeat
        label="人添加"
        count={work.adoptCount}
        note={work.adoptedByMe ? '已添加' : undefined}
      />
    </Link>
  );
}

/** 列表卡片右侧的热度：数字 + 单位，为 0 时不显示数字。 */
export function PlazaHeat({
  count,
  label,
  icon,
  note,
}: {
  count: number;
  label?: string;
  icon?: ReactNode;
  note?: string;
}) {
  return (
    <span className="plaza-card-side">
      {count > 0 && (
        <span className="plaza-heat">
          {icon}
          <b>{count}</b>
          {label}
        </span>
      )}
      {note && <small>{note}</small>}
    </span>
  );
}

// ---------- 作品页（PLZ-01 第 6 条、PLZ-03、PLZ-04） ----------

/** 公开快照里已遮盖的「▢」高亮显示（C 18.4）。 */
function MaskedPublic({ text }: { text: string }) {
  return (
    <>
      {text.split(/(▢+)/).map((part, i) =>
        part.startsWith('▢') ? (
          <span key={i} className="plaza-mask" aria-label="已遮盖">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function snapshotFields(
  snapshot: PlazaSnapshot,
): Array<{ key: string; label: string; text: string }> {
  if (snapshot.kind === 'preset_variant')
    return [{ key: 'variantText', label: '改版设定', text: snapshot.variantText }];
  const rows: Array<{ key: string; label: string; text: string }> = [
    { key: 'name', label: '名字', text: snapshot.name },
    { key: 'description', label: '人设描述', text: snapshot.description },
    { key: 'speechStyle', label: '说话方式', text: snapshot.speechStyle },
  ];
  snapshot.catchphrases.forEach((text, i) =>
    rows.push({ key: `catchphrases.${i}`, label: i === 0 ? '口头禅' : '', text }),
  );
  rows.push({ key: 'exampleDialogue', label: '示例对话', text: snapshot.exampleDialogue });
  snapshot.tags.forEach((text, i) =>
    rows.push({ key: `tags.${i}`, label: i === 0 ? '标签' : '', text }),
  );
  return rows.filter((row) => row.text.trim());
}

function ContentPreview({
  snapshot,
  renderText,
  children,
}: {
  snapshot: PlazaSnapshot;
  renderText(key: string, text: string): ReactNode;
  children?: ReactNode;
}) {
  return (
    <dl className="panel content-preview">
      {snapshot.kind === 'preset_variant' ? (
        <>
          <dt>基于的角色</dt>
          <dd>
            <Link to={`/characters/${snapshot.presetCharacterId}`} className="role-row">
              <CharacterAvatar id={snapshot.presetCharacterId} size={24} />
              <PresetName id={snapshot.presetCharacterId} />
              （预设角色）›
            </Link>
          </dd>
        </>
      ) : (
        <>
          <dt>分类</dt>
          <dd>
            {classificationText(snapshot.classification)}
            <br />
            <small className="hint">添加后分类与原作品相同，之后只能改得更严格</small>
          </dd>
        </>
      )}
      {children}
      {snapshotFields(snapshot).map((row) => (
        <div key={row.key}>
          {row.label && <dt>{row.label}</dt>}
          <dd>{renderText(row.key, row.text)}</dd>
        </div>
      ))}
      {snapshot.kind === 'custom_character' && snapshot.birthday && (
        <>
          <dt>生日</dt>
          <dd>{snapshot.birthday}</dd>
        </>
      )}
      {snapshot.kind === 'custom_character' && snapshot.voiceName && (
        <>
          <dt>音色</dt>
          <dd>{snapshot.voiceName}</dd>
        </>
      )}
    </dl>
  );
}
function PresetName({ id }: { id: string }) {
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId: id } });
  return <>{profile.data?.name ?? '预设角色'}</>;
}

const reportedTargets = new Set<string>();

export function WorkPage() {
  const { workId = '' } = useParams();
  const navigate = useNavigate();
  const [work, setWork] = useState<PlazaWorkDetail>();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  const [revision, setRevision] = useState(0);
  const [sheet, setSheet] = useState<'versions' | 'menu' | null>(null);
  const [dialog, setDialog] = useState<'adopted' | 'replace' | 'unlist' | 'delete' | 'full' | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [adoptedCharacter, setAdoptedCharacter] = useState<string | null>(null);
  const { state: chat, synchronize } = useChat();
  const voices = useRemote(VoiceEndpoints.listVoices, { networkOnly: true });
  useEffect(() => {
    let active = true;
    setState((s) => (s === 'ready' ? s : 'loading'));
    api
      .call(PlazaEndpoints.getWork, { params: { workId }, networkOnly: true })
      .then((value) => {
        if (!active) return;
        setWork(value);
        setState('ready');
      })
      .catch((e) => {
        if (active) setState(code(e) === 'not_found' ? 'gone' : 'error');
      });
    return () => {
      active = false;
    };
  }, [workId, revision]);
  const reload = () => setRevision((v) => v + 1);

  if (state === 'loading' && !work)
    return (
      <main>
        <PageHeader title="" />
        <div className="work-header" aria-busy="true">
          <div className="skeleton-row" style={{ width: 64, height: 64 }} />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      </main>
    );
  if (state === 'gone')
    return (
      <main>
        <PageHeader title="" />
        <p className="empty">这个作品已经看不到了</p>
      </main>
    );
  if (state === 'error' || !work)
    return (
      <main>
        <PageHeader title="" />
        <div className="empty">
          <p>加载失败</p>
          <button onClick={reload}>重试</button>
        </div>
      </main>
    );
  const w = work;
  const latest = w.versions.reduce((a, b) => (b.version > a.version ? b : a), w.versions[0]!);
  const presetId = w.snapshot.kind === 'preset_variant' ? w.snapshot.presetCharacterId : null;
  const presetContact = presetId ? chat.contacts.find((c) => c.characterId === presetId) : null;
  const presetName = w.basedOnPresetName ?? '预设角色';

  async function adopt() {
    setDialog(null);
    setPending(true);
    try {
      const result = await api.call(PlazaEndpoints.adopt, {
        params: { workId },
        body: { adoptionId: crypto.randomUUID() },
      });
      await synchronize().catch(() => {});
      setAdoptedCharacter(result.characterId);
      setWork({ ...w, adoptedByMe: true, adoptCount: w.adoptCount + 1 });
      showToast('已添加，等待 TA 通过好友申请');
    } catch (e) {
      if (code(e) === 'contact_limit_reached') setDialog('full');
      else showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function apply(confirmReplace: boolean) {
    setDialog(null);
    setPending(true);
    try {
      const result = await api.call(PlazaEndpoints.apply, {
        params: { workId },
        body: { adoptionId: crypto.randomUUID(), confirmReplaceSupplement: confirmReplace },
      });
      await synchronize().catch(() => {});
      setWork({ ...w, adoptedByMe: true });
      setAdoptedCharacter(result.characterId);
      showToast(presetContact ? `已应用到 ${presetName}` : `已添加 ${presetName} 并应用改版`);
    } catch (e) {
      if (code(e) === 'conflict') setDialog('replace');
      else if (code(e) === 'contact_limit_reached') setDialog('full');
      else showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function toggleLike() {
    const liked = !w.likedByMe;
    setWork({ ...w, likedByMe: liked, likeCount: w.likeCount + (liked ? 1 : -1) });
    try {
      const result = await api.call(liked ? PlazaEndpoints.like : PlazaEndpoints.unlike, {
        params: { workId },
      });
      setWork((prev) => (prev ? { ...prev, ...result } : prev));
    } catch {
      setWork(w);
      showToast('没成功，请重试');
    }
  }
  async function manage(action: 'comments' | 'unlist' | 'relist' | 'delete') {
    setSheet(null);
    setDialog(null);
    setPending(true);
    try {
      if (action === 'comments') {
        const open = !w.settings.commentsOpen;
        setWork(
          await api.call(PlazaEndpoints.updateWorkSettings, {
            params: { workId },
            body: { commentsOpen: open },
          }),
        );
        showToast(open ? '已开启评论' : '已关闭评论');
      } else if (action === 'unlist') {
        // U2：下架可撤销（重新上架接口）——不再二次确认，底部撤销条
        setWork(await api.call(PlazaEndpoints.unlistWork, { params: { workId } }));
        showSnackbar({
          text: '已下架，广场上看不到这个作品了',
          onAction: () => manage('relist'),
        });
      } else if (action === 'relist') {
        setWork(await api.call(PlazaEndpoints.relistWork, { params: { workId } }));
        showToast('已重新上架');
      } else {
        await api.call(PlazaEndpoints.deleteWork, { params: { workId } });
        showToast('已删除作品');
        navigate('/plaza/me', { replace: true });
      }
    } catch (e) {
      showToast(
        code(e) === 'plaza_publish_forbidden' ? '这个作品已被管理员下架' : friendlyError(e),
      );
    } finally {
      setPending(false);
    }
  }
  async function publishNewVersion() {
    setSheet(null);
    if (w.snapshot.kind === 'preset_variant') {
      navigate(`/plaza/publish?presetId=${w.snapshot.presetCharacterId}`);
      return;
    }
    try {
      const mine = await api.call(UserCustomEndpoints.list, { networkOnly: true });
      const match = mine.items.find((c) => c.characterId === w.sourceCharacterId);
      if (match) navigate(`/plaza/publish?characterId=${match.characterId}`);
      else showToast('请从这个角色的「聊天信息」发布新版本');
    } catch (e) {
      showToast(friendlyError(e));
    }
  }

  const removedByAdmin = w.status === 'removed_by_admin';
  const voiceName = w.snapshot.kind === 'custom_character' ? w.snapshot.voiceName : null;
  const adoptedId = adoptedCharacter ?? w.myAdoptedCharacterId ?? null;
  const adoptedContact = adoptedId ? chat.contacts.find((c) => c.characterId === adoptedId) : null;
  const voiceSample = voiceName
    ? voices.data?.items.find((v) => v.enabled && v.name === voiceName)?.sampleUrl
    : null;
  return (
    <main className="work-page">
      <PageHeader
        title=""
        right={
          <button className="icon-button" aria-label="更多" onClick={() => setSheet('menu')}>
            <DotsThree size={24} />
          </button>
        }
      />
      {/* U4：作品详情改用人设卡（26 号 §3.2 / §4）；管理收进右上「…」，点赞评论放标题区右侧 */}
      <PersonaCard
        source={{ kind: 'plaza', data: { work: w } }}
        avatar={<WorkAvatar work={w} size={64} />}
        renderText={(text) => <MaskedPublic text={text} />}
        headAside={
          <>
            <button
              type="button"
              className={`persona-count${w.likedByMe ? ' on' : ''}`}
              aria-pressed={w.likedByMe}
              aria-label={
                w.likedByMe ? `取消点赞，${w.likeCount} 个赞` : `点赞，${w.likeCount} 个赞`
              }
              onClick={() => void toggleLike()}
            >
              <Heart size={20} weight={w.likedByMe ? 'fill' : 'regular'} />
              {w.likeCount}
            </button>
            <a
              className="persona-count"
              href="#work-comments"
              aria-label={`${w.commentCount} 条评论`}
            >
              <ChatCircle size={20} />
              {w.commentCount}
            </a>
          </>
        }
        headExtra={
          <>
            {w.author.deleted ? (
              <span>已注销用户</span>
            ) : (
              <Link to={`/plaza/authors/${w.author.authorId}`} className="persona-author">
                <PlazaAvatar
                  id={w.author.authorId}
                  name={w.author.nickname}
                  url={w.author.avatarUrl}
                  size={20}
                />
                {w.author.nickname}
              </Link>
            )}
            <button type="button" className="persona-version" onClick={() => setSheet('versions')}>
              版本 {w.currentVersion} · {dateText(latest.createdAt)}更新
            </button>
            {w.isMine && w.status !== 'listed' && (
              <span className="tag danger">
                {removedByAdmin
                  ? '被管理员下架'
                  : w.status === 'author_banned'
                    ? '暂不展示'
                    : '已下架'}
              </span>
            )}
          </>
        }
        intro={
          w.settings.publishNote ? (
            <section className="persona-section" aria-label="作者说明">
              <h3 className="persona-section-title">作者说明</h3>
              <p className="persona-text">{w.settings.publishNote}</p>
            </section>
          ) : undefined
        }
        asides={{ voice: <VoiceSampleButton url={voiceSample} name="音色" /> }}
        renders={{
          source: (value) =>
            w.snapshot.kind === 'preset_variant' ? (
              <Link to={`/characters/${w.snapshot.presetCharacterId}`}>
                {personaValue.text(value)}
              </Link>
            ) : w.remixOf?.available ? (
              <Link to={`/plaza/works/${w.remixOf.workId}`}>{personaValue.text(value)}</Link>
            ) : (
              personaValue.text(value)
            ),
        }}
      />
      <p className="hint page-note">
        {w.snapshot.kind === 'custom_character' && '添加后分类与原作品相同，之后只能改得更严格。'}
        只复制上面这些内容；作者的聊天记录、记忆和个人资料不会出现在广场上
      </p>
      <div id="work-comments">
        <Comments work={w} onCount={(n) => setWork((p) => (p ? { ...p, commentCount: n } : p))} />
      </div>
      {!w.isMine && (
        <div className="work-action-bar persona-action-bar">
          {w.kind === 'custom_character' && w.myAdoptedCharacterId && (
            <AdoptedUpdateButton characterId={w.myAdoptedCharacterId} workId={workId} />
          )}
          {adoptedId ? (
            <Link
              className="button primary"
              to={
                adoptedContact?.conversationId
                  ? `/chat/${adoptedContact.conversationId}`
                  : `/characters/${adoptedId}`
              }
            >
              {adoptedContact?.conversationId ? '发消息' : '已添加 · 等待通过'}
            </Link>
          ) : w.kind === 'preset_variant' ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => (w.adoptedByMe ? setDialog('adopted') : void adopt())}
              >
                添加为新角色
              </button>
              <button
                type="button"
                className="primary"
                disabled={pending}
                onClick={() => void apply(false)}
              >
                {presetContact ? `应用到我的 ${presetName}` : `添加 ${presetName} 并应用`}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() => (w.adoptedByMe ? setDialog('adopted') : void adopt())}
            >
              {pending ? '正在添加…' : '添加到通讯录'}
            </button>
          )}
        </div>
      )}
      {sheet === 'versions' && (
        <Sheet title="版本记录" onClose={() => setSheet(null)}>
          <div className="stack">
            {[...w.versions]
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <div key={v.version} className="stack">
                  <span>
                    版本 {v.version} · {v.createdAt.slice(0, 10)}
                  </span>
                  {v.changeNote && <small className="hint">{v.changeNote}</small>}
                </div>
              ))}
          </div>
        </Sheet>
      )}
      {/* U2：更多操作从「弹层里一列带边框按钮」改微信式 Action Sheet；点了先关面板，确认框不叠在面板上 */}
      {sheet === 'menu' && (
        <ActionSheet
          onClose={() => setSheet(null)}
          items={
            w.isMine
              ? [
                  ...(!removedByAdmin
                    ? [{ label: '发布新版本', onClick: () => void publishNewVersion() }]
                    : []),
                  {
                    label: w.settings.commentsOpen ? '关闭评论' : '开启评论',
                    onClick: () => void manage('comments'),
                  },
                  ...(w.status === 'listed'
                    ? [{ label: '下架', onClick: () => void manage('unlist') }]
                    : []),
                  ...(w.status === 'unlisted_by_author'
                    ? [{ label: '重新上架', onClick: () => void manage('relist') }]
                    : []),
                  { label: '删除作品', danger: true, onClick: () => setDialog('delete') },
                ]
              : [
                  reportedTargets.has(`work:${workId}`)
                    ? { label: '已举报', disabled: true, onClick: () => undefined }
                    : { label: '举报', onClick: () => navigate(`/plaza/report?work=${workId}`) },
                  {
                    label: '向官方投诉',
                    onClick: () =>
                      navigate(`/support/new?targetType=plaza_work&targetId=${workId}`),
                  },
                ]
          }
        />
      )}
      {dialog === 'adopted' && (
        <Dialog
          title="你已添加过这个角色"
          actions={[
            { label: '取消', onClick: () => setDialog(null) },
            { label: '再添加一份', tone: 'primary', onClick: () => void adopt() },
          ]}
        />
      )}
      {dialog === 'replace' && (
        <Dialog
          title="替换补充设定？"
          actions={[
            { label: '取消', onClick: () => setDialog(null) },
            { label: '替换补充设定', tone: 'primary', onClick: () => void apply(true) },
          ]}
        >
          <p>将替换你现有的补充设定。你们的聊天记录、记忆和好感度都不会变</p>
        </Dialog>
      )}
      {dialog === 'full' && (
        <Dialog
          title="通讯录已满"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setDialog(null) }]}
        >
          <p>通讯录已满 50 个角色，先删除一些再添加吧</p>
        </Dialog>
      )}
      {dialog === 'delete' && (
        <AlertDialog
          title="删除作品？"
          message="作品和它的点赞、评论都会删除，不能恢复。已经添加的人不受影响。"
          confirmLabel="删除作品"
          pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={() => void manage('delete')}
        />
      )}
    </main>
  );
}

function Comments({ work, onCount }: { work: PlazaWorkDetail; onCount(n: number): void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<PlazaComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<PlazaComment | null>(null);
  const [sending, setSending] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      try {
        const page = await api.call(PlazaEndpoints.listComments, {
          params: { workId: work.workId },
          query: { cursor: after },
          networkOnly: true,
        });
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch {
        /* 评论读不到时只显示空列表 */
      } finally {
        setLoading(false);
      }
    },
    [work.workId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!work.settings.commentsOpen)
    return (
      <>
        <h2 className="section-label">评论</h2>
        <p className="hint">作者关闭了评论</p>
      </>
    );
  const visible = showAll ? items : items.slice(0, 20);
  const over = chars(text) > PLAZA_COMMENT_MAX_CHARS;
  async function startCompose(target: PlazaComment | null) {
    try {
      const profile = await api.call(PlazaEndpoints.getMyProfile, { networkOnly: true });
      if (!profile) {
        navigate(`/plaza/profile?next=${encodeURIComponent(`/plaza/works/${work.workId}`)}`);
        return;
      }
      if (profile.bannedUntil) {
        showToast('你暂时不能评论');
        return;
      }
    } catch {
      /* 读不到资料时照常打开输入栏，提交时由服务器判断 */
    }
    setReplyTo(target);
    setComposing(true);
  }
  async function send() {
    const value = text.trim();
    if (!value || over) return;
    setSending(true);
    try {
      const comment = await api.call(PlazaEndpoints.addComment, {
        params: { workId: work.workId },
        body: {
          clientRequestId: requestId.current,
          text: value,
          replyToCommentId: replyTo?.commentId ?? null,
        },
      });
      requestId.current = crypto.randomUUID();
      setItems((prev) => [...prev, comment]);
      onCount(work.commentCount + 1);
      setText('');
      setReplyTo(null);
      setComposing(false);
    } catch (e) {
      if (code(e) === 'conflict')
        navigate(`/plaza/profile?next=${encodeURIComponent(`/plaza/works/${work.workId}`)}`);
      else if (code(e) === 'plaza_publish_forbidden') showToast('你暂时不能评论');
      else showToast('没成功，请重试');
    } finally {
      setSending(false);
    }
  }
  async function remove(comment: PlazaComment) {
    try {
      await api.call(PlazaEndpoints.deleteComment, { params: { commentId: comment.commentId } });
      setItems((prev) => prev.filter((c) => c.commentId !== comment.commentId));
      onCount(Math.max(0, work.commentCount - 1));
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  return (
    <>
      <h2 className="section-label">评论 {work.commentCount}</h2>
      <div className="panel">
        {loading && items.length === 0 && <div className="skeleton-line" role="status" />}
        {visible.map((c) => (
          <div key={c.commentId} className="comment-item">
            <PlazaAvatar
              id={c.author.authorId}
              name={authorName(c.author)}
              url={c.author.avatarUrl}
              size={32}
            />
            <div>
              <strong>
                {authorName(c.author)}
                {c.author.authorId === work.author.authorId && (
                  <span className="tag neutral">作者</span>
                )}
              </strong>
              <p>
                {c.replyTo && `回复 ${authorName(c.replyTo)}：`}
                {c.text}
              </p>
              <div className="comment-tools">
                <span>{timeText(c.createdAt)}</span>
                <button onClick={() => void startCompose(c)}>回复</button>
                {c.deletable && <button onClick={() => void remove(c)}>删除</button>}
                {!c.deletable &&
                  (reportedTargets.has(`comment:${c.commentId}`) ? (
                    <span>已举报</span>
                  ) : (
                    <Link to={`/plaza/report?comment=${c.commentId}`}>举报</Link>
                  ))}
              </div>
            </div>
          </div>
        ))}
        {!showAll && items.length > 20 && (
          <button className="text-button" onClick={() => setShowAll(true)}>
            查看全部 {work.commentCount} 条评论
          </button>
        )}
        {showAll && cursor && (
          <button className="text-button" disabled={loading} onClick={() => void load(cursor)}>
            加载更多评论
          </button>
        )}
        <div className="plaza-comment-bar">
          {composing ? (
            <form
              className="message-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label>
                {replyTo ? `回复 ${authorName(replyTo.author)}` : '评论'}
                <input autoFocus value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <small className={over ? 'char-count over-limit' : 'char-count hint'}>
                {chars(text)}/{PLAZA_COMMENT_MAX_CHARS}
              </small>
              <button className="primary" disabled={sending || over || !text.trim()}>
                发送
              </button>
            </form>
          ) : (
            <button className="text-button" onClick={() => void startCompose(null)}>
              说点什么…
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ---------- 作者页（PLZ-01 第 7 条）：只有昵称、头像和作品列表 ----------

export function AuthorPage() {
  const { authorId = '' } = useParams();
  const author = useRemote(PlazaEndpoints.getAuthor, { params: { authorId }, networkOnly: true });
  return (
    <main>
      <PageHeader title="" />
      {author.error && <p className="empty">{author.error}</p>}
      {author.data && (
        <div className="work-header">
          <PlazaAvatar
            id={author.data.authorId}
            name={authorName(author.data)}
            url={author.data.avatarUrl}
            size={64}
          />
          <h2>{authorName(author.data)}</h2>
        </div>
      )}
      <WorkList authorId={authorId} sort="latest" />
    </main>
  );
}

// ---------- 举报（PLZ-07） ----------

export function ReportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const workId = params.get('work');
  const commentId = params.get('comment');
  const [reason, setReason] = useState<keyof typeof reasonNames | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (!reason) return;
    setPending(true);
    setError('');
    const key = workId ? `work:${workId}` : `comment:${commentId}`;
    try {
      await api.call(PlazaEndpoints.report, {
        body: {
          target: workId
            ? { kind: 'work', workId }
            : { kind: 'comment', commentId: commentId ?? '' },
          reason,
          note: note.trim() || null,
        },
      });
      reportedTargets.add(key);
      showToast('已提交，管理员会尽快处理');
      navigate(-1);
    } catch (e) {
      if (code(e) === 'conflict') {
        reportedTargets.add(key);
        setError('你已经举报过这个内容');
      } else setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <PageHeader title="举报" />
      <fieldset className="panel rows">
        <legend className="section-label">举报原因</legend>
        {(Object.keys(reasonNames) as Array<keyof typeof reasonNames>).map((key) => (
          <label key={key} className="check">
            <input
              type="radio"
              name="reason"
              checked={reason === key}
              onChange={() => setReason(key)}
            />
            {reasonNames[key]}
          </label>
        ))}
      </fieldset>
      <label className="stack">
        补充说明（选填）
        <textarea value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        <small className="char-count hint">{chars(note)}/200</small>
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary full" disabled={!reason || pending} onClick={() => void submit()}>
        提交
      </button>
    </main>
  );
}

// ---------- 设置广场昵称（PLZ-02 第 2 条） ----------

export function PlazaProfilePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  return (
    <main>
      <PageHeader title="广场昵称" />
      <NicknameForm
        onDone={() =>
          next && next.startsWith('/') ? navigate(next, { replace: true }) : navigate(-1)
        }
      />
    </main>
  );
}

function NicknameForm({ onDone }: { onDone(profile: NonNullable<MyProfile>): void }) {
  const mine = useRemote(PlazaEndpoints.getMyProfile, { networkOnly: true });
  const me = useRemote(IdentityEndpoints.getProfile);
  const [nickname, setNickname] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<{ mediaId: string | null; url: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const current =
    nickname ??
    mine.data?.nickname ??
    Array.from(me.data?.nickname ?? '')
      .slice(0, 12)
      .join('');
  const chosen = avatar ?? {
    mediaId: mine.data ? mine.data.avatarMediaId : (me.data?.avatarMediaId ?? null),
    url: mine.data?.avatarUrl ?? null,
  };
  async function pick(input: File) {
    setPending(true);
    setError('');
    try {
      const { blob } = await prepareImage(input);
      const media = await uploadMedia('user_avatar', blob);
      setAvatar({ mediaId: media.mediaId, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function save() {
    setPending(true);
    setError('');
    try {
      const profile = await api.call(PlazaEndpoints.putMyProfile, {
        body: { nickname: current.trim(), avatarMediaId: chosen.mediaId },
      });
      showToast('已保存');
      onDone(profile);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const length = chars(current.trim());
  return (
    <div className="stack">
      <div className="work-header">
        <PlazaAvatar id="plaza-me" name={current || '我'} url={chosen.url} size={64} />
        <div className="button-row">
          <button type="button" className="text-button" onClick={() => file.current?.click()}>
            从相册选择
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setAvatar({ mediaId: me.data?.avatarMediaId ?? null, url: null })}
          >
            使用我的头像
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
      </div>
      <label>
        广场昵称
        <input value={current} onChange={(e) => setNickname(e.target.value)} />
      </label>
      <small className={length > 12 ? 'char-count over-limit' : 'char-count hint'}>
        {length}/12
      </small>
      <p className="hint">ⓘ 其他用户会看到你的广场昵称和头像，不会看到你的通讯录、朋友圈和聊天</p>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={pending || length === 0 || length > 12}
        onClick={() => void save()}
      >
        下一步
      </button>
    </div>
  );
}

// ---------- 我发布的（PLZ-02 第 1 条、PLZ-03、PLZ-06、PLZ-07 第 4 条） ----------

const statusNames: Record<string, string> = {
  listed: '展示中',
  unlisted_by_author: '已下架',
  removed_by_admin: '被管理员下架',
  author_banned: '暂不展示',
};

export function MyWorksPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'works' | 'notices'>('works');
  const profile = useRemote(PlazaEndpoints.getMyProfile, { networkOnly: true });
  const works = useRemote(PlazaEndpoints.listMyWorks, { networkOnly: true });
  const badge = usePlazaBadge();
  const unseen = (badge?.myWorksUnseen ?? 0) + (badge?.reportResultsUnseen ?? 0);
  return (
    <main>
      <PageHeader title="我发布的" />
      <Link to="/plaza/profile" className="panel row-link">
        <span className="role-row">
          <PlazaAvatar
            id="plaza-me"
            name={profile.data?.nickname ?? '我'}
            url={profile.data?.avatarUrl ?? null}
            size={40}
          />
          广场昵称：{profile.data?.nickname ?? '未设置'}
        </span>
        <small>›</small>
      </Link>
      {profile.data?.bannedUntil && (
        <p className="inline-tip">
          你暂时不能发布作品
          {profile.data.bannedUntil !== 'permanent' &&
            `，${dateText(profile.data.bannedUntil)}后恢复`}
        </p>
      )}
      <div className="plaza-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'works'} onClick={() => setTab('works')}>
          作品
        </button>
        <button role="tab" aria-selected={tab === 'notices'} onClick={() => setTab('notices')}>
          消息
          {unseen > 0 && tab !== 'notices' && <span className="red-dot" aria-label="有未读" />}
        </button>
      </div>
      {tab === 'works' ? (
        <>
          {works.loading && !works.data && <div className="skeleton-row" role="status" />}
          {works.error && (
            <div className="empty">
              <p>加载失败</p>
              <button onClick={works.refresh}>重试</button>
            </div>
          )}
          {works.data?.items.length === 0 && (
            <p className="empty">
              还没有发布过作品 · 在和自己的角色聊天时，打开「聊天信息」就能发布
            </p>
          )}
          <div className="panel">
            {works.data?.items.map((w) => (
              <button
                key={w.workId}
                className="work-row"
                onClick={() => navigate(`/plaza/works/${w.workId}`)}
              >
                <WorkAvatar work={w} />
                <span className="work-row-main">
                  <span className="work-row-title">
                    {w.name}
                    {(w.unreadCount ?? 0) > 0 && (
                      <span className="red-dot" aria-label={`${w.unreadCount} 条未读`} />
                    )}
                    <span className={w.status === 'listed' ? 'tag success' : 'tag danger'}>
                      {statusNames[w.status] ?? '未知状态'}
                    </span>
                  </span>
                  <span className="work-row-meta">
                    版本 {w.currentVersion} · 赞 {w.likeCount} · 添加 {w.adoptCount}
                  </span>
                  {w.removedReason && <span className="hint">下架原因：{w.removedReason}</span>}
                </span>
                <span />
              </button>
            ))}
          </div>
        </>
      ) : (
        <Notices />
      )}
    </main>
  );
}

function Notices() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async (after?: string) => {
    setState('loading');
    try {
      // 拉取即标记已读（T-087 交接）。
      const page = await api.call(PlazaEndpoints.listNotices, {
        query: { cursor: after },
        networkOnly: true,
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (state === 'error' && items.length === 0)
    return (
      <div className="empty">
        <p>加载失败</p>
        <button onClick={() => void load()}>重试</button>
      </div>
    );
  if (state === 'ready' && items.length === 0) return <p className="empty">还没有消息</p>;
  const jumps = ['work_liked', 'work_commented', 'comment_replied'];
  return (
    <div className="panel">
      {items.map((n) => {
        const body = (
          <>
            <span className="role-row">
              {!n.seen && <span className="red-dot" aria-label="未读" />}
              <Storefront size={32} aria-hidden="true" />
            </span>
            <span className="stack">
              <span>{n.text}</span>
              <small>{timeText(n.createdAt)}</small>
            </span>
          </>
        );
        return n.workId && jumps.includes(n.kind) ? (
          <button
            key={n.noticeId}
            className="notice-row"
            onClick={() => navigate(`/plaza/works/${n.workId}`)}
          >
            {body}
          </button>
        ) : (
          <div key={n.noticeId} className="notice-row">
            {body}
          </div>
        );
      })}
      {cursor && (
        <button disabled={state === 'loading'} onClick={() => void load(cursor)}>
          加载更多
        </button>
      )}
    </div>
  );
}

// ---------- 发布流程（PLZ-02、PLZ-05） ----------

type Step = 'form' | 'nickname' | 'checking' | 'check_failed' | 'confirm';

export function PublishPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const characterId = params.get('characterId');
  const presetId = params.get('presetId');
  const source = useMemo(
    () =>
      characterId
        ? ({ kind: 'custom_character', characterId } as const)
        : presetId
          ? ({ kind: 'preset_variant', presetCharacterId: presetId } as const)
          : null,
    [characterId, presetId],
  );
  const subjectId = characterId ?? presetId ?? '';
  const profile = useRemote(CharacterEndpoints.getProfile, {
    params: { characterId: subjectId },
  });
  const [step, setStep] = useState<Step>('form');
  const [tagline, setTagline] = useState('');
  const [note, setNote] = useState('');
  const [allowRemix, setAllowRemix] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [useAvatar, setUseAvatar] = useState(true);
  const [rights, setRights] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [existing, setExisting] = useState<PlazaWorkDetail | null>(null);
  const [draft, setDraft] = useState<PlazaPublishDraft | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [confirmKeep, setConfirmKeep] = useState<string | null>(null);
  const [blocked, setBlocked] = useState('');
  const [balanceShort, setBalanceShort] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loosened, setLoosened] = useState(false);
  const [neverSheet, setNeverSheet] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  // 已发布过时预填上一版的设置（发布新版本，PLZ-05 第 1 条）。
  useEffect(() => {
    if (!source || !profile.data) return;
    let active = true;
    void api
      .call(PlazaEndpoints.listMyWorks, { networkOnly: true })
      .then((mine) => {
        const match = mine.items.find((w) =>
          source.kind === 'preset_variant'
            ? w.snapshot.kind === 'preset_variant' &&
              w.snapshot.presetCharacterId === source.presetCharacterId
            : w.snapshot.kind === 'custom_character' && w.sourceCharacterId === source.characterId,
        );
        if (!active || !match) return;
        setExisting(match);
        setTagline(match.settings.tagline);
        setNote(match.settings.publishNote);
        setAllowRemix(match.settings.allowRemix);
        setCommentsOpen(match.settings.commentsOpen);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [source, profile.data]);

  useEffect(() => {
    if (step !== 'checking') return;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [step]);

  if (!source)
    return (
      <main>
        <PageHeader title="发布到人设广场" />
        <p className="empty">没有找到要发布的角色</p>
      </main>
    );
  const classification = profile.data?.classification;
  const isReal = profile.data?.basis === 'real_person';
  const hasAvatar = source.kind === 'custom_character' && !!profile.data?.avatar.image;
  const newVersion = !!(draft?.workId ?? existing);
  const formReady =
    chars(tagline.trim()) > 0 &&
    chars(tagline) <= 30 &&
    chars(note) <= 300 &&
    (!newVersion || (chars(changeNote.trim()) > 0 && chars(changeNote) <= 100)) &&
    (!hasAvatar || isReal || !useAvatar || rights);

  async function next() {
    setError('');
    setBalanceShort(false);
    try {
      const mine = await api.call(PlazaEndpoints.getMyProfile, { networkOnly: true });
      if (!mine) {
        setStep('nickname');
        return;
      }
    } catch {
      /* 读不到时交给生成草稿判断 */
    }
    await check();
  }
  async function check() {
    if (!source) return;
    setStep('checking');
    try {
      const value = await api.call(PlazaEndpoints.createPublishDraft, { body: { source } });
      if (value.needsAuthorProfile) {
        setDraft(value);
        setStep('nickname');
        return;
      }
      setDraft(value);
      setKept([]);
      setLoosened(false);
      setStep('confirm');
    } catch (e) {
      const c = code(e);
      if (c === 'insufficient_balance' || c === 'budget_exceeded') {
        setBalanceShort(true);
        setStep('form');
      } else if (c === 'plaza_publish_forbidden') {
        setBlocked(e instanceof ApiFailure ? e.message : '暂时不能发布');
        setStep('form');
      } else if (c === 'plaza_check_unavailable' || c === 'service_unavailable') {
        setStep('check_failed');
      } else {
        setError(friendlyError(e));
        setStep('form');
      }
    }
  }
  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setError('');
    try {
      const work = await api.call(PlazaEndpoints.confirmPublish, {
        params: { draftId: draft.draftId },
        body: {
          settings: { tagline: tagline.trim(), publishNote: note, allowRemix, commentsOpen },
          keptSpanIds: kept,
          avatarRightsConfirmed: hasAvatar && !isReal && useAvatar && rights,
          changeNote: draft.workId ? changeNote.trim() || null : null,
        },
      });
      showToast('已发布');
      navigate(`/plaza/works/${work.workId}`, { replace: true });
    } catch (e) {
      const c = code(e);
      if (c === 'plaza_classification_loosened') setLoosened(true);
      else if (c === 'not_found') {
        setError('草稿已过期，请重新检查');
        setStep('form');
      } else if (c === 'plaza_publish_forbidden')
        setError(e instanceof ApiFailure ? e.message : '暂时不能发布');
      else setError(friendlyError(e));
    } finally {
      setPublishing(false);
    }
  }
  const rewriteTo =
    source.kind === 'custom_character'
      ? `/characters/custom/${source.characterId}/edit`
      : `/characters/${source.presetCharacterId}/supplement`;

  if (step === 'nickname')
    return (
      <main>
        <PageHeader title="广场昵称" />
        <NicknameForm onDone={() => void check()} />
      </main>
    );
  if (step === 'checking')
    return (
      <main>
        <PageHeader title="发布到人设广场" />
        <div aria-busy="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
        <p className="empty" role="status">
          {slow ? '内容比较多，还在检查…' : '正在检查要发布的内容…'}
        </p>
      </main>
    );
  if (step === 'check_failed')
    return (
      <main>
        <PageHeader title="发布到人设广场" />
        <div className="empty">
          <p>检查没有完成，请稍后再试</p>
          <button onClick={() => void check()}>重试</button>
        </div>
      </main>
    );
  if (step === 'confirm' && draft) {
    const spans = [...draft.spans].sort((a, b) =>
      a.fieldKey === b.fieldKey ? a.start - b.start : a.fieldKey.localeCompare(b.fieldKey),
    );
    const numberOf = (spanId: string) => spans.findIndex((s) => s.spanId === spanId);
    const pending = spans.filter((s) => !kept.includes(s.spanId));
    const fields = Object.fromEntries(snapshotFields(draft.snapshot).map((f) => [f.key, f]));
    const labelOf = (key: string) =>
      key.startsWith('catchphrases.')
        ? '口头禅'
        : key.startsWith('tags.')
          ? '标签'
          : (fields[key]?.label ?? key);
    const snapClass =
      draft.snapshot.kind === 'custom_character' ? draft.snapshot.classification : null;
    const renderText = (key: string, text: string) => {
      const list = spans.filter((s) => s.fieldKey === key);
      if (list.length === 0) return text;
      const characters = Array.from(text);
      const out: ReactNode[] = [];
      let at = 0;
      for (const s of list) {
        const start = Math.max(at, Math.min(s.start, characters.length));
        const end = Math.max(start, Math.min(s.end, characters.length));
        if (start > at) out.push(characters.slice(at, start).join(''));
        const original = characters.slice(start, end).join('');
        if (kept.includes(s.spanId))
          out.push(
            <mark key={s.spanId} className="plaza-kept">
              {original}
            </mark>,
          );
        else
          out.push(
            <span key={s.spanId} className="plaza-mask pending" aria-label="将被遮盖">
              {mark(numberOf(s.spanId))} {'▢'.repeat(Math.max(1, Math.min(end - start, 8)))}
            </span>,
          );
        at = end;
      }
      if (at < characters.length) out.push(characters.slice(at).join(''));
      return out;
    };
    const context = (key: string, start: number, end: number) => {
      const text = Array.from(fields[key]?.text ?? '');
      const before = text.slice(Math.max(0, start - 8), start).join('');
      const after = text.slice(end, end + 8).join('');
      return (
        <>
          「…{before}
          <span className="plaza-mask pending">
            {'▢'.repeat(Math.max(1, Math.min(end - start, 8)))}
          </span>
          {after}…」
        </>
      );
    };
    const keepTarget = spans.find((s) => s.spanId === confirmKeep);
    return (
      <main>
        <PageHeader title="发布内容确认" right={<span className="plaza-step">2/2</span>} />
        {pending.length > 0 && (
          <p className="inline-tip" role="note">
            ⚠ 有 {pending.length} 处可能是你的私人信息，已先遮住
          </p>
        )}
        {pending.length > 0 && (
          <>
            <h2 className="section-label">需要你确认</h2>
            <div className="panel">
              {pending.map((s) => (
                <div key={s.spanId} className="span-row">
                  <span>
                    {mark(numberOf(s.spanId))} {labelOf(s.fieldKey)} ·{' '}
                    {context(s.fieldKey, s.start, s.end)}
                  </span>
                  <small className="hint">
                    {s.kinds
                      .map((k: PrivacyKind | string) => privacyNames[k] ?? '私人信息')
                      .join(' / ')}
                  </small>
                  <div className="button-row">
                    <button onClick={() => navigate(rewriteTo)}>改写</button>
                    <button onClick={() => setConfirmKeep(s.spanId)}>保留</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <h2 className="section-label">将要发布的内容</h2>
        <ContentPreview snapshot={draft.snapshot} renderText={renderText}>
          {draft.childFeaturesDetected && snapClass?.ageSetting === 'adult' && (
            <dd className="inline-tip">
              人设中有未成年特征，这个作品在任何人那里都不能开启成人模式
            </dd>
          )}
          {loosened && <dd className="error">新版本的分类不能比上一版更宽</dd>}
        </ContentPreview>
        <dl className="panel content-preview">
          <dt>一句话介绍</dt>
          <dd>{tagline}</dd>
          {note && (
            <>
              <dt>发布说明</dt>
              <dd>{note}</dd>
            </>
          )}
          <dt>设置</dt>
          <dd>
            {allowRemix ? '允许改编后再发布' : '不允许改编'} ·{' '}
            {commentsOpen ? '开放评论' : '关闭评论'}
          </dd>
        </dl>
        {draft.workId && (
          <label className="stack">
            更新说明（必填）
            <textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
            <small
              className={chars(changeNote) > 100 ? 'char-count over-limit' : 'char-count hint'}
            >
              {chars(changeNote)}/100
            </small>
          </label>
        )}
        <button className="panel row-link" onClick={() => setNeverSheet(true)}>
          <span>哪些内容不会发布</span>
          <small>›</small>
        </button>
        {error && <p role="alert">{error}</p>}
        <div className="work-action-bar">
          <button
            className="primary grow"
            disabled={
              publishing ||
              loosened ||
              (!!draft.workId && (chars(changeNote.trim()) === 0 || chars(changeNote) > 100))
            }
            onClick={() => void publish()}
          >
            {publishing ? '正在发布…' : '发布'}
          </button>
        </div>
        {keepTarget && (
          <Dialog
            title="这不是你的私人信息？"
            actions={[
              { label: '取消', onClick: () => setConfirmKeep(null) },
              {
                label: '这不是我的私人信息',
                tone: 'primary',
                onClick: () => {
                  setKept((prev) => [...prev, keepTarget.spanId]);
                  setConfirmKeep(null);
                },
              },
            ]}
          >
            <p>
              「
              {Array.from(fields[keepTarget.fieldKey]?.text ?? '')
                .slice(keepTarget.start, keepTarget.end)
                .join('')}
              」
            </p>
          </Dialog>
        )}
        {/* U2：只读说明改居中说明框（审计 #36） */}
        {neverSheet && (
          <Dialog
            title="这些内容永远不会发布"
            onDismiss={() => setNeverSheet(false)}
            actions={[{ label: '知道了', tone: 'primary', onClick: () => setNeverSheet(false) }]}
          >
            <ul className="dialog-list">
              {neverPublished.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Dialog>
        )}
      </main>
    );
  }

  // 第 1 步：填写发布信息
  return (
    <main>
      <PageHeader
        title={newVersion ? '发布新版本' : '发布到人设广场'}
        right={<span className="plaza-step">1/2</span>}
      />
      {blocked && <p className="inline-tip">{blocked}</p>}
      {newVersion && (
        <label className="stack">
          更新说明（必填）
          <textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
          <small className={chars(changeNote) > 100 ? 'char-count over-limit' : 'char-count hint'}>
            {chars(changeNote)}/100
          </small>
        </label>
      )}
      <h2 className="section-label">介绍</h2>
      <div className="panel stack">
        <label>
          一句话介绍
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <small className={chars(tagline) > 30 ? 'char-count over-limit' : 'char-count hint'}>
          {chars(tagline)}/30
        </small>
        <label>
          发布说明（选填）
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <small className={chars(note) > 300 ? 'char-count over-limit' : 'char-count hint'}>
          {chars(note)}/300
        </small>
      </div>
      {source.kind === 'custom_character' && (
        <>
          <h2 className="section-label">头像</h2>
          <div className="panel stack">
            {isReal ? (
              <p className="hint">真人角色的头像不会发布，广场上显示默认头像</p>
            ) : hasAvatar ? (
              <>
                <label className="switch-row">
                  <span className="role-row">
                    <CharacterAvatar id={source.characterId} size={40} />
                    使用这张头像
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={useAvatar}
                    onChange={(e) => setUseAvatar(e.target.checked)}
                  />
                </label>
                {useAvatar && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={rights}
                      onChange={(e) => setRights(e.target.checked)}
                    />
                    我有权使用这张图片
                  </label>
                )}
              </>
            ) : (
              <p className="hint">这个角色没有上传头像，广场上显示默认头像</p>
            )}
          </div>
        </>
      )}
      <h2 className="section-label">设置</h2>
      <div className="panel stack">
        <label className="switch-row">
          <span>
            允许改编后再发布
            <br />
            <small className="hint">别人添加后修改，可以再发布为新作品，并标注改编自你</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={allowRemix}
            onChange={(e) => setAllowRemix(e.target.checked)}
          />
        </label>
        <label className="switch-row">
          开放评论
          <input
            type="checkbox"
            role="switch"
            checked={commentsOpen}
            onChange={(e) => setCommentsOpen(e.target.checked)}
          />
        </label>
      </div>
      {classification && <p className="hint">分类：{classificationText(classification)}</p>}
      {balanceShort && (
        <p role="alert">
          积分不足，暂时不能发布 <Link to="/wallet">查看积分</Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={!formReady || !!blocked} onClick={() => void next()}>
        下一步
      </button>
    </main>
  );
}

// ---------- 入口与来源标注（CHAT-13、PLZ-02 第 1 条、PLZ-04 第 4 条、PLZ-05 第 4 条） ----------

/** 聊天信息页「发布到人设广场」（只有自定义角色）。不能发布时禁用并写原因。 */
export function PlazaPublishRow({ characterId }: { characterId: string }) {
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  if (profile.data?.kind !== 'custom') return null;
  return (
    <CustomPublishRow
      characterId={characterId}
      privateKind={profile.data.classification.realPersonKind === 'private_person'}
    />
  );
}
function CustomPublishRow({
  characterId,
  privateKind,
}: {
  characterId: string;
  privateKind: boolean;
}) {
  const origin = useRemote(CustomCharacterOriginEndpoints.getOrigin, {
    params: { characterId },
    networkOnly: true,
  });
  const works = useRemote(PlazaEndpoints.listMyWorks, { networkOnly: true });
  const published = works.data?.items.find((work) => work.sourceCharacterId === characterId);
  const privatePerson = origin.data?.everPrivatePerson || privateKind;
  if (privatePerson)
    return (
      <div className="disabled-entry" aria-disabled="true">
        <span>发布到人设广场</span>
        <p className="hint">以身边的人为原型的角色不能发布，这是为了保护 TA 的隐私</p>
      </div>
    );
  return (
    <Link to={`/plaza/publish?characterId=${characterId}`}>
      {published ? `已发布 · 版本 ${published.currentVersion} · 发布新版本` : '发布到人设广场'}
    </Link>
  );
}

/** 补充设定页底部「发布为改版」（只有预设角色且有补充设定时）。 */
export function VariantPublishLink({ characterId }: { characterId: string }) {
  return (
    <Link className="text-button" to={`/plaza/publish?presetId=${characterId}`}>
      发布为改版
    </Link>
  );
}

function NewVersionSheet({
  characterId,
  workId,
  version,
  onClose,
}: {
  characterId: string;
  workId: string;
  version: number;
  onClose(done: boolean): void;
}) {
  const work = useRemote(PlazaEndpoints.getWork, { params: { workId }, networkOnly: true });
  const [overwrite, setOverwrite] = useState(false);
  const [pending, setPending] = useState(false);
  const note = work.data?.versions.find((v) => v.version === version)?.changeNote;
  async function decide(decision: 'update' | 'dismiss', confirmOverwrite = false) {
    setPending(true);
    try {
      await api.call(PlazaEndpoints.updateAdopted, {
        params: { characterId },
        body: { decision, confirmOverwrite },
      });
      showToast(decision === 'update' ? '已更新到新版本' : '好的，暂不更新');
      onClose(true);
    } catch (e) {
      if (code(e) === 'conflict') setOverwrite(true);
      else showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {/* U2：新版本提示改居中确认框（审计 #37） */}
      {!overwrite && (
        <Dialog
          title={`作者发布了版本 ${version}`}
          actions={[
            { label: '暂不更新', disabled: pending, onClick: () => void decide('dismiss') },
            {
              label: '更新',
              tone: 'primary',
              busy: pending,
              onClick: () => void decide('update'),
            },
          ]}
        >
          {note && <p>更新说明：{note}</p>}
          <p className="hint">你们的聊天记录、记忆、好感度都不会变</p>
        </Dialog>
      )}
      {overwrite && (
        <AlertDialog
          title="你对 TA 的修改会被覆盖"
          message="更新后，你改过的人设内容会换成作者的新版本，不能恢复。"
          confirmLabel="仍然更新"
          onCancel={() => setOverwrite(false)}
          onConfirm={() => {
            setOverwrite(false);
            void decide('update', true);
          }}
        />
      )}
    </>
  );
}

/** 3.1（积压 ㊱）：作品页里，我添加过的复制品有新版本时直接「更新到版本 N」。 */
function AdoptedUpdateButton({ characterId, workId }: { characterId: string; workId: string }) {
  const origin = useRemote(CustomCharacterOriginEndpoints.getOrigin, {
    params: { characterId },
    networkOnly: true,
  });
  const [open, setOpen] = useState(false);
  const o = origin.data?.origin;
  if (!o || o.kind !== 'plaza_copy' || o.workId !== workId || !o.newerVersionAvailable) return null;
  const version = o.newerVersionAvailable;
  return (
    <>
      <button onClick={() => setOpen(true)}>更新到版本 {version}</button>
      {open && (
        <NewVersionSheet
          characterId={characterId}
          workId={workId}
          version={version}
          onClose={(done) => {
            setOpen(false);
            if (done) origin.refresh();
          }}
        />
      )}
    </>
  );
}

/** 复制来的自定义角色：资料页「来自人设广场 · 作者 XX · 版本 N」与「作者发布了新版本 ●」。 */
export function PlazaOriginNote({ characterId }: { characterId: string }) {
  const origin = useRemote(CustomCharacterOriginEndpoints.getOrigin, {
    params: { characterId },
    networkOnly: true,
  });
  const [open, setOpen] = useState(false);
  const o = origin.data?.origin;
  if (!o || o.kind !== 'plaza_copy') return null;
  const author = o.authorDeleted ? '已注销用户' : o.authorName;
  const text = `来自人设广场 · 作者 ${author} · 版本 ${o.version}`;
  return (
    <>
      {o.workAvailable ? (
        <Link className="source-note" to={`/plaza/works/${o.workId}`}>
          {text} ›
        </Link>
      ) : (
        <span className="source-note">{text}</span>
      )}
      {o.newerVersionAvailable && (
        <button className="persona-update" onClick={() => setOpen(true)}>
          作者发布了新版本 <span className="red-dot" />
        </button>
      )}
      {open && o.newerVersionAvailable && (
        <NewVersionSheet
          characterId={characterId}
          workId={o.workId}
          version={o.newerVersionAvailable}
          onClose={(done) => {
            setOpen(false);
            if (done) origin.refresh();
          }}
        />
      )}
    </>
  );
}

/** 应用了改版的预设角色：补充设定页顶部来源标注 + 新版本提示（版本号与作品当前版本比较）。 */
export function SupplementSourceNote({ characterId }: { characterId: string }) {
  const supplement = useRemote(CharacterSupplementEndpoints.getSupplement, {
    params: { characterId },
    networkOnly: true,
  });
  const source = supplement.data?.plazaSource;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    if (!source) return;
    let active = true;
    void api
      .call(PlazaEndpoints.getWork, { params: { workId: source.workId }, networkOnly: true })
      .then((w) => {
        if (active) setCurrent(w.currentVersion);
      })
      .catch(() => {
        if (active) setCurrent(null);
      });
    return () => {
      active = false;
    };
  }, [source]);
  if (!source) return null;
  const newer = current && current > source.version ? current : null;
  return (
    <>
      <Link className="source-note" to={`/plaza/works/${source.workId}`}>
        来自人设广场 · 作者 {source.authorName} · 版本 {source.version} ›
      </Link>
      {newer && (
        <button className="persona-update" onClick={() => setOpen(true)}>
          作者发布了新版本 <span className="red-dot" />
        </button>
      )}
      {open && newer && (
        <NewVersionSheet
          characterId={characterId}
          workId={source.workId}
          version={newer}
          onClose={(done) => {
            setOpen(false);
            if (done) supplement.refresh();
          }}
        />
      )}
    </>
  );
}
