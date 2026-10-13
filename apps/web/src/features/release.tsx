/*
 * 公告、本版新功能、强制刷新（契约 3.2；后端说明 docs/backend/announcements.md）。
 * 打开应用与回到前台时拉取；弹窗依次：必须更新（不可关闭）→ 本版新功能 → 未读弹窗公告（从旧到新）。
 * 网页版本号 = 构建号 __WEB_BUILD__（vite.config.ts 注入，每次打包递增）。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  AnnouncementEndpoints,
  ReleaseEndpoints,
  type Announcement,
  type ReleaseNote,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

export const WEB_BUILD = __WEB_BUILD__;
export const WEB_VERSION = __WEB_VERSION__;
const platform = 'web' as const;

// ---------- 公告状态（全局共享，给红点用） ----------

let announcements: Announcement[] = [];
let unread = 0;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
async function loadAnnouncements() {
  const result = await api.call(AnnouncementEndpoints.listAnnouncements, {
    query: { platform },
    networkOnly: true,
  });
  announcements = result.items;
  unread = result.unreadCount;
  emit();
  return result.items;
}
export async function markAnnouncementsRead(ids: string[]) {
  const pending = ids.filter((id) =>
    announcements.some((a) => a.announcementId === id && !a.readAt),
  );
  if (pending.length === 0) return;
  const now = new Date().toISOString();
  announcements = announcements.map((a) =>
    pending.includes(a.announcementId) ? { ...a, readAt: now } : a,
  );
  unread = Math.max(0, unread - pending.length);
  emit();
  await api
    .call(AnnouncementEndpoints.markAnnouncementsRead, { body: { announcementIds: pending } })
    .catch(() => {});
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function useAnnouncementUnread() {
  return useSyncExternalStore(subscribe, () => unread);
}
function useAnnouncementList() {
  return useSyncExternalStore(subscribe, () => announcements);
}

// ---------- 启动检查与弹窗 ----------

type Popup =
  | { kind: 'required'; message: string | null }
  | { kind: 'whatsNew'; notes: ReleaseNote[] }
  | { kind: 'announcement'; item: Announcement };

/** 挂在已登录的 Shell 里。 */
export function ReleaseCenter() {
  const [queue, setQueue] = useState<Popup[]>([]);
  const run = useCallback(async () => {
    const next: Popup[] = [];
    try {
      const check = await api.call(ReleaseEndpoints.checkVersion, {
        query: { platform, versionCode: WEB_BUILD },
        networkOnly: true,
      });
      if (check.updateRequired) next.push({ kind: 'required', message: check.forceUpdateMessage });
    } catch {
      // 检查失败不打扰
    }
    try {
      const notes = await api.call(ReleaseEndpoints.listReleaseNotes, {
        query: { platform, versionCode: WEB_BUILD },
        networkOnly: true,
      });
      if (notes.whatsNew.length > 0) next.push({ kind: 'whatsNew', notes: notes.whatsNew });
    } catch {
      // 同上
    }
    try {
      const items = await loadAnnouncements();
      for (const item of items
        .filter((a) => a.popup && !a.readAt)
        .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)))
        next.push({ kind: 'announcement', item });
    } catch {
      // 同上
    }
    setQueue((current) => {
      const key = (p: Popup) => (p.kind === 'announcement' ? p.item.announcementId : p.kind);
      const seen = new Set(current.map(key));
      return [...current, ...next.filter((p) => !seen.has(key(p)))];
    });
  }, []);
  useEffect(() => {
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [run]);
  const popup = queue[0];
  if (!popup) return null;
  const dismiss = () => setQueue((q) => q.slice(1));
  if (popup.kind === 'required')
    return (
      <Dialog
        title="需要更新到新版本"
        actions={[{ label: '刷新', primary: true, onClick: () => window.location.reload() }]}
      >
        <p className="hint">
          {popup.message ?? '当前版本已停止使用，刷新页面即可更新到最新版本。'}
        </p>
      </Dialog>
    );
  if (popup.kind === 'whatsNew')
    return (
      <Dialog
        title="本版新功能"
        actions={[
          {
            label: '知道了',
            primary: true,
            onClick: () => {
              void api
                .call(ReleaseEndpoints.markReleaseNotesSeen, {
                  body: { platform, versionCode: WEB_BUILD },
                })
                .catch(() => {});
              dismiss();
            },
          },
        ]}
      >
        <div className="announcement-body">
          {popup.notes.map((note) => (
            <section key={note.releaseNoteId} className="release-note">
              <strong>
                {note.version}
                {note.title ? ` · ${note.title}` : ''}
              </strong>
              <p>{note.body}</p>
            </section>
          ))}
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={popup.item.title}
      actions={[
        {
          label: '知道了',
          primary: true,
          onClick: () => {
            void markAnnouncementsRead([popup.item.announcementId]);
            dismiss();
          },
        },
      ]}
    >
      <p className="announcement-body">{popup.item.body}</p>
    </Dialog>
  );
}

// ---------- 页面 ----------

/** 我 › 设置 › 关于微伴。 */
export function AboutPage() {
  const unreadCount = useAnnouncementUnread();
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      const result = await api.call(ReleaseEndpoints.checkVersion, {
        query: { platform, versionCode: WEB_BUILD },
        networkOnly: true,
      });
      if (result.updateAvailable || result.updateRequired) {
        showToast(`发现新版本 ${result.latestVersion ?? ''}，正在刷新…`);
        window.setTimeout(() => window.location.reload(), 800);
      } else showToast('已是最新版本');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setChecking(false);
    }
  }
  return (
    <main>
      <NavBar title="关于微伴" fallback="/settings" />
      <div className="coming-soon-body">
        <img className="brand-logo" src="/assets/old-ui/brand/weiban_logo.png" alt="" />
        <h2>微伴</h2>
        <p className="hint">
          版本 {WEB_VERSION}（构建 {WEB_BUILD}）
        </p>
      </div>
      <MenuGroup>
        <MenuRow to="/settings/announcements" label="公告" dot={unreadCount > 0} />
        <MenuRow to="/settings/release-notes" label="更新日志" />
        <MenuRow onClick={() => void check()} label={checking ? '正在检查…' : '检查更新'} />
      </MenuGroup>
    </main>
  );
}

export function AnnouncementsPage() {
  const items = useAnnouncementList();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void loadAnnouncements()
      .then((list) => {
        setLoaded(true);
        void markAnnouncementsRead(list.filter((a) => !a.readAt).map((a) => a.announcementId));
      })
      .catch((e) => setError(friendlyError(e)));
  }, []);
  return (
    <main>
      <NavBar title="公告" fallback="/settings/about" />
      {error && <p role="alert">{error}</p>}
      {!loaded && !error && <div className="skeleton-row" role="status" />}
      {loaded && items.length === 0 && <p className="empty">暂时没有公告</p>}
      <div className="menu-group">
        {items.map((item) => (
          <article key={item.announcementId} className="announcement-item">
            <strong>
              {item.pinned && <span className="tag">置顶</span>} {item.title}
            </strong>
            <small className="hint">
              {new Date(item.publishedAt).toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </small>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </main>
  );
}

export function ReleaseNotesPage() {
  const notes = useRemote(ReleaseEndpoints.listReleaseNotes, {
    query: { platform, versionCode: WEB_BUILD },
  });
  return (
    <main>
      <NavBar title="更新日志" fallback="/settings/about" />
      {notes.error && <p role="alert">{notes.error}</p>}
      {notes.data?.items.length === 0 && <p className="empty">暂时没有更新日志</p>}
      <div className="menu-group">
        {notes.data?.items.map((note) => (
          <article key={note.releaseNoteId} className="announcement-item">
            <strong>
              {note.version}
              {note.title ? ` · ${note.title}` : ''}
            </strong>
            <small className="hint">{new Date(note.publishedAt).toLocaleDateString('zh-CN')}</small>
            <p>{note.body}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
