import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { z } from 'zod';
import { MediaEndpoints, MEDIA_LIMITS, type UserMediaPurpose } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { AvatarDialog } from './avatar-dialog.js';
import { ActionSheet } from './shell-kit.js';
import { showToast } from './toast.js';
import { useAvatarGesture } from './avatar-gesture.js';
import { friendlyError } from '../data/use-remote.js';
export function AvatarEditor({
  onSaved,
  purpose = 'user_avatar',
  onPendingChange,
  onRestore,
  label = '头像',
  prominentPicker = false,
  sheet = false,
  onClose,
}: {
  onSaved: (mediaId: string) => Promise<void>;
  purpose?: z.infer<typeof UserMediaPurpose>;
  onPendingChange?: (pending: boolean) => void;
  onRestore?: () => void;
  label?: string;
  /** 仅角色资料「设置头像」弹层：整行选择按钮放大居中；其它入口保持原行样式。 */
  prominentPicker?: boolean;
  /**
   * 2026-10-26 批 U2：直接弹出来源 Action Sheet（拍照 / 从相册选择 / 取消），不渲染「选择头像」行；
   * 取消、选完裁剪上传、放弃裁剪后调用 onClose。点头像即换头像的入口（个人信息、群头像、朋友圈封面）用它。
   */
  sheet?: boolean;
  onClose?(): void;
}) {
  const { session } = useAuth();
  const owner = session
    ? { userId: session.user.userId, sessionId: session.session.sessionId }
    : null;
  const [choosing, setChoosing] = useState(sheet);
  /** 已点「拍照 / 从相册选择」：Action Sheet 关掉不算放弃，等系统选图结果。 */
  const picking = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
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
  const groupUpload = useRef<{ key: string; mediaId: string } | null>(null);
  // 系统选图界面点了取消（浏览器支持 cancel 事件时）：直接弹出模式下整个流程结束
  useEffect(() => {
    if (!sheet) return;
    const inputs = [gallery.current, camera.current];
    const cancel = () => onCloseRef.current?.();
    inputs.forEach((input) => input?.addEventListener('cancel', cancel));
    return () => inputs.forEach((input) => input?.removeEventListener('cancel', cancel));
  }, [sheet]);
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
        if (sheet) {
          showToast('图片无法读取，请重新选择', 2500, 'warning');
          onCloseRef.current?.();
        }
      }
    };
    image.src = source;
    return () => {
      active = false;
    };
  }, [source, zoom, x, y, sheet]);
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
      if (sheet) {
        showToast('请选择10MB以内的JPEG、PNG、WebP或GIF图片', 2500, 'warning');
        onClose?.();
      }
      event.target.value = '';
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
      const uploadKey = JSON.stringify([source, zoom, x, y, owner.userId, owner.sessionId]);
      const media =
        (purpose === 'group_avatar' || purpose === 'moments_cover') &&
        groupUpload.current?.key === uploadKey
          ? { mediaId: groupUpload.current.mediaId }
          : await api.call(MediaEndpoints.upload, { query: { purpose }, file: blob });
      if (purpose === 'group_avatar' || purpose === 'moments_cover')
        groupUpload.current = { key: uploadKey, mediaId: media.mediaId };
      if (!api.owns(owner)) throw new ApiFailure('session_changed', '登录状态已改变', 0);
      await onSaved(media.mediaId);
      groupUpload.current = null;
      setSource('');
      if (sheet) onClose?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
      onPendingChange?.(false);
    }
  }
  const close = () => {
    if (sheet) onClose?.();
  };
  return (
    <section className={sheet ? 'avatar-editor-sheet' : 'stack'}>
      {!sheet && (
        <button
          type="button"
          className={`avatar-choose-row${prominentPicker ? ' avatar-choose-row-sheet' : ''}`}
          disabled={pending}
          onClick={() => setChoosing(true)}
        >
          <span>选择{label}</span>
          <span className="avatar-choose-arrow" aria-hidden>
            ›
          </span>
        </button>
      )}
      <input
        hidden
        ref={gallery}
        aria-label={label}
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
      {/* 26 号 §2：头像来源用微信式 Action Sheet（拍照 / 从相册选择 / 取消），不再是带边框按钮的居中框 */}
      {choosing && (
        <ActionSheet
          onClose={() => {
            setChoosing(false);
            // Action Sheet 先关闭再执行所点的项：等这一轮点击处理完，再判断是不是直接取消
            window.setTimeout(() => {
              if (!picking.current) close();
              picking.current = false;
            }, 0);
          }}
          items={[
            {
              label: '拍照',
              onClick: () => {
                picking.current = true;
                camera.current?.click();
              },
            },
            {
              label: '从相册选择',
              onClick: () => {
                picking.current = true;
                gallery.current?.click();
              },
            },
            ...(onRestore
              ? [
                  {
                    label: `恢复默认${label}`,
                    disabled: pending,
                    onClick: () => onRestore(),
                  },
                ]
              : []),
          ]}
        />
      )}
      {/* 裁剪：全屏黑底（微信），底部「取消 / 完成」 */}
      {source && (
        <AvatarDialog
          label={label}
          crop
          busy={pending}
          onDismiss={() => {
            setSource('');
            close();
          }}
        >
          <h2>调整{label}</h2>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="avatar-crop-tip">拖动调整位置，双指缩放</p>
          <canvas
            {...gesture}
            className="avatar-crop"
            ref={canvas}
            width={512}
            height={512}
            aria-label={`${label}裁剪预览`}
          />
          <details>
            <summary>精细调整</summary>
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
          <div className="avatar-crop-bar">
            <button
              type="button"
              className="avatar-crop-cancel"
              disabled={pending}
              onClick={() => {
                setSource('');
                close();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="primary avatar-crop-done"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void save()}
            >
              {pending ? '正在上传…' : '完成'}
            </button>
          </div>
        </AvatarDialog>
      )}
      {error && !source && !sheet && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
