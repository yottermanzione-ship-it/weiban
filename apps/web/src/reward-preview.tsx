import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { IdentityEndpoints } from '@weiban/contracts';
import { api } from './data/client.js';
import { RewardCheckInPage } from './features/reward-checkin.js';
import './app/tokens.css';
import './app/styles.css';
import './app/shell.css';
import './app/old-ui.css';
const root = createRoot(document.getElementById('root')!);
async function openPreview() {
  if (
    !import.meta.env.DEV ||
    import.meta.env.MODE !== 'admin-preview' ||
    location.hostname !== '127.0.0.1'
  )
    throw new Error('请通过本机预览地址打开');
  const existing = await api.restore();
  if (
    !existing ||
    existing.user.username !== 'demo_user_1' ||
    !(await api.call(IdentityEndpoints.me, { networkOnly: true }).catch(() => null))
  ) {
    const auth = await api.call(IdentityEndpoints.login, {
      body: {
        username: 'demo_user_1',
        password: 'weiban-preview-local',
        kind: 'app',
        device: {
          platform: 'web',
          name: '本地签到预览',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      },
    });
    await api.authenticate(auth);
  }
  root.render(
    <BrowserRouter>
      <RewardCheckInPage standalone />
    </BrowserRouter>,
  );
}
root.render(<p>正在打开示例钱包…</p>);
void openPreview().catch((e: Error) => root.render(<p role="alert">{e.message}</p>));
