import { useEffect } from 'react';
import { BillingEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { showToast } from './toast.js';

/** 消费状态归服务器；本地只保存在途回包，切换账号后不得展示。 */
export function EcologyInsufficientNotice({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}) {
  useEffect(() => {
    const owner = { userId, sessionId };
    let active = true;
    let inFlight = false;
    let lastAttempt = 0;
    let pendingMessage: string | null = null;
    const ready = () =>
      active && api.owns(owner) && document.visibilityState === 'visible' && navigator.onLine;
    const check = async () => {
      if (!ready()) return;
      if (pendingMessage) {
        showToast(pendingMessage, 5000, 'warning');
        pendingMessage = null;
        return;
      }
      if (inFlight || Date.now() - lastAttempt < 5000) return;
      inFlight = true;
      lastAttempt = Date.now();
      try {
        const { notice } = await api.call(BillingEndpoints.consumeEcologyInsufficientNotice, {
          networkOnly: true,
        });
        if (!active || !api.owns(owner) || !notice) return;
        if (document.visibilityState === 'visible') showToast(notice.message, 5000, 'warning');
        else pendingMessage = notice.message;
      } catch {
        // 离线/失效不额外弹错。响应丢失可能漏提醒，采用服务器至多一次语义。
      } finally {
        inFlight = false;
      }
    };
    const resume = () => void check();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    // StrictMode首轮effect清理后不发消费，避免开发模式空耗一次通知。
    void Promise.resolve().then(check);
    return () => {
      active = false;
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [userId, sessionId]);
  return null;
}
