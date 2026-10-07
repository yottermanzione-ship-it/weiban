import { useState } from 'react';
import { ApiFailure } from '@weiban/client-core';
import { enableWebPush, disableWebPush } from '../notifications/client.js';
export function PushSettings() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function change(enable: boolean) {
    setPending(true);
    setMessage('');
    setError('');
    try {
      if (enable) await enableWebPush();
      else await disableWebPush();
      setMessage(enable ? '已开启此设备通知' : '已关闭此设备通知');
    } catch (e) {
      setError(
        e instanceof ApiFailure
          ? e.message
          : e instanceof Error
            ? e.message
            : '通知设置暂未完成，请重试',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="panel stack">
      <h2>设备通知</h2>
      <p className="hint">只绑定当前登录会话；退出后停止展示和跳转。iPhone需要添加到主屏幕。</p>
      <button disabled={pending} onClick={() => void change(true)}>
        开启此设备通知
      </button>
      <button disabled={pending} onClick={() => void change(false)}>
        关闭此设备通知
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
