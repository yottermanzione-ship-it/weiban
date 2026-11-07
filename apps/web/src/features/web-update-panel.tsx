import { useEffect, useState } from 'react';
import {
  consumeWebRefreshResult,
  readDeployedWebBuild,
  refreshToLatestWeb,
} from '../app/manual-update.js';
import { MenuGroup, MenuRow } from './shell-kit.js';
import { Dialog } from './toast.js';

export function WebUpdatePanel() {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    try {
      const result = consumeWebRefreshResult(__WEB_BUILD__);
      if (result) setStatus(result);
    } catch {
      /* Storage may be unavailable; update checking still works. */
    }
  }, []);
  async function check() {
    setBusy(true);
    setStatus('正在检查实际部署的网页版本…');
    try {
      const latest = await readDeployedWebBuild();
      setStatus(
        latest.versionCode === __WEB_BUILD__
          ? '当前网页已是最新版本'
          : `发现可用网页版本 ${latest.version}（${latest.versionCode}），可刷新使用`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '检查更新失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setConfirm(false);
    setBusy(true);
    setStatus('正在下载新版并保存本机消息…');
    try {
      await refreshToLatestWeb();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '更新失败，请稍后重试');
      setBusy(false);
    }
  }
  return (
    <>
      <MenuGroup>
        <MenuRow label="检查更新" disabled={busy} onClick={() => void check()} />
        <MenuRow label="更新版本" disabled={busy} onClick={() => setConfirm(true)} />
      </MenuGroup>
      <p className="hint">更新页面内容后保留登录与聊天。安卓系统功能升级仍需安装新版应用。</p>
      {status && <p role="status">{status}</p>}
      {confirm && (
        <Dialog
          title="更新版本"
          actions={[
            { label: '取消', onClick: () => setConfirm(false) },
            { label: '立即更新', tone: 'primary', onClick: () => void refresh() },
          ]}
        >
          <p>
            将重新打开当前页面，保留登录和已保存的聊天记录。请先完成正在编辑的内容；通话或录音中请稍后再刷新。
          </p>
        </Dialog>
      )}
    </>
  );
}
