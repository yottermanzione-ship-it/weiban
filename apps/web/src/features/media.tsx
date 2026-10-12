import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ImageBroken,
  LinkSimple,
  MusicNotes,
  VideoCamera,
  WarningCircle,
  X,
  CaretLeft,
  CaretRight,
  Phone,
  PhoneX,
} from '@phosphor-icons/react';
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

/** 按接口给的宽高算出占位尺寸（最长边不超过 image-message-max，约 200）。 */
function boxSize(width: number | null, height: number | null, max = 200) {
  if (!width || !height) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
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
async function saveImage(mediaId: string) {
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
          •••
        </button>
      </header>
      <div className="viewer-stage" onClick={onClose}>
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
        <div className="viewer-menu" role="menu">
          {!isIPhone() && <button onClick={() => void saveImage(mediaId)}>保存图片</button>}
          <button onClick={() => void addFavorite(message)}>收藏</button>
          {canAddToStickers(message) && (
            <button onClick={() => void addToStickers(message)}>添加到表情</button>
          )}
          {onDelete && (
            <button
              onClick={() => {
                onDelete(message);
                onClose();
              }}
            >
              删除
            </button>
          )}
          <button onClick={() => setMenu(false)}>取消</button>
        </div>
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
    <a className="link-card" href={content.url} target="_blank" rel="noopener noreferrer">
      <strong>{content.title}</strong>
      <span className="link-card-body">
        {content.description && <small>{content.description}</small>}
        <span className="link-card-cover">
          {content.coverMediaId ? (
            <MediaImg mediaId={content.coverMediaId} />
          ) : (
            <Icon size={24} aria-hidden />
          )}
        </span>
      </span>
      {content.source && <small className="link-card-source">{content.source}</small>}
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
      return '余额不足，通话已结束';
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
  onRedial,
}: {
  content: ContentOf<'call_record'>;
  name?: string;
  onRedial?(): void;
}) {
  const missed =
    content.direction === 'incoming' &&
    ['missed', 'declined', 'cancelled'].includes(content.outcome);
  const Icon = missed ? PhoneX : Phone;
  return (
    <button
      type="button"
      className={`message-bubble call-record ${missed ? 'missed' : ''}`}
      onClick={onRedial}
      disabled={!onRedial}
    >
      <Icon size={16} aria-hidden /> {callRecordText(content, name)}
    </button>
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
  // 宽度随时长增长（60 秒封顶），不跳动。
  const width = `calc(var(--wb-space-10) * 2 + ${Math.min(60, seconds) * 2}px)`;
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
          className={`message-bubble voice-bubble ${playing ? 'playing' : ''}`}
          style={{ width }}
          aria-label={`语音 ${seconds} 秒，${playing ? '暂停' : '播放'}`}
          onClick={() => void player.play(message, next)}
        >
          {failed ? (
            <WarningCircle size={16} className="danger-icon" aria-hidden />
          ) : (
            <span className="voice-wave" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}
          <span className="numeric">{seconds}″</span>
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
  return (
    <>
      <button
        type="button"
        className={`hold-to-talk ${state !== 'idle' ? 'active' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current = true;
          void start(e.clientY);
        }}
        onPointerMove={(e) => {
          if (state === 'idle') return;
          const cancel = startY.current - e.clientY > 60;
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
        {state === 'idle' ? '按住 说话' : '松开 发送'}
      </button>
      {state !== 'idle' && (
        <div className={`record-overlay ${state === 'cancel' ? 'cancel' : ''}`} role="status">
          <span className="voice-wave large" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>
            {state === 'cancel'
              ? '松开手指，取消发送'
              : left <= 10
                ? `还可以说 ${left} 秒`
                : '手指上滑，取消发送'}
          </span>
        </div>
      )}
    </>
  );
}

// ---------- 表情面板 ----------

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
  const [tab, setTab] = useState<string>('mine');
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === 'stickers'
    )
      mine.refresh();
  });
  const pack = packs.data?.items.find((p) => p.packId === tab);
  return (
    <div className="sticker-panel">
      <div className="sticker-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          我的表情
        </button>
        {packs.data?.items.map((p) => (
          <button
            key={p.packId}
            role="tab"
            aria-selected={tab === p.packId}
            onClick={() => setTab(p.packId)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="sticker-grid">
        {tab === 'mine' && (
          <Link className="sticker-cell add" to="/me/stickers" aria-label="管理我的表情">
            ＋
          </Link>
        )}
        {tab === 'mine' &&
          mine.data?.items.map((s) => (
            <button
              key={s.stickerId}
              className="sticker-cell"
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
            className="sticker-cell"
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
      {(packs.error || mine.error) && !packs.data && <p className="hint">表情加载失败</p>}
    </div>
  );
}
