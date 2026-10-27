/*
 * 接续上次已准备好的新版本（Service Worker）。只在用户明确刷新（navigation type = reload）时切换；
 * 普通打开不等异步更新，也不在使用中强制刷新打断输入。
 *
 * U8：在渲染应用之前做（绿色启动层还盖着，页面还没发出任何请求），不再放在 React 组件里。
 * 原因：Chrome 收到 SKIP_WAITING 后要先停掉旧 SW 才激活新 SW；停的那十几毫秒里只要页面又经旧 SW
 * 取一个资源，旧 SW 就会被重新拉起、这次激活作废，之后要等旧 SW 闲置超时（约 30 秒，开着开发者工具时
 * 永远不会）才轮到新版。应用一渲染就有一大波图标 / 字体 / 接口请求，在 React 里发 SKIP_WAITING
 * 正好撞上这个窗口（CI account.spec「真实 Service Worker 升级不打断使用」：新 SW 一直 waiting）。
 */

/** 等 Service Worker 注册信息的上限；已受控页面通常几十毫秒内就有。 */
const READY_WAIT_MS = 1000;
/** 发出 SKIP_WAITING 后等新版接管的上限；超时就先用旧版进入，新版下次打开生效。 */
const SWITCH_WAIT_MS = 4000;

/**
 * main.tsx 在渲染应用前等待它：没有待接续的新版本（或没切成）时 resolve，照常渲染；
 * 新版已接管时刷新页面，promise 不再 resolve（不渲染旧版应用）。
 */
export async function adoptWaitingWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const navigation = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  if (navigation?.type !== 'reload' || !navigator.serviceWorker.controller) return;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), READY_WAIT_MS)),
  ]).catch(() => null);
  const waiting = registration?.waiting;
  if (!waiting || !navigator.serviceWorker.controller || document.visibilityState !== 'visible')
    return;
  // 事件协议保留（应用还没渲染，通常没有监听者）：before-update 可登记要先完成的工作，失败时发 update-failed。
  const pending: Promise<void>[] = [];
  window.dispatchEvent(
    new CustomEvent('weiban:before-update', {
      detail: { waitUntil: (work: Promise<void>) => pending.push(work) },
    }),
  );
  await Promise.allSettled(pending);
  const switched = await new Promise<boolean>((resolve) => {
    const container = navigator.serviceWorker;
    const finish = (value: boolean) => {
      window.clearTimeout(timer);
      container.removeEventListener('controllerchange', changed);
      resolve(value);
    };
    const changed = () => finish(true);
    const timer = window.setTimeout(() => finish(false), SWITCH_WAIT_MS);
    container.addEventListener('controllerchange', changed);
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  if (switched) {
    window.location.reload();
    return new Promise<void>(() => {});
  }
  window.dispatchEvent(new Event('weiban:update-failed'));
}
