/*
 * 启动页（U8，总经理 10-27）：绿色启动层写在 index.html，第一帧就有；这里只负责在它显示期间
 * 恢复登录状态、跑启动预加载（app/preload.ts），按真实进度推进度条，准备好后让它淡出。
 * 本组件不画任何东西；启动结束后由 App 卸载，不再订阅聊天状态。
 */
import { useEffect, useRef } from 'react';
import type { LocalSyncState } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { useChat } from '../app/chat.js';
import { finishBoot, setBootProgress } from '../app/boot-splash.js';
import { preloadForBoot } from '../app/preload.js';

/** 登录状态恢复完成时进度条至少到这里；之后的进度按预加载各项完成情况走到 99%。 */
const AFTER_AUTH = 0.35;

export function BootSplash({ onDone }: { onDone(): void }) {
  const auth = useAuth();
  const { state, errorFatal } = useChat();
  const chat = useRef<{
    promise: Promise<LocalSyncState | null>;
    resolve(value: LocalSyncState | null): void;
  } | null>(null);
  if (!chat.current) {
    let resolve!: (value: LocalSyncState | null) => void;
    const promise = new Promise<LocalSyncState | null>((done) => {
      resolve = done;
    });
    chat.current = { promise, resolve };
  }
  // 本机聊天数据读出来（或首次同步完成）即就绪；本机数据坏了就不等，进去由页面提示。
  useEffect(() => {
    if (state.initialized) chat.current?.resolve(state);
    else if (errorFatal) chat.current?.resolve(null);
  }, [state, errorFatal]);
  // 等登录状态恢复时进度条慢慢往前走，不停在原地。
  useEffect(() => {
    if (!auth.loading) return;
    let value = 0;
    const timer = window.setInterval(() => {
      value = Math.min(AFTER_AUTH - 0.02, value + 0.02);
      setBootProgress(value);
    }, 200);
    return () => window.clearInterval(timer);
  }, [auth.loading]);
  const started = useRef(false);
  const userId = auth.session?.user.userId;
  const sessionId = auth.session?.session.sessionId;
  useEffect(() => {
    if (auth.loading || started.current) return;
    started.current = true;
    setBootProgress(AFTER_AUTH);
    performance.mark('weiban:boot-auth');
    void preloadForBoot({
      owner: userId && sessionId ? { userId, sessionId } : null,
      chatReady: chat.current!.promise,
      onProgress: (fraction) => setBootProgress(AFTER_AUTH + (0.99 - AFTER_AUTH) * fraction),
    })
      .then((report) => {
        performance.mark('weiban:boot-ready', { detail: report });
      })
      .catch(() => {})
      .finally(() => {
        finishBoot();
        onDone();
      });
  }, [auth.loading, userId, sessionId, onDone]);
  return null;
}
