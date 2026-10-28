import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { contractMismatchNotice } from './contract-version.js';

const CHECK_EVERY_MS = 5 * 60_000;

/** 页面顶部的「请刷新」提示：打开时与每 5 分钟各查一次 /health 的契约版本（失败不提示）。 */
export function VersionBanner() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const check = () => {
      void fetch('/health', { cache: 'no-store', credentials: 'omit' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: unknown) => {
          if (active) setNotice(contractMismatchNotice(body));
        })
        .catch(() => undefined);
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (!notice) return null;
  return <Alert type="warning" showIcon banner style={{ marginBottom: 12 }} message={notice} />;
}
