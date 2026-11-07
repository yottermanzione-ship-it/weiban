import { AuthResponse } from '@weiban/contracts';
import { api, localStore } from '../data/client.js';

type NativeReply = { id: string; ok: boolean; enabled: boolean; reason?: string; route?: string };
declare global {
  interface Window {
    weibanNotifications?: {
      postMessage(message: string): void;
      onmessage: ((event: { data: string }) => void) | null;
    };
  }
}
type NativeBridge = NonNullable<Window['weibanNotifications']>;
const channels = new WeakMap<NativeBridge, Map<string, (reply?: NativeReply) => void>>();
function pendingReplies(bridge: NativeBridge) {
  let pending = channels.get(bridge);
  if (!pending) {
    pending = new Map();
    channels.set(bridge, pending);
    const receiver = pending;
    bridge.onmessage = (event) => {
      try {
        const reply = JSON.parse(event.data) as Partial<NativeReply>;
        if (
          typeof reply.id === 'string' &&
          typeof reply.ok === 'boolean' &&
          typeof reply.enabled === 'boolean'
        )
          receiver.get(reply.id)?.(reply as NativeReply);
      } catch {
        /* Ignore unrelated/malformed native replies. */
      }
    };
  }
  return pending;
}
export async function nativeNoticeRequest(
  type: 'enable' | 'resume' | 'status' | 'disable' | 'check' | 'settings',
  owner?: { userId: string; sessionId: string },
  auth?: AuthResponse,
): Promise<NativeReply> {
  const bridge = window.weibanNotifications;
  if (!bridge)
    throw new Error('请先覆盖安装新版微伴安卓应用，再开启系统通知；仅更新网页无法补齐此功能');
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const pending = pendingReplies(bridge);
    const finish = (reply?: NativeReply) => {
      window.clearTimeout(timer);
      pending.delete(id);
      if (!reply?.ok)
        reject(
          new Error(
            reply?.reason === 'permission'
              ? '系统通知尚未允许，请点“系统通知设置”开启后再试'
              : '通知暂未开启，请检查网络后重试',
          ),
        );
      else resolve(reply);
    };
    const timer = window.setTimeout(() => finish(), 45000);
    pending.set(id, finish);
    try {
      bridge.postMessage(
        JSON.stringify({
          id,
          type,
          ...(owner ? { owner: `${owner.userId}:${owner.sessionId}` } : {}),
          ...(auth ? { auth } : {}),
        }),
      );
    } catch {
      finish();
    }
  });
}
export async function nativeNotificationStatus(): Promise<boolean> {
  const parsed = AuthResponse.safeParse(await localStore.get('session'));
  if (!parsed.success || !window.weibanNotifications) return false;
  const auth = parsed.data;
  return (
    await nativeNoticeRequest('status', {
      userId: auth.user.userId,
      sessionId: auth.session.sessionId,
    })
  ).enabled;
}
export async function activateNativeNotifications(
  auth: AuthResponse,
  resume: boolean,
): Promise<void> {
  const owner = { userId: auth.user.userId, sessionId: auth.session.sessionId };
  if (!api.owns(owner)) return;
  const reply = await nativeNoticeRequest(resume ? 'resume' : 'enable', owner, auth);
  if (!api.owns(owner)) {
    await nativeNoticeRequest('disable', owner);
    return;
  }
  await localStore.setOwned(owner, 'push-owner', { ...owner, enabled: reply.enabled });
  if (
    reply.route &&
    /^\/(?:chat|wallet|models|services|moments|play\/letters|imports|support\/tickets|calls|role-requests)(?:\/[a-zA-Z0-9/-]+)?$/.test(
      reply.route,
    )
  )
    window.location.assign(reply.route);
}
