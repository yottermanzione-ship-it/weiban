/*
 * 设置当前聊天背景（旧版 ChatBackgroundPage 的 Web 落地，3.41）：
 * 9:14 预览 → 从相册选择（先本地预览，再走 media 上传）→ 只写本会话的 backgroundMediaId。
 * 恢复默认 = 把 backgroundMediaId 置空；只影响当前会话，不影响全局主题。
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChatEndpoints, MEDIA_LIMITS } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { prepareImage, uploadMedia } from '../data/upload.js';
import { useMediaUrl } from './avatar-cache.js';
import { MenuGroup, MenuRow, NavBar, SyncPendingState } from './shell-kit.js';
import { showToast } from './toast.js';

export function ChatBackgroundPage() {
  const { conversationId = '' } = useParams();
  const { state } = useChat();
  const conversation = state.conversations.find((item) => item.conversationId === conversationId);
  // 深链接或刷新时本地同步还没跑完，先给加载态，避免误报「会话不存在」
  if (!conversation && !state.initialized)
    return (
      <main className="chat-info-page">
        <NavBar title="聊天背景" fallback="/chat" />
        <SyncPendingState icon="wechat/chat" label="正在读取会话…" />
      </main>
    );
  if (!conversation)
    return (
      <main className="chat-info-page">
        <NavBar title="聊天背景" fallback="/chat" />
        <p className="empty">会话不存在或已被删除</p>
      </main>
    );
  return (
    <BackgroundEditor
      key={conversationId}
      conversationId={conversationId}
      mediaId={conversation.state.backgroundMediaId ?? null}
    />
  );
}

function BackgroundEditor({
  conversationId,
  mediaId,
}: {
  conversationId: string;
  mediaId: string | null;
}) {
  const { synchronize, assertOwner } = useChat();
  const currentUrl = useMediaUrl(mediaId);
  // 选图后先挂本机 blob 预览（刷新即失效，所以只放内存、不落盘），上传成功再换成媒体链接。
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const replacePreview = (next: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPreview(next);
  };
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  async function choose(file: File) {
    if (busy) return;
    if (
      file.size > MEDIA_LIMITS.imageMaxBytes ||
      !(MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(file.type)
    ) {
      setError('请选择10MB以内的JPEG、PNG、WebP或GIF图片');
      return;
    }
    setError('');
    setBusy(true);
    setProgress(null);
    replacePreview(URL.createObjectURL(file));
    try {
      assertOwner();
      const prepared = await prepareImage(file);
      const media = await uploadMedia('chat_background', prepared.blob, {
        onProgress: setProgress,
      });
      assertOwner();
      await api.call(ChatEndpoints.updateState, {
        params: { conversationId },
        body: { backgroundMediaId: media.mediaId },
      });
      await synchronize();
      // 保留本机预览，等会话状态同步到新 mediaId 后由 useMediaUrl 接上，避免闪一下「默认背景」。
      showToast('已设置聊天背景', 2000, 'success');
    } catch (e) {
      replacePreview(null);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function restore() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      assertOwner();
      await api.call(ChatEndpoints.updateState, {
        params: { conversationId },
        body: { backgroundMediaId: null },
      });
      await synchronize();
      replacePreview(null);
      showToast('已恢复默认背景', 2000, 'success');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? currentUrl ?? null;
  return (
    <main className="chat-info-page chat-background-page" aria-busy={busy}>
      <NavBar title="聊天背景" fallback={`/chat/${conversationId}/settings`} />
      <div className={`chat-bg-preview ${shown ? '' : 'is-default'}`}>
        {shown ? <img src={shown} alt="当前聊天背景" /> : <span>默认背景</span>}
      </div>
      <p className="hint" role="status">
        {busy
          ? progress === null
            ? '正在保存…'
            : `正在上传 ${progress}%`
          : '只对这个会话生效，其他聊天仍是默认背景。'}
      </p>
      <MenuGroup>
        <MenuRow label="从相册选择" disabled={busy} onClick={() => picker.current?.click()} />
        {(mediaId || preview) && (
          <MenuRow label="恢复默认背景" disabled={busy} onClick={() => void restore()} />
        )}
      </MenuGroup>
      <input
        hidden
        ref={picker}
        type="file"
        aria-label="选择聊天背景图片"
        accept={MEDIA_LIMITS.imageMimeTypes.join(',')}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void choose(file);
        }}
      />
      {error && (
        <p role="alert" className="notice-bar">
          {error}
        </p>
      )}
    </main>
  );
}
