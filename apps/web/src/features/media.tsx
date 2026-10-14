import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ImageBroken,
  LinkSimple,
  MusicNotes,
  VideoCamera,
  X,
  CaretLeft,
  CaretRight,
  OldIcon,
} from './old-icons.js';
import { ActionSheet } from './shell-kit.js';
import { Dialog } from './toast.js';
import {
  LibraryEndpoints,
  MediaEndpoints,
  MediaExtraEndpoints,
  StickerEndpoints,
  type MediaTranscript,
  type Message,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { showToast } from './toast.js';

/*
 * L5 消息组件（media-l5.md；C 4.2）：图片、语音、表情包、链接卡片、通话记录，以及全屏图片查看。
 * 动画只用 opacity / transform；图片原生懒加载；不出现任何「AI 生成」标记。
 */

type ContentOf<T extends string> = Extract<NonNullable<Message['content']>, { type: T }>;

export const isIPhone = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- 图片 ----------

/** 图片气泡尺寸（4.4.5）：最小 80×80，最大 150×150，按原图比例。 */
function boxSize(width: number | null, height: number | null, max = 150, min = 80) {
  if (!width || !height) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(min, Math.round(width * scale)),
    height: Math.max(min, Math.round(height * scale)),
  };
}

export function MediaImg({
  mediaId,
  thumbnail = true,
  alt = '',
  className,
}: {
  mediaId: string;
  thumbnail?: boolean;
  alt?: string;
  className?: string;
}) {
  const media = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const url = thumbnail ? (media.data?.thumbnailUrl ?? media.data?.url) : media.data?.url;
  if (broken || (media.error && !media.data))
    return (
      <button
        type="button"
        className={`media-broken ${className ?? ''}`}
        aria-label="图片损坏，点击重新加载"
        onClick={(event) => {
          event.stopPropagation();
          setBroken(false);
          media.refresh();
        }}
      >
        <ImageBroken size={24} aria-hidden />
      </button>
    );
  return (
    <span className={`media-frame ${className ?? ''}`}>
      {url && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={loaded ? 'loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}

export function ImageBubble({
  content,
  onOpen,
  overlay,
}: {
  content: ContentOf<'image'>;
  onOpen?(): void;
  overlay?: ReactNode;
}) {
  const size = boxSize(content.width, content.height);
  return (
    <button
      type="button"
      className="image-bubble"
      style={{ width: size.width, height: size.height }}
      onClick={onOpen}
      aria-label="查看图片"
    >
      <MediaImg mediaId={content.mediaId} />
      {overlay}
    </button>
  );
}

/** 上传中的本地图片（尺寸已知，不跳动）。 */
export function LocalImageBubble({
  url,
  width,
  height,
  progress,
  failed,
}: {
  url: string;
  width: number | null;
  height: number | null;
  progress: number;
  failed: boolean;
}) {
  const size = boxSize(width, height);
  return (
    <span className="image-bubble" style={{ width: size.width, height: size.height }}>
      <span className="media-frame">
        <img src={url} alt="" className="loaded" />
      </span>
      {(failed || progress < 100) && (
        <span className="upload-scrim">{failed ? '' : `${progress}%`}</span>
      )}
    </span>
  );
}

/** 保存图片：先取最新链接，再下载（网页无法写相册；iPhone 提示长按保存）。 */
export async function saveImage(mediaId: string) {
  try {
    const media = await api.call(MediaEndpoints.getMedia, { params: { mediaId } });
    const response = await fetch(media.url, { credentials: 'omit' });
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `weiban-${mediaId.slice(0, 8)}.${media.mimeType.split('/')[1] ?? 'jpg'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    showToast('已保存');
  } catch {
    showToast('保存失败，请稍后重试');
  }
}

export function canAddToStickers(message: Message): boolean {
  const content = message.content;
  return (
    message.senderKind !== 'user' &&
    !!content &&
    (content.type === 'sticker' ||
      (content.type === 'image' && (content.sizeBytes == null || content.sizeBytes < 1024 * 1024)))
  );
}

export async function addToStickers(message: Message) {
  if (!canAddToStickers(message)) {
    showToast('只有小于 1 MB 的角色图片可以添加到表情');
    return;
  }
  try {
    await api.call(StickerEndpoints.addMySticker, {
      body: {
        from: 'message',
        conversationId: message.conversationId,
        messageId: message.messageId,
      },
    });
    showToast('已添加');
  } catch (e) {
    if (e instanceof ApiFailure && e.code === 'conflict') showToast('已经添加过了');
    else if (e instanceof ApiFailure && e.code === 'limit_reached')
      showToast('表情已满，先在 我 › 表情 里删除一些');
    else showToast(friendlyError(e));
  }
}

export async function addFavorite(message: Message) {
  try {
    await api.call(LibraryEndpoints.addFavorites, {
      body: {
        items: [
          { kind: 'message', conversationId: message.conversationId, messageId: message.messageId },
        ],
      },
    });
    showToast('已收藏');
  } catch (e) {
    showToast(friendlyError(e));
  }
}

/** 全屏图片查看（C 15.2）：会话内所有图片左右切换。 */
export function ImageViewer({
  images,
  index,
  onClose,
  onDelete,
}: {
  images: Message[];
  index: number;
  onClose(): void;
  onDelete?(message: Message): void;
}) {
  const [current, setCurrent] = useState(index);
  const [menu, setMenu] = useState(false);
  const message = images[current];
  const touch = useRef<number | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setCurrent((v) => Math.max(0, v - 1));
      if (event.key === 'ArrowRight') setCurrent((v) => Math.min(images.length - 1, v + 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [images.length, onClose]);
  if (!message || message.content?.type !== 'image') return null;
  const mediaId = message.content.mediaId;
  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-label="查看图片"
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touch.current;
        const end = e.changedTouches[0]?.clientX;
        if (start === null || end === undefined) return;
        if (end - start > 60) setCurrent((v) => Math.max(0, v - 1));
        if (start - end > 60) setCurrent((v) => Math.min(images.length - 1, v + 1));
      }}
    >
      <header>
        <button className="viewer-button" aria-label="关闭" onClick={onClose}>
          <X size={24} />
        </button>
        <span>
          {current + 1} / {images.length}
        </span>
        <button className="viewer-button" aria-label="更多" onClick={() => setMenu((v) => !v)}>
          <OldIcon name="wechat/more" size={24} />
        </button>
      </header>
      <div
        className="viewer-stage"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu(true);
        }}
      >
        <MediaImg key={mediaId} mediaId={mediaId} thumbnail={false} className="viewer-image" />
      </div>
      {current > 0 && (
        <button
          className="viewer-button viewer-prev"
          aria-label="上一张"
          onClick={() => setCurrent(current - 1)}
        >
          <CaretLeft size={24} />
        </button>
      )}
      {current < images.length - 1 && (
        <button
          className="viewer-button viewer-next"
          aria-label="下一张"
          onClick={() => setCurrent(current + 1)}
        >
          <CaretRight size={24} />
        </button>
      )}
      {isIPhone() && <p className="viewer-hint">长按图片保存</p>}
      {menu && (
        <ActionSheet
          onClose={() => setMenu(false)}
          items={[
            ...(!isIPhone() ? [{ label: '保存图片', onClick: () => void saveImage(mediaId) }] : []),
            { label: '收藏', onClick: () => void addFavorite(message) },
            ...(canAddToStickers(message)
              ? [{ label: '添加到表情', onClick: () => void addToStickers(message) }]
              : []),
            ...(onDelete
              ? [
                  {
                    label: '删除',
                    danger: true,
                    onClick: () => {
                      onDelete(message);
                      onClose();
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}

// ---------- 表情包 ----------

export function StickerBubble({ content }: { content: ContentOf<'sticker'> }) {
  return (
    <span className="sticker-bubble">
      <MediaImg mediaId={content.mediaId} thumbnail={false} alt={content.description ?? '表情'} />
    </span>
  );
}

// ---------- 链接卡片 ----------

export function LinkCardBubble({ content }: { content: ContentOf<'link'> }) {
  const Icon =
    content.appHint === 'music'
      ? MusicNotes
      : content.appHint === 'video'
        ? VideoCamera
        : LinkSimple;
  return (
    <a className="wx-card link-card" href={content.url} target="_blank" rel="noopener noreferrer">
      <strong className="wx-card-title">{content.title}</strong>
      <span className="link-card-body">
        {content.description && <small className="wx-card-text">{content.description}</small>}
        <span className="link-card-cover">
          {content.coverMediaId ? (
            <MediaImg mediaId={content.coverMediaId} />
          ) : (
            <Icon size={24} aria-hidden />
          )}
        </span>
      </span>
      <small className="wx-card-source">{content.source || '链接'}</small>
    </a>
  );
}

const urlPattern = /(https?:\/\/[^\s<>"'，。！？、）]+)/g;
/** 文字里的链接自动识别为可点（C 4.1，text.link）。 */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(urlPattern);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} className="text-link" href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

// ---------- 通话记录 ----------

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function callRecordText(content: ContentOf<'call_record'>, name?: string): string {
  switch (content.outcome) {
    case 'completed':
    case 'time_limit':
      return `通话时长 ${formatDuration(content.durationSec)}`;
    case 'insufficient_balance':
      return '积分不足，通话已结束';
    case 'missed':
    case 'declined':
      if (content.direction === 'incoming')
        return isIPhone() && name ? `${name} 给你打过电话` : '未接来电';
      return '对方未接听';
    case 'cancelled':
      return content.direction === 'outgoing' ? '已取消' : '未接来电';
    case 'failed':
      return '通话中断';
    default:
      return '语音通话';
  }
}

export function CallRecordBubble({
  content,
  name,
  mine = false,
  onRedial,
}: {
  content: ContentOf<'call_record'>;
  name?: string;
  mine?: boolean;
  onRedial?(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const missed =
    content.direction === 'incoming' &&
    ['missed', 'declined', 'cancelled'].includes(content.outcome);
  return (
    <>
      <button
        type="button"
        className={`wx-bubble wx-call ${mine ? 'mine' : ''} ${missed ? 'missed' : ''}`}
        onClick={() => onRedial && setConfirm(true)}
        disabled={!onRedial}
      >
        <OldIcon name="drawn/phone" size={18} />
        <span>{callRecordText(content, name)}</span>
      </button>
      {confirm && onRedial && (
        <Dialog
          actions={[
            { label: '取消', onClick: () => setConfirm(false) },
            {
              label: '呼叫',
              primary: true,
              onClick: () => {
                setConfirm(false);
                onRedial();
              },
            },
          ]}
        >
          <p>再次发起语音通话？</p>
        </Dialog>
      )}
    </>
  );
}

// ---------- 语音 ----------

const PLAYED_KEY = 'weiban:voice-played';
function readPlayed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** 全局语音播放器：同时只播一条；播完自动连播紧接着的角色未播放语音（MED-03 第 3 条）。 */
class VoicePlayer {
  playing: string | null = null;
  failed = new Set<string>();
  played = readPlayed();
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  private emit() {
    this.version += 1;
    for (const l of this.listeners) l();
  }
  private markPlayed(id: string) {
    this.played.add(id);
    try {
      localStorage.setItem(PLAYED_KEY, JSON.stringify([...this.played].slice(-2000)));
    } catch {
      // 本机无法保存时红点只在本次显示中消失。
    }
  }
  stop() {
    this.audio?.pause();
    this.audio = null;
    if (this.playing) {
      this.playing = null;
      this.emit();
    }
  }
  async play(message: Message, next: (messageId: string) => Message | undefined) {
    if (message.content?.type !== 'voice') return;
    if (this.playing === message.messageId) {
      this.stop();
      return;
    }
    this.stop();
    const id = message.messageId;
    this.playing = id;
    this.failed.delete(id);
    this.markPlayed(id);
    this.emit();
    try {
      const media = await api.call(MediaEndpoints.getMedia, {
        params: { mediaId: message.content.mediaId },
        networkOnly: true,
      });
      if (this.playing !== id) return;
      const audio = new Audio(media.url);
      this.audio = audio;
      audio.onended = () => {
        if (this.playing !== id) return;
        this.playing = null;
        this.audio = null;
        this.emit();
        const following = next(id);
        if (
          following?.senderKind === 'character' &&
          following.content?.type === 'voice' &&
          following.status === 'normal' &&
          !this.played.has(following.messageId)
        )
          void this.play(following, next);
      };
      audio.onerror = () => this.fail(id);
      await audio.play();
    } catch {
      this.fail(id);
    }
  }
  private fail(id: string) {
    if (this.playing !== id) return;
    this.playing = null;
    this.audio = null;
    this.failed.add(id);
    this.emit();
    showToast('语音加载失败，点击重试');
  }
}
export const voicePlayer = new VoicePlayer();

function useVoicePlayer() {
  useSyncExternalStore(voicePlayer.subscribe, voicePlayer.snapshot);
  return voicePlayer;
}

/** 用户语音转文字结果（随 media.transcript_ready 更新）。 */
export function useTranscript(mediaId: string, enabled: boolean) {
  const [value, setValue] = useState<MediaTranscript | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void api
      .call(MediaExtraEndpoints.getTranscript, { params: { mediaId }, networkOnly: true })
      .then((t) => active && setValue(t))
      .catch(() => active && setValue({ mediaId, status: 'failed', text: null }));
    return () => {
      active = false;
    };
  }, [mediaId, enabled]);
  useUpdates((update) => {
    if (update.type !== 'media.transcript_ready') return;
    const t = (update.data as { transcript?: MediaTranscript } | undefined)?.transcript;
    if (t?.mediaId === mediaId) setValue(t);
  });
  return value;
}

export function VoiceBubble({
  message,
  next,
  showText,
}: {
  message: Message;
  next(messageId: string): Message | undefined;
  showText: boolean;
}) {
  const player = useVoicePlayer();
  const content = message.content as ContentOf<'voice'>;
  const mine = message.senderKind === 'user';
  const transcript = useTranscript(content.mediaId, showText && !content.transcript);
  const playing = player.playing === message.messageId;
  const failed = player.failed.has(message.messageId);
  const unplayed = !mine && !player.played.has(message.messageId);
  const seconds = Math.max(1, Math.round(content.durationMs / 1000));
  // 宽 = 86 + 秒数（1–30 截断）× 4，最小 108、最大 220（4.4.5）。
  const width = Math.max(108, Math.min(220, 86 + Math.min(30, seconds) * 4));
  const text = content.transcript
    ? content.transcript
    : transcript?.status === 'ready'
      ? transcript.text
      : null;
  return (
    <span className="voice-wrap">
      <span className={`voice-line ${mine ? 'mine' : ''}`}>
        <button
          type="button"
          className={`wx-bubble wx-voice ${mine ? 'mine' : ''} ${playing ? 'playing' : ''} ${failed ? 'failed' : ''}`}
          style={{ width }}
          aria-label={`语音 ${seconds} 秒，${playing ? '暂停' : '播放'}`}
          onClick={() => void player.play(message, next)}
        >
          <span className="wx-voice-wave" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="wx-voice-len numeric">{seconds}&apos;&apos;</span>
          {failed && <span className="wx-voice-retry">重试</span>}
        </button>
        {unplayed && <span className="red-dot voice-dot" aria-label="未播放" />}
      </span>
      {showText && (
        <span className="voice-transcript">
          {text ??
            (transcript && transcript.status !== 'pending' ? (
              <span className="hint">无法转换</span>
            ) : (
              <span className="hint">转换中…</span>
            ))}
        </span>
      )}
    </span>
  );
}

/** 本次会话第一次发语音且识别不可用时提示一次（MED-03 第 5 条）。 */
export function useTranscriptUnavailableNotice(conversationMediaIds: Set<string>) {
  const shown = useRef(false);
  useUpdates((update) => {
    if (shown.current || update.type !== 'media.transcript_ready') return;
    const t = (update.data as { transcript?: MediaTranscript } | undefined)?.transcript;
    if (t && t.status === 'unavailable' && conversationMediaIds.has(t.mediaId)) {
      shown.current = true;
      showToast('当前无法识别语音');
    }
  });
}

// ---------- 按住说话 ----------

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

export type RecordResult = { blob: Blob; durationMs: number };

/** 按住说话（C 5.4）：上滑取消，短于 1 秒提示太短，最长 60 秒自动发出。 */
export function HoldToTalk({
  onRecorded,
  onPermissionDenied,
}: {
  onRecorded(result: RecordResult): void;
  onPermissionDenied(): void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'cancel'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const startY = useRef(0);
  const startAt = useRef(0);
  const cancelled = useRef(false);
  const timer = useRef(0);
  const held = useRef(false);
  async function start(y: number) {
    if (recorder.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('当前浏览器不支持录音');
      return;
    }
    startY.current = y;
    cancelled.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onPermissionDenied();
      return;
    }
    // 第一次授权弹框期间用户已经松手：不开始录音。
    if (!held.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      window.clearInterval(timer.current);
      const durationMs = Math.min(60_000, Date.now() - startAt.current);
      recorder.current = null;
      setState('idle');
      setElapsed(0);
      if (cancelled.current) return;
      if (durationMs < 1000) {
        showToast('说话时间太短');
        return;
      }
      onRecorded({ blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), durationMs });
    };
    recorder.current = rec;
    startAt.current = Date.now();
    rec.start();
    setState('recording');
    timer.current = window.setInterval(() => {
      const ms = Date.now() - startAt.current;
      setElapsed(ms);
      if (ms >= 60_000) rec.stop();
    }, 250);
  }
  function finish() {
    held.current = false;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }
  const left = Math.max(0, 60 - Math.floor(elapsed / 1000));
  const active = state !== 'idle';
  return (
    <>
      <button
        type="button"
        className={`wx-hold ${active ? 'active' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current = true;
          // 按下立即开始录音（4.4.9），不等长按判定。
          void start(e.clientY);
        }}
        onPointerMove={(e) => {
          if (state === 'idle') return;
          // 手指离开底部 150 以上进入取消态。
          const cancel = window.innerHeight - e.clientY > 150 || startY.current - e.clientY > 150;
          cancelled.current = cancel;
          setState(cancel ? 'cancel' : 'recording');
        }}
        onPointerUp={finish}
        onPointerCancel={() => {
          cancelled.current = true;
          finish();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {active ? '松开发送' : '按住说话'}
      </button>
      {active && (
        <div className={`wx-record ${state === 'cancel' ? 'cancel' : ''}`} role="status">
          <div className="wx-record-bubble">
            <span className="wx-record-wave" aria-hidden>
              {Array.from({ length: 28 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${-((i * 97) % 760)}ms` }} />
              ))}
            </span>
          </div>
          <p className="wx-record-hint">
            {state === 'cancel'
              ? '松开手指，取消发送'
              : left <= 10
                ? `还可以说 ${left} 秒`
                : '手指上滑，取消发送'}
          </p>
        </div>
      )}
    </>
  );
}

// ---------- 表情面板（4.4.11） ----------

export function StickerPanel({
  onPick,
}: {
  onPick(sticker: {
    stickerId: string;
    source: 'library' | 'user';
    mediaId: string;
    description: string | null;
  }): void;
}) {
  const packs = useRemote(StickerEndpoints.listPacks);
  const mine = useRemote(StickerEndpoints.listMyStickers);
  const [tab, setTab] = useState<string>('preset');
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === 'stickers'
    )
      mine.refresh();
  });
  const firstPack =
    packs.data?.items.find((p) => p.name === '微伴预设表情') ?? packs.data?.items[0];
  const activeTab = tab === 'preset' ? (firstPack?.packId ?? 'mine') : tab;
  const pack = packs.data?.items.find((p) => p.packId === activeTab);
  const builtIn = ['wechat/heart', 'wechat/star'];
  return (
    <div className="wx-sticker">
      <div className="wx-sticker-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-label="我添加的表情"
          aria-selected={activeTab === 'mine'}
          onClick={() => setTab('mine')}
        >
          <OldIcon name="wechat/smile" size={22} />
        </button>
        {packs.data?.items.map((p, index) => (
          <button
            key={p.packId}
            type="button"
            role="tab"
            aria-label={p.name}
            aria-selected={activeTab === p.packId}
            onClick={() => setTab(p.packId)}
          >
            {p.stickers[0] && index >= builtIn.length ? (
              <img src={p.stickers[0].url} alt="" loading="lazy" decoding="async" />
            ) : (
              <OldIcon name={builtIn[index] ?? 'wechat/star'} size={20} />
            )}
          </button>
        ))}
        <Link className="wx-sticker-tab-link" to="/me/stickers" aria-label="添加表情">
          <OldIcon name="wechat/add" size={20} />
        </Link>
        <Link className="wx-sticker-tab-link end" to="/me/stickers" aria-label="我添加的表情">
          <OldIcon name="wechat/more" size={20} />
        </Link>
      </div>
      <div className="wx-sticker-body">
        {tab === 'mine' && <p className="wx-sticker-caption">添加的单个表情</p>}
        <div className="wx-sticker-grid">
          {tab === 'mine' && (
            <Link className="wx-sticker-cell add" to="/me/stickers" aria-label="添加表情">
              <OldIcon name="wechat/add" size={28} />
            </Link>
          )}
          {tab === 'mine' &&
            mine.data?.items.map((s) => (
              <button
                key={s.stickerId}
                type="button"
                className="wx-sticker-cell"
                onClick={() =>
                  onPick({
                    stickerId: s.stickerId,
                    source: 'user',
                    mediaId: s.mediaId,
                    description: null,
                  })
                }
              >
                <img src={s.url} alt="表情" loading="lazy" decoding="async" />
              </button>
            ))}
          {pack?.stickers.map((s) => (
            <button
              key={s.stickerId}
              type="button"
              className="wx-sticker-cell"
              aria-label={s.description}
              onClick={() =>
                onPick({
                  stickerId: s.stickerId,
                  source: 'library',
                  mediaId: s.mediaId,
                  description: s.description,
                })
              }
            >
              <img src={s.url} alt={s.description} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
        {(packs.loading || mine.loading) && !packs.data && (
          <p className="wx-sticker-caption center">加载中…</p>
        )}
        {(packs.error || mine.error) && !packs.data && <p className="hint center">表情加载失败</p>}
      </div>
    </div>
  );
}
