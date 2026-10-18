import { useState } from 'react';
import { useParams } from 'react-router-dom';
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
  const [manage, setManage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useStoreRefresh(() => {
    store.refresh();
    mine.refresh();
  });
  async function remove(packId: string) {
    setBusy(true);
    setError('');
    try {
      await api.call(E.removePack, { params: { packId } });
      mine.refresh();
      store.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function move(index: number) {
    const ids = mine.data?.items.map((p) => p.packId) ?? [];
    [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
    setBusy(true);
    setError('');
    try {
      await api.call(E.reorderMyPacks, { body: { packIds: ids } });
      mine.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const list = manage ? mine : store;
  return (
    <main>
      <NavBar
        title={manage ? '我的表情包' : '表情商店'}
        fallback="/me/stickers"
        right={
          <button
            className="text-button text-action"
            onClick={() => setManage(!manage)}
            disabled={busy}
          >
            {manage ? '商店' : '整理'}
          </button>
        }
      />
      {(error || list.error) && (
        <p className="notice-bar" role="alert">
          {error || list.error}
        </p>
      )}
      {list.error && (
        <button className="text-button full" onClick={list.refresh}>
          重试
        </button>
      )}
      {list.loading && !list.data && (
        <p className="empty" role="status">
          正在读取…
        </p>
      )}
      <MenuGroup>
        {list.data?.items.map((p, i) => (
          <div key={p.packId}>
            <MenuRow
              to={p.enabled ? '/sticker-store/' + p.packId : undefined}
              label={p.name}
              subtitle={p.enabled ? p.intro : '已停用，可移除'}
              value={p.added ? '已添加' : '免费'}
            />
            {manage && (
              <div className="actions">
                <button disabled={busy || i === 0} onClick={() => void move(i)}>
                  上移
                </button>
                <button disabled={busy || p.builtIn} onClick={() => void remove(p.packId)}>
                  移除
                </button>
              </div>
            )}
          </div>
        ))}
      </MenuGroup>
      {list.data && !list.data.items.length && (
        <p className="empty">{manage ? '尚未添加表情包' : '暂无上架表情包'}</p>
      )}
      <MenuGroup>
        <MenuRow to="/me/stickers" label="管理单个表情" />
      </MenuGroup>
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
              <button className="sticker-cell" key={s.stickerId} onClick={() => setPreview(s.url)}>
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
