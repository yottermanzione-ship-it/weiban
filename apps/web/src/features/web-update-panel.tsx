import { useEffect, useState } from 'react';
import {
  assertCanRefresh,
  consumeWebRefreshResult,
  readDeployedWebBuild,
  refreshToLatestWeb,
} from '../app/manual-update.js';
import {
  checkAndroidUpdate,
  downloadAndroidUpdate,
  installedAndroidBuild,
  type AndroidPackageUpdate,
} from '../data/android-update.js';
import { MenuGroup, MenuRow } from './shell-kit.js';
import { Dialog, type DialogAction } from './toast.js';

interface CheckedUpdates {
  webMessage: string;
  webAvailable: boolean;
  androidMessage?: string;
  androidAvailable?: AndroidPackageUpdate;
}

export function WebUpdatePanel() {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState('');
  const [checked, setChecked] = useState<CheckedUpdates>();
  const androidBuild = installedAndroidBuild();
  useEffect(() => {
    try {
      const result = consumeWebRefreshResult(__WEB_BUILD__);
      if (result) setStatus(result);
    } catch {
      /* Storage may be unavailable; update checking still works. */
    }
  }, []);
  async function check() {
    setChecked(undefined);
    setBusy(true);
    setStatus('正在检查更新…');
    const [web, android] = await Promise.allSettled([
      readDeployedWebBuild(),
      androidBuild ? checkAndroidUpdate(androidBuild) : Promise.resolve(null),
    ]);
    const webAvailable = web.status === 'fulfilled' && web.value.versionCode !== __WEB_BUILD__;
    const webMessage =
      web.status === 'rejected'
        ? web.reason instanceof Error
          ? web.reason.message
          : '检查更新失败，请重试'
        : webAvailable
          ? `发现可用网页版本 ${web.value.version}（${web.value.versionCode}），可刷新使用`
          : '当前网页已是最新版本';
    setChecked({
      webMessage,
      webAvailable,
      androidMessage:
        android.status === 'fulfilled' ? android.value?.message : '安卓版本检查失败，请稍后重试',
      androidAvailable: android.status === 'fulfilled' ? android.value?.available : undefined,
    });
    setStatus('');
    setBusy(false);
  }
  async function download(update: AndroidPackageUpdate) {
    try {
      assertCanRefresh();
      const bridge = window.weibanAppUpdate;
      if (!bridge) {
        window.location.assign(update.browserUrl);
        return;
      }
      setChecked(undefined);
      setBusy(true);
      setStatus('正在准备下载安卓安装包…');
      await downloadAndroidUpdate(bridge, update, setStatus);
      setStatus('安卓安装包已下载，请在系统界面确认安装');
    } catch (error) {
      setChecked(undefined);
      setStatus(error instanceof Error ? error.message : '安卓安装包下载失败，请重试');
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
  function confirmWebUpdate() {
    setChecked(undefined);
    setStatus('');
    setConfirm(true);
  }
  const closeCheck = () => setChecked(undefined);
  const checkedActions: DialogAction[] = [{ label: '知道了', onClick: closeCheck }];
  if (checked?.webAvailable)
    checkedActions.push({ label: '更新网页', onClick: confirmWebUpdate, tone: 'primary' });
  const androidUpdate = checked?.androidAvailable;
  if (androidUpdate)
    checkedActions.push({
      label: '下载安卓新版',
      onClick: () => void download(androidUpdate),
      tone: 'primary',
    });
  return (
    <>
      <MenuGroup>
        <MenuRow label="检查更新" disabled={busy} onClick={() => void check()} />
        <MenuRow label="更新版本" disabled={busy} onClick={confirmWebUpdate} />
      </MenuGroup>
      <p className="hint">
        {androidBuild
          ? '检查更新可查看网页和安卓安装包的新版本。'
          : '更新网页内容后保留登录与聊天。'}
      </p>
      {status && !confirm && !checked && (
        <Dialog
          title={busy ? '正在处理更新' : '更新提示'}
          actions={busy ? [] : [{ label: '知道了', tone: 'primary', onClick: () => setStatus('') }]}
          onDismiss={busy ? undefined : () => setStatus('')}
        >
          <p role="status">{status}</p>
        </Dialog>
      )}
      {checked && (
        <Dialog title="更新提示" actions={checkedActions} onDismiss={closeCheck}>
          <p role="status">{checked.webMessage}</p>
          {checked.androidMessage && <p>{checked.androidMessage}</p>}
          {androidUpdate && !window.weibanAppUpdate && <p>将用手机浏览器直接下载安装包。</p>}
        </Dialog>
      )}
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
