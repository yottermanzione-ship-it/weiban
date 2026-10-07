import { useEffect, useRef, useState } from 'react';
export function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const accepted = useRef(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const deadline = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    const update = () => {
      if (!registration) return;
      if (registration.waiting) setWaiting(registration.waiting);
      const installing = registration.installing;
      if (installing)
        installing.addEventListener('statechange', () => {
          if (active && installing.state === 'installed' && navigator.serviceWorker.controller)
            setWaiting(registration?.waiting ?? null);
        });
    };
    const changed = () => {
      if (accepted.current) {
        window.clearTimeout(deadline.current);
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    void navigator.serviceWorker.ready.then((value) => {
      if (!active) return;
      registration = value;
      update();
      registration.addEventListener('updatefound', update);
    });
    return () => {
      active = false;
      registration?.removeEventListener('updatefound', update);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      window.clearTimeout(deadline.current);
    };
  }, []);
  return waiting ? (
    <div className="update-prompt" role="status">
      <span>新版本已准备好</span>
      <button
        disabled={updating}
        onClick={() =>
          void (async () => {
            setUpdating(true);
            setError('');
            accepted.current = true;
            const pending: Promise<void>[] = [];
            window.dispatchEvent(
              new CustomEvent('weiban:before-update', {
                detail: { waitUntil: (work: Promise<void>) => pending.push(work) },
              }),
            );
            await Promise.allSettled(pending);
            waiting.postMessage({ type: 'SKIP_WAITING' });
            deadline.current = window.setTimeout(() => {
              accepted.current = false;
              setUpdating(false);
              setError('更新暂未完成，请重试');
              window.dispatchEvent(new Event('weiban:update-failed'));
            }, 10_000);
          })()
        }
      >
        {updating ? '正在更新…' : '更新'}
      </button>
      <button disabled={updating} onClick={() => setWaiting(null)}>
        稍后
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  ) : null;
}
