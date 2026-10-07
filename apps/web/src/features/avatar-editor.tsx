import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { MediaEndpoints, MEDIA_LIMITS, type UserMediaPurpose } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
export function AvatarEditor({
  onSaved,
  purpose = 'user_avatar',
  onPendingChange,
}: {
  onSaved: (mediaId: string) => Promise<void>;
  purpose?: z.infer<typeof UserMediaPurpose>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { session } = useAuth();
  const owner = session
    ? { userId: session.user.userId, sessionId: session.session.sessionId }
    : null;
  const [source, setSource] = useState('');
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!source) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active || !canvas.current) return;
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
      <label>
        头像
        <input
          type="file"
          accept={MEDIA_LIMITS.imageMimeTypes.join(',')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (
              file.size > MEDIA_LIMITS.imageMaxBytes ||
              !MEDIA_LIMITS.imageMimeTypes.some((mime) => mime === file.type)
            ) {
              setError('请选择10MB以内的JPEG、PNG、WebP或GIF图片');
              return;
            }
            setSource(URL.createObjectURL(file));
            setZoom(1);
            setX(0);
            setY(0);
            setError('');
            event.target.value = '';
          }}
        />
      </label>
      {source && (
        <div className="stack">
          <canvas
            className="avatar-crop"
            ref={canvas}
            width={512}
            height={512}
            aria-label="头像裁剪预览"
          />
          <label>
            缩放
            <input
              type="range"
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
              min="-1"
              max="1"
              step="0.01"
              value={y}
              onChange={(e) => setY(Number(e.target.value))}
            />
          </label>
          <button type="button" disabled={pending} onClick={() => void save()}>
            完成裁剪并上传
          </button>
          <button type="button" onClick={() => setSource('')}>
            取消
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
