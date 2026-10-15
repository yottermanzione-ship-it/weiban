import { useEffect } from 'react';
/** 页打开时接续上次已准备的版本；页面使用中发现的新版本等下次刷新，不显示版本提示。 */
export function ServiceWorkerRefresh() {
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    // 只有用户明确刷新才切换，不在普通打开后等待异步更新强制打断输入。
    if (
      (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
        ?.type !== 'reload'
    )
      return;
    const started = Date.now();
    let interacted = false;
    const interaction = () => {
      interacted = true;
    };
    for (const event of ['pointerdown', 'keydown', 'input'])
      document.addEventListener(event, interaction, true);
    const safe = () =>
      !interacted &&
      Date.now() - started < 2000 &&
      document.visibilityState === 'visible' &&
      !(
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches('input,textarea,select,[contenteditable=true]')
      );
    let active = true,
      accepted = false;
    let deadline: number | undefined;
    const changed = () => {
      if (accepted) {
        window.clearTimeout(deadline);
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const waiting = registration.waiting;
        if (!active || !safe() || !waiting || !navigator.serviceWorker.controller) return;
        const pending: Promise<void>[] = [];
        window.dispatchEvent(
          new CustomEvent('weiban:before-update', {
            detail: { waitUntil: (work: Promise<void>) => pending.push(work) },
          }),
        );
        await Promise.allSettled(pending);
        if (!active || !safe()) {
          window.dispatchEvent(new Event('weiban:update-failed'));
          return;
        }
        accepted = true;
        deadline = window.setTimeout(() => {
          accepted = false;
          window.dispatchEvent(new Event('weiban:update-failed'));
        }, 10_000);
        waiting.postMessage({ type: 'SKIP_WAITING' });
      })
      .catch(() => {
        if (active) window.dispatchEvent(new Event('weiban:update-failed'));
      });
    return () => {
      for (const event of ['pointerdown', 'keydown', 'input'])
        document.removeEventListener(event, interaction, true);
      active = false;
      accepted = false;
      window.clearTimeout(deadline);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
    };
  }, []);
  return null;
}
