/** 开发浏览器夹具：真实 ScenarioSheet / ChatHeading 组件 + 固定情景列表，不连接数据库或真实计费。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CompanionEndpoints, ModelAccessEndpoints } from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import '../../src/app/chat-old.css';
import '../../src/app/scenario.css';
import { AuthProvider } from '../../src/app/auth.js';
import { api } from '../../src/data/client.js';
import type { PlatformPrivateModel } from '../../src/data/platform-private-model.js';
import {
  getLastNormalMode,
  getScenarioBadgeVisible,
  rememberLastNormalMode,
  setScenarioBadgeVisible,
} from '../../src/data/scenario-prefs.js';
import { ChatHeading } from '../../src/features/chat-heading.js';
import { ScenarioSheet } from '../../src/features/scenario.js';
import { ToastHost } from '../../src/features/toast.js';

const modes = [
  {
    id: 'auto',
    name: '自动',
    description: 'TA 看你当下的状态自己调整',
    section: 'preset',
    recommended: true,
    aiReady: true,
  },
  {
    id: 'daily',
    name: '日常聊天',
    description: '像朋友一样聊',
    section: 'preset',
    recommended: false,
    aiReady: true,
  },
  {
    id: 'treehole',
    name: '树洞分享',
    description: '多听少说，不评判',
    section: 'preset',
    recommended: false,
    aiReady: true,
  },
  {
    id: 'tsundere',
    name: '傲娇斗嘴',
    description: '嘴硬心软，爱怼你',
    section: 'preset',
    recommended: false,
    aiReady: true,
  },
  {
    id: 'cheer',
    name: '加油打气',
    description: '给你打气，也会督促你',
    section: 'preset',
    recommended: false,
    aiReady: true,
  },
  {
    id: 'adult',
    name: '私密',
    description: '不可描述的情景',
    section: 'private',
    recommended: false,
    aiReady: true,
  },
];

/** 夹具里模拟平台固定模型；displayMultiplier 按接口约定已含折扣，discountRate 只用于文案。 */
const platformModel: PlatformPrivateModel = {
  modelKey: 'platform/private',
  displayName: '平台私密模型',
  displayMultiplier: 0.6,
  discountRate: 0.5,
  available: true,
};
const noPriceModel: PlatformPrivateModel = {
  ...platformModel,
  displayMultiplier: null,
  discountRate: null,
};

const query = new URLSearchParams(location.search);
const initialMode = query.get('mode') ?? 'auto';
const privateChoice = query.get('private');
const source = query.get('source');
const privateModel =
  privateChoice === 'ready'
    ? platformModel
    : privateChoice === 'nomultiplier'
      ? noPriceModel
      : null;
const apiPrivateStatus = query.get('api') ?? 'available';
const apiPrivateModel: PlatformPrivateModel | null =
  apiPrivateStatus === 'none'
    ? null
    : {
        ...platformModel,
        available: apiPrivateStatus !== 'unavailable',
      };
const lastNormal = query.get('last');
if (lastNormal) rememberLastNormalMode(null, 'character:char-1', lastNormal);

const calls: Array<{ path: string; body?: unknown }> = [];

Object.assign(window, {
  feedbackCalls: calls,
  scenarioFixture: {
    setBadgeFor(userId: string, visible: boolean) {
      setScenarioBadgeVisible(userId, visible);
    },
    getBadgeFor(userId: string) {
      return getScenarioBadgeVisible(userId);
    },
    rememberLastNormal(userId: string, target: string, mode: string) {
      rememberLastNormalMode(userId, target, mode);
    },
    getLastNormal(userId: string, target: string) {
      return getLastNormalMode(userId, target);
    },
  },
});

Object.assign(api, {
  restore: async () => null,
  cached: async () => undefined,
  call: async (endpoint: { path: string }, options: { body?: unknown } = {}) => {
    calls.push({ path: endpoint.path, body: options.body });
    if (endpoint === CompanionEndpoints.listModes) return { items: modes };
    if (endpoint === CompanionEndpoints.updateForCharacter) return {};
    if (endpoint === ModelAccessEndpoints.privateModel) return { model: apiPrivateModel };
    return {};
  },
});

function Harness() {
  const [mode, setMode] = useState(initialMode);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  return (
    <div className="wx-chat">
      <header className="wx-chat-head" data-testid="chat-head">
        <span />
        <ChatHeading
          name="这是一个非常非常长的角色昵称用来测试省略号不会挤掉右侧按钮"
          mode={mode}
          active
          group={false}
          typing={typing}
        />
        <a
          className="nav-bar-icon wx-more"
          href="#more"
          aria-label="聊天信息"
          onClick={(event) => event.preventDefault()}
        >
          ⋯
        </a>
      </header>
      <main style={{ padding: 16 }}>
        <p data-testid="current-mode">{mode}</p>
        <button type="button" data-testid="open-preset" onClick={() => setOpen(true)}>
          打开情景预设
        </button>
        <button type="button" data-testid="toggle-typing" onClick={() => setTyping((v) => !v)}>
          切换输入中
        </button>
      </main>
      {open && (
        <ScenarioSheet
          target={{ kind: 'character', characterId: 'char-1' }}
          current={mode}
          privateModel={source === 'api' ? undefined : privateModel}
          onClose={() => setOpen(false)}
          onChanged={(next) => {
            setMode(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/']}>
    <AuthProvider>
      <ToastHost />
      <Harness />
    </AuthProvider>
  </MemoryRouter>,
);
