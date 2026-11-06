import { AuthResponse, PushEndpoints, PushDevice } from '@weiban/contracts';
import { api, localStore } from '../data/client.js';
import { PushOwner } from './owner.js';
import { isAndroidShell } from '../data/shell-files.js';
export async function pausePush(owner: { userId: string; sessionId: string }): Promise<void> {
  await localStore.setOwned(owner, 'push-owner', { ...owner, enabled: false });
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const complete = () => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve();
    };
    const timer = window.setTimeout(complete, 2500);
    channel.port1.onmessage = complete;
    worker.postMessage({ type: 'push.pause', ...owner }, [channel.port2]);
  });
}
async function bind(auth: AuthResponse, subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys?.p256dh || !keys.auth) throw new Error('浏览器推送凭据不可用');
  const device = await api.call(PushEndpoints.registerDevice, {
    body: {
      kind: 'webpush',
      subscription: { endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    },
  });
  const owner = { userId: auth.user.userId, sessionId: auth.session.sessionId };
  if (
    !(await localStore.setOwned(owner, 'push-device', device)) ||
    !(await localStore.setOwned(owner, 'push-owner', { ...owner, enabled: true }))
  )
    throw new Error('登录状态已改变，请重新开启此设备通知');
}
export async function webPushEnabled(): Promise<boolean> {
  if (
    !('serviceWorker' in navigator) ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  )
    return false;
  const auth = AuthResponse.safeParse(await localStore.get('session'));
  const owner = PushOwner.safeParse(await localStore.get('push-owner'));
  if (
    !auth.success ||
    !owner.success ||
    !owner.data.enabled ||
    owner.data.userId !== auth.data.user.userId ||
    owner.data.sessionId !== auth.data.session.sessionId
  )
    return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return !!(await registration?.pushManager?.getSubscription());
}
export async function resumeExistingPush(auth: AuthResponse): Promise<void> {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  )
    return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await bind(auth, subscription);
}
export async function enableWebPush(): Promise<void> {
  assertPushSupport();
  if (Notification.permission === 'denied')
    throw new Error('通知已被浏览器拒绝，请先在网站或系统设置中允许微伴通知，再回来重试');
  // The permission call must precede every await (including local storage and the public key).
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission === 'denied')
    throw new Error('通知已被浏览器拒绝，请先在网站或系统设置中允许微伴通知，再回来重试');
  if (permission !== 'granted') throw new Error('通知尚未允许，可以稍后在这里重试');
  await subscribeWebPush();
}

function assertPushSupport(): void {
  if (isAndroidShell())
    throw new Error('安卓应用暂不支持后台通知；可以使用支持通知的浏览器打开微伴并添加到主屏幕');
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true);
  if (ios && !installed)
    throw new Error('苹果手机需先在浏览器菜单选择“添加到主屏幕”，再从主屏幕打开微伴，才能开启通知');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    throw new Error('此浏览器暂不支持推送通知，请更新系统和浏览器后重试');
}
/**
 * 通知权限已获批后订阅推送（首次进入一次性申请流程用）。
 * 这里不弹权限框；设置页与首次引导都先从用户点击申请，再尝试订阅。
 * 权限获批不等于通知服务已开通，订阅失败必须保留关闭状态。
 */
export async function subscribeWebPush(): Promise<void> {
  assertPushSupport();
  if (Notification.permission !== 'granted') throw new Error('请先允许微伴通知');
  const auth = AuthResponse.parse(await localStore.get('session'));
  const { publicKey } = await api
    .call(PushEndpoints.getVapidPublicKey, { networkOnly: true })
    .catch(() => {
      throw new Error('通知权限已允许，但通知服务暂时不可用，尚未开启通知；请稍后在这里重试');
    });
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(
        atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
        (character) => character.charCodeAt(0),
      ),
    }));
  await bind(auth, subscription);
}
export async function disableWebPush(): Promise<void> {
  const auth = AuthResponse.safeParse(await localStore.get('session'));
  if (auth.success)
    await pausePush({ userId: auth.data.user.userId, sessionId: auth.data.session.sessionId });
  const parsed = PushDevice.safeParse(await localStore.get('push-device'));
  const registration =
    'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  if (parsed.success)
    await api.call(PushEndpoints.unregisterDevice, {
      params: { pushDeviceId: parsed.data.pushDeviceId },
    });
}
