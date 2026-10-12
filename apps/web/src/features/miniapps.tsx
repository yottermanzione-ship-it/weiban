/*
 * 微伴小程序（docs/refactor/02 第 4 节）：11 个专属功能共用一个外壳。
 * - 外壳：右上胶囊（··· 更多 | ◯ 回到打开前的位置），从底部升起，不显示标签栏。
 * - 入口：发现 › 小程序（主页）、会话列表下拉、聊天「+」› 小程序、聊天信息「和 TA 一起用」。
 * - 最近使用 / 我的小程序只存本机（首版不跨设备同步）；经期日记默认不进最近使用。
 */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alarm,
  Cards,
  ChatCircleDots,
  Circle,
  DotsThree,
  DownloadSimple,
  EnvelopeSimple,
  FlowerLotus,
  HourglassMedium,
  ListChecks,
  MagnifyingGlass,
  Medal,
  PawPrint,
  UsersThree,
  type IconProps,
} from '@phosphor-icons/react';
import { IconTile, NavBar, Sheet, type Tint } from './shell-kit.js';
import { showToast } from './toast.js';

export interface MiniApp {
  id: string;
  name: string;
  desc: string;
  icon: ComponentType<IconProps>;
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
    icon: Cards,
    tint: 'pink',
    home: '/services/cards',
    taPath: (id) => `/characters/${id}/cards`,
    match: [/^\/services\/cards$/, /^\/characters\/[^/]+\/cards$/],
    data: '你和每个 TA 获得的卡片、纪念日与熟悉度',
  },
  {
    id: 'achievements',
    name: '成就',
    desc: '一起走过的里程碑',
    icon: Medal,
    tint: 'gold',
    home: '/services/achievements',
    match: [/^\/services\/achievements$/],
    data: '你的成就进度',
  },
  {
    id: 'pets',
    name: '宠物',
    desc: '和 TA 一起养一只小家伙',
    icon: PawPrint,
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
    icon: ChatCircleDots,
    tint: 'gold',
    home: '/play/daily',
    match: [/^\/play\/daily(\/|$)/],
    data: '你的回答，以及你选择发给哪个 TA',
  },
  {
    id: 'wishlist',
    name: '心愿清单',
    desc: '想和 TA 一起做的事',
    icon: ListChecks,
    tint: 'teal',
    home: '/play/wishlists',
    taPath: (id) => `/play/wishlists/${id}`,
    match: [/^\/play\/wishlists(\/|$)/],
    data: '你和每个 TA 的心愿',
  },
  {
    id: 'letters',
    name: '慢信',
    desc: '写一封慢慢寄到的信',
    icon: EnvelopeSimple,
    tint: 'lilac',
    home: '/play/letters',
    taPath: (id) => `/play/letters/new?characterId=${id}`,
    match: [/^\/play\/letters(\/|$)/],
    data: '你和 TA 之间的信件',
  },
  {
    id: 'focus',
    name: '陪你专注',
    desc: '让 TA 陪你专心一会儿',
    icon: HourglassMedium,
    tint: 'pink',
    home: '/play/focus',
    taPath: (id) => `/play/focus?characterId=${id}`,
    match: [/^\/play\/focus$/],
    data: '专注时长与陪你的 TA',
  },
  {
    id: 'reminders',
    name: 'TA 的提醒',
    desc: '让 TA 到点叫你',
    icon: Alarm,
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
    icon: FlowerLotus,
    tint: 'pink',
    home: '/services/period',
    match: [/^\/services\/period(\/|$)/],
    data: '加密保存的经期记录，只有你授权的 TA 知道',
    privateByDefault: true,
  },
  {
    id: 'plaza',
    name: '人设广场',
    desc: '看看大家创作的角色',
    icon: UsersThree,
    tint: 'blue',
    home: '/plaza',
    match: [/^\/plaza(\/|$)/],
    data: '你发布、点赞和添加的作品',
  },
  {
    id: 'import',
    name: '导入角色',
    desc: '用聊天记录生成一个 TA',
    icon: DownloadSimple,
    tint: 'teal',
    home: '/imports',
    match: [/^\/imports(\/|$)/],
    data: '你上传的聊天记录（生成完成后可删除）',
  },
];

export const appById = (id: string) => miniApps.find((app) => app.id === id);
export function miniAppFor(pathname: string): MiniApp | undefined {
  return miniApps.find((app) => app.match.some((pattern) => pattern.test(pathname)));
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
  return {
    recent,
    mine,
    inMine: (app: MiniApp) => mineIds.includes(app.id),
    toggleMine(app: MiniApp) {
      write(
        MINE,
        mineIds.includes(app.id) ? mineIds.filter((id) => id !== app.id) : [...mineIds, app.id],
      );
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
}: {
  app: MiniApp;
  to?: string;
  onPick?: () => void;
}) {
  const body = (
    <>
      <IconTile icon={app.icon} tint={app.tint} size="lg" />
      <small>{app.name}</small>
    </>
  );
  return onPick ? (
    <button type="button" className="miniapp-cell" onClick={onPick}>
      {body}
    </button>
  ) : (
    <Link className="miniapp-cell" to={to ?? app.home}>
      {body}
    </Link>
  );
}

/** 搜索 + 最近使用 + 我的小程序（发现 › 小程序与下拉面板共用）。 */
export function MiniAppBrowser({ onOpen }: { onOpen?: (app: MiniApp) => void }) {
  const prefs = useMiniAppPrefs();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const open = (app: MiniApp) => {
    onOpen?.(app);
    navigate(app.home);
  };
  const hits = query.trim()
    ? miniApps.filter((app) => (app.name + app.desc).includes(query.trim()))
    : null;
  return (
    <div className="stack">
      <label className="search-entry">
        <MagnifyingGlass size={16} aria-hidden />
        <input
          aria-label="搜索小程序"
          placeholder="搜索小程序"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {hits ? (
        <div className="miniapp-grid">
          {hits.map((app) => (
            <MiniAppCell key={app.id} app={app} onPick={() => open(app)} />
          ))}
          {hits.length === 0 && <p className="hint">没有找到小程序</p>}
        </div>
      ) : (
        <>
          {prefs.recent.length > 0 && (
            <>
              <h2 className="miniapp-section">最近使用</h2>
              <div className="miniapp-recent">
                {prefs.recent.map((app) => (
                  <MiniAppCell key={app.id} app={app} onPick={() => open(app)} />
                ))}
              </div>
            </>
          )}
          <h2 className="miniapp-section">我的小程序</h2>
          <div className="miniapp-grid">
            {prefs.mine.map((app) => (
              <MiniAppCell key={app.id} app={app} onPick={() => open(app)} />
            ))}
          </div>
          {prefs.mine.length < miniApps.length && (
            <>
              <h2 className="miniapp-section">更多小程序</h2>
              <div className="miniapp-grid">
                {miniApps
                  .filter((app) => !prefs.inMine(app))
                  .map((app) => (
                    <MiniAppCell key={app.id} app={app} onPick={() => open(app)} />
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 发现 › 小程序。 */
export function MiniAppsHomePage() {
  return (
    <main>
      <NavBar title="小程序" fallback="/discover" />
      <MiniAppBrowser />
    </main>
  );
}

// ---------- 外壳 ----------

/**
 * 小程序外壳：胶囊固定右上。◯ 一步回到打开小程序之前的页面（按浏览器历史退回到进入前的那一条）。
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
          <DotsThree size={20} weight="bold" />
        </button>
        <i aria-hidden />
        <button type="button" aria-label="关闭小程序" onClick={close}>
          <Circle size={16} weight="bold" />
        </button>
      </div>
      {children}
      {more && (
        <Sheet title={app.name} onClose={() => setMore(false)} closeLabel="取消">
          <div className="menu-group">
            <button
              type="button"
              className="menu-row"
              onClick={() => {
                prefs.toggleMine(app);
                showToast(prefs.inMine(app) ? '已从我的小程序移除' : '已添加到我的小程序');
                setMore(false);
              }}
            >
              <span className="menu-label">
                {prefs.inMine(app) ? '从我的小程序移除' : '添加到我的小程序'}
              </span>
            </button>
            <button
              type="button"
              className="menu-row"
              onClick={() => {
                prefs.toggleRecentAllowed(app);
                showToast(prefs.inRecentAllowed(app) ? '不再显示在最近使用' : '会显示在最近使用');
                setMore(false);
              }}
            >
              <span className="menu-label">
                {prefs.inRecentAllowed(app) ? '不在最近使用中显示' : '在最近使用中显示'}
              </span>
            </button>
            <button
              type="button"
              className="menu-row"
              onClick={() => {
                setMore(false);
                setAbout(true);
              }}
            >
              <span className="menu-label">关于这个小程序</span>
            </button>
            <button
              type="button"
              className="menu-row"
              onClick={() => {
                setMore(false);
                navigate(app.home, { replace: true });
              }}
            >
              <span className="menu-label">重新进入</span>
            </button>
          </div>
        </Sheet>
      )}
      {about && (
        <Sheet title="关于这个小程序" onClose={() => setAbout(false)}>
          <div className="coming-soon-body">
            <IconTile icon={app.icon} tint={app.tint} size="lg" />
            <h2>{app.name}</h2>
            <p>{app.desc}</p>
            <p className="hint">会用到：{app.data}。数据只在微伴里，不会给第三方。</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---------- 和 TA 一起用 ----------

const taApps = () => miniApps.filter((app) => app.taPath);

/** 聊天「+」› 小程序：半屏，只列按 TA 的小程序，当前 TA 已选好。 */
export function WithTaSheet({ characterId, onClose }: { characterId: string; onClose(): void }) {
  const navigate = useNavigate();
  return (
    <Sheet title="和 TA 一起用" onClose={onClose}>
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
      <Link className="text-button" to="/miniapps" onClick={onClose}>
        全部小程序 ›
      </Link>
    </Sheet>
  );
}

/** 聊天信息页「和 TA 一起用」一行图标。 */
export function WithTaRow({ characterId }: { characterId: string }) {
  return (
    <div className="miniapp-row" aria-label="和 TA 一起用">
      {taApps().map((app) => (
        <MiniAppCell key={app.id} app={app} to={app.taPath!(characterId)} />
      ))}
    </div>
  );
}
