/** 真实插件页面；所有接口为本地模拟，不生成真实二维码、不请求微信、不含用户凭据。 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ChannelEndpoints, type ChannelState, type WechatQrAttempt } from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import { api } from '../../src/data/client.js';
import { PluginsPage } from '../../src/features/plugins.js';
import { ToastHost } from '../../src/features/toast.js';

const characters = Array.from({ length: 48 }, (_, i) => ({
  characterId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  name: `测试角色 ${String(i + 1).padStart(2, '0')}`,
}));
let state: ChannelState = {
  channel: 'wechat',
  name: '微信接入',
  description: '本地组件测试',
  status: 'unbound',
  integration: 'live',
  characterId: null,
  characterName: null,
  accountName: null,
  accountMasked: null,
  boundAt: null,
  lastEventAt: null,
  lastError: null,
  pendingExpiresAt: null,
};
const query = new URLSearchParams(location.search);
if (query.get('channel') === 'qq') state = { ...state, channel: 'qq', name: 'QQ接入' };
if (query.get('channel') === 'weibo') state = { ...state, channel: 'weibo', name: '微博接入' };
if (query.get('bound') === '1')
  state = {
    ...state,
    status: 'active',
    characterId: characters[0]!.characterId,
    characterName: characters[0]!.name,
    accountMasked: 'test****',
    boundAt: '2026-10-28T12:00:00Z',
  };
let attempt: WechatQrAttempt | null = null;
let status: 'wait' | 'expired' | 'confirmed' = 'wait';
let serial = 0;
const fixture = {
  copied: '',
  requests: [] as string[],
  providerStatus(value: typeof status) {
    status = value;
  },
};
Object.assign(window, { wechatFixture: fixture });
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async (value: string) => {
      fixture.copied = value;
    },
  },
});
Object.assign(api, {
  call: async (endpoint: { path: string }, options: { body?: { characterId?: string } } = {}) => {
    fixture.requests.push(endpoint.path);
    if (endpoint === ChannelEndpoints.list) {
      if (state.channel === 'qq' && status === 'confirmed')
        state = { ...state, status: 'active', accountName: '测试QQ机器人' };
      return { items: [state], characters };
    }
    if (endpoint === ChannelEndpoints.qqConnect || endpoint === ChannelEndpoints.qqPairing) {
      serial++;
      const character = characters.find((item) => item.characterId === options.body?.characterId)!;
      state = {
        ...state,
        status: 'pending',
        characterId: character.characterId,
        characterName: character.name,
        pendingExpiresAt: new Date(Date.now() + 300000).toISOString(),
      };
      return {
        binding: state,
        pairingCode: serial.toString(16).toUpperCase().padStart(10, '0'),
        expiresAt: state.pendingExpiresAt,
      };
    }
    if (endpoint === ChannelEndpoints.unbind) {
      state = {
        ...state,
        status: 'unbound',
        characterId: null,
        characterName: null,
        accountMasked: null,
        accountName: null,
        boundAt: null,
      };
      return state;
    }
    if (endpoint === ChannelEndpoints.wechatQr) {
      serial += 1;
      status = 'wait';
      const character = characters.find((item) => item.characterId === options.body?.characterId)!;
      attempt = {
        attemptId: `11111111-1111-4111-8111-${String(serial).padStart(12, '0')}`,
        status: 'wait',
        bindUrl: `https://liteapp.weixin.qq.com/q/test-only?ticket=TEST_ONLY_NOT_A_REAL_TICKET_${serial}`,
        characterId: character.characterId,
        characterName: character.name,
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        lastError: null,
      };
      return attempt;
    }
    if (endpoint === ChannelEndpoints.wechatQrStatus && attempt) {
      if (status === 'confirmed') {
        state = {
          ...state,
          status: 'active',
          characterId: attempt.characterId,
          characterName: attempt.characterName,
          accountName: '测试微信',
          boundAt: new Date().toISOString(),
        };
        return { ...attempt, status, binding: state };
      }
      return { ...attempt, status, lastError: status === 'expired' ? '测试码已过期' : null };
    }
    throw new Error('夹具不支持该接口');
  },
});
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/settings/plugins']}>
    <div className="app-shell">
      <PluginsPage />
      <ToastHost />
    </div>
  </MemoryRouter>,
);
