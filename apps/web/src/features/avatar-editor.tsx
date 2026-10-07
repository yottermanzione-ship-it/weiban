import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { z } from 'zod';
import { MediaEndpoints, MEDIA_LIMITS, type UserMediaPurpose } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { AvatarDialog } from './avatar-dialog.js';
import { useAvatarGesture } from './avatar-gesture.js';
import { friendlyError } from '../data/use-remote.js';
export function AvatarEditor({
  onSaved,
  purpose = 'user_avatar',
  onPendingChange,
  onRestore,
}: {
  onSaved: (mediaId: string) => Promise<void>;
  purpose?: z.infer<typeof UserMediaPurpose>;
  onPendingChange?: (pending: boolean) => void;
  onRestore?: () => void;
}) {
  const { session } = useAuth();
  const owner = session
    ? { userId: session.user.userId, sessionId: session.session.sessionId }
    : null;
  const [choosing, setChoosing] = useState(false);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [dimensions, setDimensions] = useState({ x: 1, y: 1 });
  const gesture = useAvatarGesture({ zoom, x, y }, dimensions, pending, (crop) => {
    setZoom(crop.zoom);
    setX(crop.x);
    setY(crop.y);
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!source) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active || !canvas.current) return;
      if (image.width * image.height > 40_000_000) {
        setError('图片尺寸过大，请选择较小的照片');
        setSource('');
        return;
      }
      setDimensions((old) =>
        old.x === image.width && old.y === image.height ? old : { x: image.width, y: image.height },
      );
      const target = canvas.current;
      const context = target.getContext('2d');
      if (!context) return;
      const scale = (512 / Math.min(image.width, image.height)) * zoom;
      const width = image.width * scale,
        height = image.height * scale;
      context.clearRect(0, 0, 512, 512);
      context.drawImage(
        image,
        (512 - width) / 2 + (x * (width - 512)) / 2,
        (512 - height) / 2 + (y * (height - 512)) / 2,
        width,
        height,
      );
    };
    image.onerror = () => {
      if (active) {
        setError('图片无法读取，请重新选择');
        setSource('');
      }
    };
    image.src = source;
    return () => {
      active = false;
    };
  }, [source, zoom, x, y]);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );
  function select(event: ChangeEvent<HTMLInputElement>) {
    if (pending) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      file.size > MEDIA_LIMITS.imageMaxBytes ||
      !MEDIA_LIMITS.imageMimeTypes.some((mime) => mime === file.type)
    ) {
      setError('请选择10MB以内的JPEG、PNG、WebP或GIF图片');
      return;
    }
    setChoosing(false);
    setSource(URL.createObjectURL(file));
    setZoom(1);
    setX(0);
    setY(0);
    setError('');
    event.target.value = '';
  }
  async function save() {
    if (!canvas.current) return;
    setPending(true);
    onPendingChange?.(true);
    setError('');
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.current!.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('裁剪失败'))),
          'image/png',
        ),
      );
      if (!owner || !api.owns(owner)) throw new ApiFailure('session_changed', '登录状态已改变', 0);
      const media = await api.call(MediaEndpoints.upload, {
        query: { purpose },
        file: blob,
      });
      if (!api.owns(owner)) throw new ApiFailure('session_changed', '登录状态已改变', 0);
      await onSaved(media.mediaId);
      setSource('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
      onPendingChange?.(false);
    }
  }
  return (
    <section className="stack">
      <button type="button" disabled={pending} onClick={() => setChoosing(true)}>
        选择头像
      </button>
      <input
        hidden
        ref={gallery}
        aria-label="头像"
        type="file"
        disabled={pending}
        accept={MEDIA_LIMITS.imageMimeTypes.join(',')}
        onChange={select}
      />
      <input
        hidden
        ref={camera}
        aria-label="拍照"
        type="file"
        capture="user"
        disabled={pending}
        accept={MEDIA_LIMITS.imageMimeTypes.join(',')}
        onChange={select}
      />
      {choosing && (
        <AvatarDialog onDismiss={() => setChoosing(false)}>
          <h2>选择头像来源</h2>
          <button
            type="button"
            onClick={() => {
              setChoosing(false);
              gallery.current?.click();
            }}
          >
            从相册选择
          </button>
          <button
            type="button"
            onClick={() => {
              setChoosing(false);
              camera.current?.click();
            }}
          >
            拍照
          </button>
          {onRestore && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setChoosing(false);
                onRestore();
              }}
            >
              恢复默认头像
            </button>
          )}
          <button type="button" onClick={() => setChoosing(false)}>
            取消
          </button>
        </AvatarDialog>
      )}
      {source && (
        <AvatarDialog crop busy={pending} onDismiss={() => setSource('')}>
          <h2>调整头像</h2>
          <p>拖动调整位置，双指缩放；也可展开精细调整。</p>
          <canvas
            {...gesture}
            className="avatar-crop"
            ref={canvas}
            width={512}
            height={512}
            aria-label="头像裁剪预览"
          />
          <details>
            <summary>精细调整（可选）</summary>
            <div className="stack">
              <label>
                缩放
                <input
                  type="range"
                  disabled={pending}
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
              <label>
                左右位置
                <input
                  type="range"
                  disabled={pending}
                  min="-1"
                  max="1"
                  step="0.01"
                  value={x}
                  onChange={(e) => setX(Number(e.target.value))}
                />
              </label>
              <label>
                上下位置
                <input
                  type="range"
                  disabled={pending}
                  min="-1"
                  max="1"
                  step="0.01"
                  value={y}
                  onChange={(e) => setY(Number(e.target.value))}
                />
              </label>
            </div>
          </details>
          <button type="button" disabled={pending} onClick={() => void save()}>
            完成裁剪并上传
          </button>
          <button type="button" disabled={pending} onClick={() => setSource('')}>
            取消
          </button>
        </AvatarDialog>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
