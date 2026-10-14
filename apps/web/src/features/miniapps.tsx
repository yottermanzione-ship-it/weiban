/*
 * 微伴小程序（docs/refactor/02 第 4 节；视觉按 06-old-ui-spec 5.1）：11 个专属功能共用一个外壳。
 * - 外壳：右上胶囊（··· 更多 | ◯ 回到打开前的位置），从底部升起，不显示标签栏。
 * - 入口：发现 › 小程序（主页）、会话列表下拉、聊天「+」› 小程序、聊天信息「和 TA 一起用」。
 * - 最近使用 / 我的小程序只存本机（首版不跨设备同步）；经期日记默认不进最近使用。
 * - 图标：48×48 圆角 12 点缀色方块 + 白色线框图标；慢信直接用原图 mail.png。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OldIcon, OldImage } from './old-icons.js';
import {
  GroupHeader,
  IconTile,
  LongPressMenu,
  MenuGroup,
  MenuRow,
  NavBar,
  Sheet,
  useLongPress,
  type ActionItem,
  type Tint,
} from './shell-kit.js';
import { showToast } from './toast.js';

export interface MiniApp {
  id: string;
  name: string;
  desc: string;
  /** 白色线框图标（old-ui 素材名）；image = 原色图标（慢信）。 */
  icon: string;
  image?: string;
  tint: Tint;
  home: string;
  /** 按 TA：从聊天里打开时直接进入当前 TA 那一页。 */
  taPath?: (characterId: string) => string;
  match: RegExp[];
  /** 用到哪些数据（「关于这个小程序」）。 */
  data: string;
  /** 默认不进入最近使用（经期日记）。 */
  privateByDefault?: boolean;
}

export const miniApps: MiniApp[] = [
  {
    id: 'cards',
    name: '卡册',
    desc: '和 TA 的每一个特别时刻',
    icon: 'drawn/cards',
    tint: 'red',
    home: '/services/cards',
    taPath: (id) => `/characters/${id}/cards`,
    match: [/^\/services\/cards$/, /^\/characters\/[^/]+\/cards$/],
    data: '你和每个 TA 获得的卡片、纪念日与熟悉度',
  },
  {
    id: 'achievements',
    name: '成就',
    desc: '一起走过的里程碑',
    icon: 'wechat/star',
    tint: 'gold',
    home: '/services/achievements',
    match: [/^\/services\/achievements$/],
    data: '你的成就进度',
  },
  {
    id: 'pets',
    name: '宠物',
    desc: '和 TA 一起养一只小家伙',
    icon: 'drawn/paw',
    tint: 'orange',
    home: '/services/pets',
    taPath: (id) => `/pets/with/${id}`,
    match: [/^\/services\/pets$/, /^\/pets(\/|$)/],
    data: '你和 TA 一起养的宠物、互动记录与相册',
  },
  {
    id: 'daily',
    name: '每日一问',
    desc: '每天一个问题，说给 TA 听',
    icon: 'wechat/chat',
    tint: 'gold',
    home: '/play/daily',
    match: [/^\/play\/daily(\/|$)/],
    data: '你的回答，以及你选择发给哪个 TA',
  },
  {
    id: 'wishlist',
    name: '心愿清单',
    desc: '想和 TA 一起做的事',
    icon: 'wechat/check',
    tint: 'green',
    home: '/play/wishlists',
    taPath: (id) => `/play/wishlists/${id}`,
    match: [/^\/play\/wishlists(\/|$)/],
    data: '你和每个 TA 的心愿',
  },
  {
    id: 'letters',
    name: '慢信',
    desc: '写一封慢慢寄到的信',
    icon: 'drawn/letter',
    image: 'wechat/mail.png',
    tint: 'orange',
    home: '/play/letters',
    taPath: (id) => `/play/letters/new?characterId=${id}`,
    match: [/^\/play\/letters(\/|$)/],
    data: '你和 TA 之间的信件',
  },
  {
    id: 'focus',
    name: '陪你专注',
    desc: '让 TA 陪你专心一会儿',
    icon: 'drawn/hourglass',
    tint: 'purple',
    home: '/play/focus',
    taPath: (id) => `/play/focus?characterId=${id}`,
    match: [/^\/play\/focus$/],
    data: '专注时长与陪你的 TA',
  },
  {
    id: 'reminders',
    name: 'TA 的提醒',
    desc: '让 TA 到点叫你',
    icon: 'wechat/bell',
    tint: 'blue',
    home: '/play/reminders',
    taPath: (id) => `/play/reminders/new?characterId=${id}`,
    match: [/^\/play\/reminders(\/|$)/],
    data: '你设置的提醒内容与时间',
  },
  {
    id: 'period',
    name: '经期日记',
    desc: '记录身体，也让 TA 懂你',
    icon: 'drawn/flower',
    tint: 'red',
    home: '/services/period',
    match: [/^\/services\/period(\/|$)/],
    data: '加密保存的经期记录，只有你授权的 TA 知道',
    privateByDefault: true,
  },
  {
    id: 'import',
    name: '导入角色',
    desc: '用聊天记录生成一个 TA',
    icon: 'drawn/import',
    tint: 'cyan',
    home: '/imports',
    match: [/^\/imports(\/|$)/],
    data: '你上传的聊天记录（生成完成后可删除）',
  },
];

export const appById = (id: string) => miniApps.find((app) => app.id === id);
export function miniAppFor(pathname: string): MiniApp | undefined {
  return miniApps.find((app) => app.match.some((pattern) => pattern.test(pathname)));
}

/** 小程序图标（48 圆角 12；聊天信息页一行用 40 圆角 10，由样式缩小）。 */
export function MiniAppIcon({ app }: { app: MiniApp }) {
  return app.image ? (
    <OldImage name={app.image} size={48} className="miniapp-mail" />
  ) : (
    <IconTile icon={app.icon} tint={app.tint} size="lg" />
  );
}

// ---------- 本机偏好：最近使用、我的小程序 ----------

const RECENT = 'weiban:miniapps:recent';
const MINE = 'weiban:miniapps:mine';
const SHOW_PRIVATE = 'weiban:miniapps:show-in-recent';
const HIDE_RECENT = 'weiban:miniapps:hide-in-recent';
const CHANGED = 'weiban:miniapps-changed';
function read(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}
function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 无痕模式等：只在本次会话生效
  }
  window.dispatchEvent(new Event(CHANGED));
}
function excludedFromRecent(app: MiniApp) {
  if (app.privateByDefault) return !(read(SHOW_PRIVATE) ?? []).includes(app.id);
  return (read(HIDE_RECENT) ?? []).includes(app.id);
}
export function recordRecent(app: MiniApp) {
  if (excludedFromRecent(app)) return;
  write(RECENT, [app.id, ...(read(RECENT) ?? []).filter((id) => id !== app.id)].slice(0, 8));
}
function removeRecent(app: MiniApp) {
  write(
    RECENT,
    (read(RECENT) ?? []).filter((id) => id !== app.id),
  );
}
export function useMiniAppPrefs() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((v) => v + 1);
    window.addEventListener(CHANGED, listener);
    window.addEventListener('storage', listener);
    return () => {
      window.removeEventListener(CHANGED, listener);
      window.removeEventListener('storage', listener);
    };
  }, []);
  void revision;
  const recent = (read(RECENT) ?? [])
    .map(appById)
    .filter((app): app is MiniApp => !!app && !excludedFromRecent(app));
  const mineIds = read(MINE) ?? miniApps.map((app) => app.id);
  const mine = mineIds.map(appById).filter((app): app is MiniApp => !!app);
  /** 下拉面板用：全部小程序按用户排好的顺序（「我的小程序」顺序在前，其余按登记顺序接在后面；不能删除）。 */
  const ordered = [...mine, ...miniApps.filter((app) => !mineIds.includes(app.id))];
  const orderedIds = ordered.map((app) => app.id);
  return {
    recent,
    mine,
    ordered,
    /** 下拉面板排序：移到最前。 */
    orderFront(app: MiniApp) {
      write(MINE, [app.id, ...orderedIds.filter((id) => id !== app.id)]);
    },
    /** 下拉面板排序：拖到 target 的位置。 */
    orderMove(app: MiniApp, target: MiniApp) {
      const from = orderedIds.indexOf(app.id);
      const to = orderedIds.indexOf(target.id);
      if (from < 0 || to < 0 || from === to) return;
      const list = orderedIds.filter((id) => id !== app.id);
      list.splice(to, 0, app.id);
      write(MINE, list);
    },
    inMine: (app: MiniApp) => mineIds.includes(app.id),
    toggleMine(app: MiniApp) {
      write(
        MINE,
        mineIds.includes(app.id) ? mineIds.filter((id) => id !== app.id) : [...mineIds, app.id],
      );
    },
    moveToFront(app: MiniApp) {
      write(MINE, [app.id, ...mineIds.filter((id) => id !== app.id)]);
    },
    /** 拖动排序：把 app 放到 target 的位置。 */
    moveTo(app: MiniApp, target: MiniApp) {
      const list = mineIds.filter((id) => id !== app.id);
      const index = list.indexOf(target.id);
      list.splice(index < 0 ? list.length : index, 0, app.id);
      write(MINE, list);
    },
    removeRecent,
    inRecentAllowed: (app: MiniApp) => !excludedFromRecent(app),
    toggleRecentAllowed(app: MiniApp) {
      const key = app.privateByDefault ? SHOW_PRIVATE : HIDE_RECENT;
      const list = read(key) ?? [];
      write(key, list.includes(app.id) ? list.filter((id) => id !== app.id) : [...list, app.id]);
      if (!app.privateByDefault && !list.includes(app.id)) removeRecent(app);
      if (app.privateByDefault && list.includes(app.id)) removeRecent(app);
    },
  };
}

// ---------- 宫格 ----------

export function MiniAppCell({
  app,
  to,
  onPick,
  onMenu,
  wiggle = false,
}: {
  app: MiniApp;
  to?: string;
  onPick?: () => void;
  onMenu?: (at: { x: number; y: number }) => void;
  wiggle?: boolean;
}) {
  const press = useLongPress((at) => onMenu?.(at));
  const body = (
    <>
      <MiniAppIcon app={app} />
      <small>{app.name}</small>
    </>
  );
  const className = `miniapp-cell ${wiggle ? 'wiggle' : ''}`;
  const handlers = onMenu ? press : {};
  return onPick ? (
    <button type="button" className={className} data-app={app.id} onClick={onPick} {...handlers}>
      {body}
    </button>
  ) : (
    <Link className={className} data-app={app.id} to={to ?? app.home} {...handlers}>
      {body}
    </Link>
  );
}

/** 发现 › 小程序（5.1）：搜索条、最近使用横排、我的小程序白卡宫格、「整理」拖动排序。 */
export function MiniAppsHomePage() {
  const prefs = useMiniAppPrefs();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sorting, setSorting] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ActionItem[] } | null>(
    null,
  );
  const dragging = useRef<MiniApp | null>(null);
  const open = (app: MiniApp) => navigate(app.home);
  const hits = query.trim()
    ? miniApps.filter((app) => (app.name + app.desc).includes(query.trim()))
    : null;
  return (
    <main>
      <NavBar
        title="小程序"
        fallback="/discover"
        right={
          !hits && (
            <button
              type="button"
              className="text-button text-action"
              onClick={() => setSorting((v) => !v)}
            >
              {sorting ? '完成' : '整理'}
            </button>
          )
        }
      />
      <div className="search-strip">
        <label className="search-entry">
          <OldIcon name="wechat/search" size={17} />
          <input
            aria-label="搜索小程序"
            placeholder="搜索小程序"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {hits ? (
        <MenuGroup>
          {hits.map((app) => (
            <MenuRow
              key={app.id}
              onClick={() => open(app)}
              icon={app.image ?? app.icon}
              tint={app.tint}
              tile={!app.image}
              image={app.image}
              iconSize={24}
              label={app.name}
              subtitle={app.desc}
            />
          ))}
          {hits.length === 0 && <p className="empty">没有找到小程序</p>}
        </MenuGroup>
      ) : (
        <>
          {prefs.recent.length > 0 && (
            <>
              <GroupHeader>最近使用</GroupHeader>
              <div className="miniapp-recent">
                {prefs.recent.map((app) => (
                  <MiniAppCell key={app.id} app={app} onPick={() => open(app)} />
                ))}
              </div>
            </>
          )}
          <GroupHeader right={sorting ? '按住图标拖到新位置' : undefined}>我的小程序</GroupHeader>
          <div
            className="miniapp-card"
            onPointerUp={(event) => {
              const app = dragging.current;
              dragging.current = null;
              if (!sorting || !app) return;
              const target = (
                document.elementFromPoint(event.clientX, event.clientY) as Element | null
              )?.closest<HTMLElement>('[data-app]')?.dataset.app;
              const to = target ? appById(target) : undefined;
              if (to && to.id !== app.id) prefs.moveTo(app, to);
            }}
          >
            <div className="miniapp-grid">
              {prefs.mine.map((app) => (
                <span
                  key={app.id}
                  onPointerDown={(event) => {
                    if (!sorting) return;
                    event.preventDefault();
                    dragging.current = app;
                  }}
                >
                  <MiniAppCell
                    app={app}
                    wiggle={sorting}
                    onPick={() => !sorting && open(app)}
                    onMenu={
                      sorting
                        ? undefined
                        : (at) =>
                            setMenu({
                              at,
                              items: [
                                { label: '移到最前', onClick: () => prefs.moveToFront(app) },
                                { label: '移出我的小程序', onClick: () => prefs.toggleMine(app) },
                              ],
                            })
                    }
                  />
                </span>
              ))}
            </div>
          </div>
          {prefs.mine.length < miniApps.length && (
            <>
              <GroupHeader>更多小程序</GroupHeader>
              <div className="miniapp-card">
                <div className="miniapp-grid">
                  {miniApps
                    .filter((app) => !prefs.inMine(app))
                    .map((app) => (
                      <MiniAppCell
                        key={app.id}
                        app={app}
                        onPick={() => open(app)}
                        onMenu={(at) =>
                          setMenu({
                            at,
                            items: [
                              { label: '添加到我的小程序', onClick: () => prefs.toggleMine(app) },
                            ],
                          })
                        }
                      />
                    ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
      {menu && <LongPressMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </main>
  );
}

// ---------- 外壳 ----------

/**
 * 小程序外壳：胶囊固定右上（5.1：88×32 白底 + 0.5 线框）。◯ 一步回到打开小程序之前的页面。
 * 进入时的历史位置在挂载时记下；Shell 以 app.id 为 key，换小程序即重新计算。
 */
export function MiniAppFrame({ app, children }: { app: MiniApp; children: ReactNode }) {
  const navigate = useNavigate();
  const [entryIdx] = useState(() => (window.history.state as { idx?: number } | null)?.idx ?? 0);
  const [more, setMore] = useState(false);
  const [about, setAbout] = useState(false);
  const prefs = useMiniAppPrefs();
  useEffect(() => {
    recordRecent(app);
  }, [app]);
  function close() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (entryIdx > 0) navigate(-(idx - entryIdx + 1));
    else navigate('/discover', { replace: true });
  }
  return (
    <div className="miniapp-frame">
      <div className="capsule" role="group" aria-label={`${app.name} 小程序`}>
        <button type="button" aria-label="更多" onClick={() => setMore(true)}>
          <OldIcon name="wechat/more" size={20} />
        </button>
        <i aria-hidden />
        <button type="button" aria-label="关闭小程序" onClick={close}>
          <OldIcon name="drawn/capsule_close" size={20} />
        </button>
      </div>
      {children}
      {more && (
        <MoreSheet
          items={[
            {
              label: prefs.inMine(app) ? '从我的小程序移除' : '添加到我的小程序',
              onClick: () => {
                prefs.toggleMine(app);
                showToast(prefs.inMine(app) ? '已从我的小程序移除' : '已添加到我的小程序');
              },
            },
            {
              label: prefs.inRecentAllowed(app) ? '不在最近使用中显示' : '在最近使用中显示',
              onClick: () => {
                prefs.toggleRecentAllowed(app);
                showToast(prefs.inRecentAllowed(app) ? '不再显示在最近使用' : '会显示在最近使用');
              },
            },
            { label: '关于这个小程序', onClick: () => setAbout(true) },
            { label: '重新进入', onClick: () => navigate(app.home, { replace: true }) },
          ]}
          title={app.name}
          onClose={() => setMore(false)}
        />
      )}
      {about && (
        <Sheet title="关于这个小程序" onClose={() => setAbout(false)}>
          <div className="coming-soon-body">
            <MiniAppIcon app={app} />
            <h2>{app.name}</h2>
            <p>{app.desc}</p>
            <p className="hint">会用到：{app.data}。数据只在微伴里，不会给第三方。</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function MoreSheet({
  title,
  items,
  onClose,
}: {
  title: string;
  items: ActionItem[];
  onClose(): void;
}) {
  return (
    <Sheet title={title} onClose={onClose} closeLabel="取消">
      <MenuGroup>
        {items.map((item, index) => (
          <MenuRow
            key={index}
            label={item.label}
            chevron={false}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          />
        ))}
      </MenuGroup>
    </Sheet>
  );
}

// ---------- 和 TA 一起用 ----------

const taApps = () => miniApps.filter((app) => app.taPath);

/** 聊天「+」› 小程序：半屏（5.1），只列按 TA 的小程序，当前 TA 已选好。 */
export function WithTaSheet({
  characterId,
  name,
  onClose,
}: {
  characterId: string;
  name?: string;
  onClose(): void;
}) {
  const navigate = useNavigate();
  return (
    <Sheet title={`和 ${name ?? 'TA'} 一起用`} onClose={onClose} half>
      <div className="miniapp-grid">
        {taApps().map((app) => (
          <MiniAppCell
            key={app.id}
            app={app}
            onPick={() => {
              onClose();
              navigate(app.taPath!(characterId));
            }}
          />
        ))}
      </div>
      <p className="center">
        <Link className="text-button" to="/miniapps" onClick={onClose}>
          全部小程序 ›
        </Link>
      </p>
    </Sheet>
  );
}

/** 聊天信息页「和 TA 一起用」一行图标（4.5：40×40，最多 5 个，末尾「更多 ›」）。 */
export function WithTaRow({ characterId }: { characterId: string }) {
  return (
    <div className="miniapp-row" aria-label="和 TA 一起用">
      {taApps()
        .slice(0, 5)
        .map((app) => (
          <MiniAppCell key={app.id} app={app} to={app.taPath!(characterId)} />
        ))}
      <Link className="more" to="/miniapps">
        更多 ›
      </Link>
    </div>
  );
}
