import { AuthResponse, PushEndpoints, PushDevice } from '@weiban/contracts';
import { api, localStore } from '../data/client.js';
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
  if (!(await localStore.setOwned(owner, 'push-device', device))) return;
  await localStore.setOwned(owner, 'push-owner', { ...owner, enabled: true });
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
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    throw new Error('此浏览器暂不支持推送；iPhone请先添加到主屏幕');
  const auth = AuthResponse.parse(await localStore.get('session'));
  const { publicKey } = await api.call(PushEndpoints.getVapidPublicKey, { networkOnly: true });
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error('请在浏览器设置中允许微伴通知');
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
