import { useState } from 'react';
import '../app/stickers.css';
import { Link, useParams } from 'react-router-dom';
import { StickerStoreEndpoints as E } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { StickerPreview } from './stickers.js';
import { MenuGroup, MenuRow, NavBar } from './shell-kit.js';
function useStoreRefresh(refresh: () => void) {
  useUpdates((u) => {
    if (u.type === 'data.changed' && (u.data as { section?: string })?.section === 'stickers')
      refresh();
  });
}
export function StickerStorePage() {
  const store = useRemote(E.listPacks, { networkOnly: true });
  const mine = useRemote(E.listAdded, { networkOnly: true });
  const [manage, setManage] = useState(false);
  const [tab, setTab] = useState<'featured' | 'more'>('featured');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useStoreRefresh(() => {
    store.refresh();
    mine.refresh();
  });
  async function change(packId: string, remove = false) {
    setBusy(true);
    setError('');
    try {
      if (remove) await api.call(E.removePack, { params: { packId } });
      else await api.call(E.addPack, { params: { packId } });
      mine.refresh();
      store.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const list = manage ? mine : store;
  const needle = query.trim().toLocaleLowerCase();
  const shown = (store.data?.items ?? []).filter(
    (p) => !needle || `${p.name} ${p.intro}`.toLocaleLowerCase().includes(needle),
  );
  return (
    <main className="sticker-store-page">
      <NavBar
        title={
          manage ? (
            '我的表情'
          ) : (
            <span className="sticker-store-tabs" role="tablist" aria-label="表情商店分类">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'featured'}
                onClick={() => setTab('featured')}
              >
                精选表情
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'more'}
                onClick={() => setTab('more')}
              >
                更多表情
              </button>
            </span>
          )
        }
        fallback="/me"
        onBack={manage ? () => setManage(false) : undefined}
        right={
          !manage && (
            <button
              type="button"
              className="nav-bar-icon sticker-store-more"
              aria-label="我的表情"
              onClick={() => setManage(true)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="4" cy="10" r="1.6" fill="currentColor" />
                <circle cx="10" cy="10" r="1.6" fill="currentColor" />
                <circle cx="16" cy="10" r="1.6" fill="currentColor" />
              </svg>
            </button>
          )
        }
      />
      {(error || list.error) && (
        <p className="notice-bar" role="alert">
          {error || list.error}
        </p>
      )}
      {list.error && (
        <button type="button" className="text-button full" onClick={list.refresh}>
          重试
        </button>
      )}
      {list.loading && !list.data && (
        <p className="empty" role="status">
          正在读取…
        </p>
      )}
      {manage ? (
        <MenuGroup>
          <MenuRow
            to="/me/stickers"
            label="添加的单个表情"
            leading={
              <span className="sticker-manage-heart" aria-hidden>
                ♡
              </span>
            }
          />
          {mine.data?.items.map((p) => (
            <div key={p.packId} className="sticker-manage-row">
              <MenuRow
                to={p.enabled ? '/sticker-store/' + p.packId : undefined}
                label={p.name}
                chevron={false}
                leading={
                  p.coverUrl ? (
                    <img className="sticker-pack-cover" src={p.coverUrl} alt="" />
                  ) : undefined
                }
                subtitle={p.enabled ? undefined : '已停用，可移除'}
              />
              <div className="sticker-manage-actions">
                <button
                  type="button"
                  disabled={busy || p.builtIn}
                  aria-label={`移除${p.name}`}
                  onClick={() => void change(p.packId, true)}
                >
                  {p.builtIn ? '默认' : '移除'}
                </button>
              </div>
            </div>
          ))}
        </MenuGroup>
      ) : (
        <>
          <div className="sticker-store-search">
            <input
              type="search"
              aria-label="搜索表情包"
              placeholder="搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {shown.length > 0 && (
            <div className="sticker-store-banners" aria-label="表情包推荐">
              {shown.slice(0, 3).map((p) => (
                <Link
                  key={p.packId}
                  to={'/sticker-store/' + p.packId}
                  className="sticker-store-banner"
                >
                  {p.coverUrl && <img src={p.coverUrl} alt="" />}
                  <strong>{p.name}</strong>
                </Link>
              ))}
            </div>
          )}
          <h2 className="sticker-store-heading">{tab === 'featured' ? '精选' : '更多表情'}</h2>
          {tab === 'featured' ? (
            <div className="sticker-store-list">
              {shown.map((p) => (
                <div className="sticker-store-row" key={p.packId}>
                  <Link to={'/sticker-store/' + p.packId} className="sticker-store-row-detail">
                    {p.coverUrl && <img src={p.coverUrl} alt="" />}
                    <span>{p.name}</span>
                  </Link>
                  <button
                    type="button"
                    disabled={busy || p.added}
                    aria-label={`${p.added ? '已添加' : '添加'}${p.name}`}
                    onClick={() => void change(p.packId)}
                  >
                    {p.added ? '已添加' : '添加'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="sticker-store-tiles">
              {shown.map((p) => (
                <Link
                  key={p.packId}
                  to={'/sticker-store/' + p.packId}
                  className="sticker-store-tile"
                >
                  {p.coverUrl && <img src={p.coverUrl} alt="" />}
                  <span>{p.name}</span>
                </Link>
              ))}
            </div>
          )}
          {store.data && !shown.length && (
            <p className="empty">{needle ? '没有找到相关表情包' : '暂无上架表情包'}</p>
          )}
        </>
      )}
    </main>
  );
}
export function StickerStoreDetailPage() {
  const { packId = '' } = useParams();
  return <StickerStoreDetail key={packId} packId={packId} />;
}
function StickerStoreDetail({ packId }: { packId: string }) {
  const remote = useRemote(E.getPack, { params: { packId }, networkOnly: true });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (remote.data?.added) await api.call(E.removePack, { params: { packId } });
      else await api.call(E.addPack, { params: { packId } });
      remote.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const p = remote.data;
  return (
    <main>
      <NavBar title={p?.name ?? '表情包'} fallback="/sticker-store" />
      {(error || remote.error) && (
        <p className="notice-bar" role="alert">
          {error || remote.error}
        </p>
      )}
      {remote.error && (
        <button className="text-button full" onClick={remote.refresh}>
          重试
        </button>
      )}
      {remote.loading && !p && (
        <p className="empty" role="status">
          正在读取表情包…
        </p>
      )}
      {p && (
        <>
          <p className="page-note">{p.intro}</p>
          <div className="page-bottom">
            <button
              className="primary full"
              disabled={busy || p.builtIn || (!p.enabled && !p.added)}
              onClick={() => void toggle()}
            >
              {busy
                ? '正在处理…'
                : p.builtIn
                  ? '默认表情包'
                  : p.added
                    ? '移除表情包'
                    : !p.enabled
                      ? '已停用'
                      : '免费添加'}
            </button>
          </div>
          <div className="sticker-grid manage">
            {p.stickers.map((s) => (
              <button
                className="sticker-cell"
                key={s.stickerId}
                aria-label={`查看${s.description || '表情'}`}
                onClick={() => setPreview(s.url)}
              >
                <img src={s.url} alt={s.description ?? '表情'} />
              </button>
            ))}
          </div>
        </>
      )}
      {preview && <StickerPreview url={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
