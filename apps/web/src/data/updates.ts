import { useEffect, useRef } from 'react';

/**
 * 同步核心（client-core）只处理聊天与通讯录状态；3.0 新增的 message.updated、moments.*、data.changed
 * 由驱动在收到实时帧或补拉页时广播给界面，界面自己重新拉对应接口。
 */
export interface BroadcastUpdate {
  type: string;
  data?: unknown;
}
const EVENT = 'weiban:update';
export function announceUpdate(update: BroadcastUpdate) {
  window.dispatchEvent(new CustomEvent<BroadcastUpdate>(EVENT, { detail: update }));
}
export function useUpdates(handler: (update: BroadcastUpdate) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const listener = (event: Event) => ref.current((event as CustomEvent<BroadcastUpdate>).detail);
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);
}
