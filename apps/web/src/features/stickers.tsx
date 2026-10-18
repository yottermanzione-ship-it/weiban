import { useRef, useState, type ChangeEvent } from 'react';
import { MEDIA_LIMITS, StickerEndpoints, USER_STICKER_LIMIT } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { uploadMedia } from '../data/upload.js';
import { MenuGroup, MenuRow, NavBar, Sheet } from './shell-kit.js';
import { showToast } from './toast.js';

/** 我 › 表情（me-and-services.md 1.5；MED-01 第 3 条）：4 列网格、从相册添加、整理（移到最前 / 删除）。 */
export function MyStickersPage() {
  const remote = useRemote(StickerEndpoints.listMyStickers, { networkOnly: true });
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === 'stickers'
    )
      remote.refresh();
  });
  const items = remote.data?.items ?? [];
  async function add(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (
      !(MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(file.type) ||
      file.size > MEDIA_LIMITS.imageMaxBytes
    ) {
      showToast('这张图片无法添加');
      return;
    }
    setPending(true);
    try {
      const media = await uploadMedia('user_sticker', file);
      await api.call(StickerEndpoints.addMySticker, {
        body: { from: 'upload', mediaId: media.mediaId },
      });
      showToast('已添加');
      remote.refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'conflict') showToast('已经添加过了');
      else if (e instanceof ApiFailure && e.code === 'limit_reached')
        showToast('表情已满，先删除一些');
      else showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function moveToFront() {
    const order = [
      ...selected,
      ...items.map((s) => s.stickerId).filter((id) => !selected.includes(id)),
    ];
    setPending(true);
    try {
      await api.call(StickerEndpoints.reorderMyStickers, { body: { stickerIds: order } });
      setSelected([]);
      remote.refresh();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    setPending(true);
    try {
      for (const stickerId of selected)
        await api.call(StickerEndpoints.deleteMySticker, { params: { stickerId } });
      setSelected([]);
      remote.refresh();
    } catch (e) {
      showToast(friendlyError(e));
      remote.refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <NavBar
        title="我添加的表情"
        fallback="/me"
        right={
          <button
            className="text-button text-action"
            disabled={pending || !items.length}
            onClick={() => {
              setEditing((v) => !v);
              setSelected([]);
            }}
          >
            {editing ? '完成' : '整理'}
          </button>
        }
      />
      <MenuGroup>
        <MenuRow to="/sticker-store" label="表情商店与我的表情包" />
      </MenuGroup>
      {remote.loading && !remote.data && (
        <p role="status" className="empty">
          正在读取…
        </p>
      )}
      {remote.error && !remote.data && (
        <div className="empty">
          <p>加载失败</p>
          <button className="text-button" type="button" onClick={remote.refresh}>
            重试
          </button>
        </div>
      )}
      <div className="sticker-grid manage">
        {!editing && (
          <button
            className="sticker-cell add"
            aria-label="从相册添加"
            disabled={pending || items.length >= USER_STICKER_LIMIT}
            onClick={() => input.current?.click()}
          >
            ＋
          </button>
        )}
        {items.map((s) => {
          const checked = selected.includes(s.stickerId);
          return (
            <button
              key={s.stickerId}
              className={`sticker-cell ${checked ? 'checked' : ''}`}
              disabled={pending}
              aria-label={`表情 ${items.indexOf(s) + 1}${editing && checked ? '，已选择' : ''}`}
              aria-pressed={editing ? checked : undefined}
              onClick={() =>
                editing
                  ? setSelected((list) =>
                      checked ? list.filter((id) => id !== s.stickerId) : [...list, s.stickerId],
                    )
                  : setPreview(s.url)
              }
            >
              {editing && (
                <span className="sticker-check" aria-hidden>
                  {checked ? '✓' : ''}
                </span>
              )}
              <img src={s.url} alt="表情" loading="lazy" decoding="async" />
            </button>
          );
        })}
      </div>
      {remote.data && <p className="hint center">共 {items.length} 个</p>}
      {editing && (
        <div className="bottom-bar">
          <button disabled={pending || !selected.length} onClick={() => void moveToFront()}>
            移到最前
          </button>
          <button
            className="danger"
            disabled={pending || !selected.length}
            onClick={() => void remove()}
          >
            删除{selected.length ? `（${selected.length}）` : ''}
          </button>
        </div>
      )}
      {preview && <StickerPreview url={preview} onClose={() => setPreview(null)} />}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void add(e)} />
    </main>
  );
}

/** 两处表情入口共用关闭与键盘行为。 */
export function StickerPreview({ url, onClose }: { url: string; onClose(): void }) {
  return (
    <Sheet title="查看表情" closeLabel="关闭" onClose={onClose}>
      <div className="sticker-preview">
        <img src={url} alt="表情" />
      </div>
    </Sheet>
  );
}
