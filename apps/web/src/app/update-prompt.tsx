import { useEffect, useRef, useState } from 'react';
export function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const accepted = useRef(false);
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
      if (accepted.current) window.location.reload();
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
    };
  }, []);
  return waiting ? (
    <div className="update-prompt" role="status">
      <span>新版本已准备好</span>
      <button
        onClick={() => {
          accepted.current = true;
          waiting.postMessage({ type: 'SKIP_WAITING' });
        }}
      >
        更新
      </button>
      <button onClick={() => setWaiting(null)}>稍后</button>
    </div>
  ) : null;
}
