/** Local-only interaction preview. Synthetic characters, no authentication, no API calls or model usage. */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
  ChatCircle,
  Compass,
  UserCircle,
  Users,
  Plus,
  Sparkle,
  SquaresFour,
  Leaf,
  Moon,
  Sun,
} from '@phosphor-icons/react';
import '../../../../docs/design/tokens.css';
import '../../src/app/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import { GuidedTour, type GuidedTourStep } from '../../src/features/guided-tour.js';
import {
  CheckCircle,
  GroupHeader,
  IconTile,
  MenuGroup,
  MenuRow,
  NavBar,
  Sheet,
  SwitchRow,
} from '../../src/features/shell-kit.js';
import { Dialog, ToastHost, showToast } from '../../src/features/toast.js';
import './onboarding-tour.css';

type Screen =
  'conversations' | 'chat' | 'discover' | 'miniapps' | 'cards' | 'me' | 'services' | 'ecology';
type Panel = 'none' | 'plus' | 'scenario' | 'cost';
type ChapterId = 'scenario' | 'miniapps' | 'ecology' | 'ecology-settings';
interface Step extends GuidedTourStep {
  screen: Screen;
  panel?: Panel;
  event?: string;
}
interface Chapter {
  title: string;
  subtitle: string;
  icon: typeof Sparkle;
  steps: Step[];
}
const anchor = (name: string) => `[data-tour-target="${name}"]`;
const chapters: Record<ChapterId, Chapter> = {
  scenario: {
    title: '换一种聊天情景',
    subtitle: '同一个 TA，也可以有不同的聊天方式',
    icon: Sparkle,
    steps: [
      {
        id: 'scenario-chat',
        target: anchor('conversation'),
        screen: 'conversations',
        kind: 'action',
        event: 'open-chat',
        title: '先走进一段聊天',
        description: '点开林舟的会话。这里使用虚构角色和示例内容，不会读取你的账号。',
      },
      {
        id: 'scenario-plus',
        target: anchor('chat-plus'),
        screen: 'chat',
        kind: 'action',
        event: 'open-plus',
        title: '更多功能，藏在这个「＋」里',
        description: '不用离开聊天，也能找到情景预设和一起使用的玩法。点一下试试。',
      },
      {
        id: 'scenario-entry',
        target: anchor('scenario-entry'),
        screen: 'chat',
        panel: 'plus',
        kind: 'action',
        event: 'open-scenario',
        title: '打开「情景预设」',
        description: '想换一种聊天情景，就从这里进入。切换情景不是更换角色。',
      },
      {
        id: 'scenario-options',
        target: anchor('scenario-options'),
        screen: 'chat',
        panel: 'scenario',
        kind: 'read',
        title: '同一个 TA，不同的相处情景',
        description:
          '例如日常聊天、树洞分享。这里只认识入口，不替你选择，也不发送消息；正式页面只展示当前角色可用的选项。',
        nextLabel: '明白了，保持原设置',
      },
      {
        id: 'scenario-close',
        target: anchor('scenario-close'),
        screen: 'chat',
        panel: 'scenario',
        kind: 'action',
        event: 'close-scenario',
        title: '随时可以回来调整',
        description: '点这里关闭面板，回到聊天。以后再点「＋ → 情景预设」就能找到它。',
      },
    ],
  },
  miniapps: {
    title: '发现一起玩的地方',
    subtitle: '认识小程序入口，也学会怎么返回',
    icon: SquaresFour,
    steps: [
      {
        id: 'miniapps-discover',
        target: anchor('nav-discover'),
        screen: 'conversations',
        kind: 'action',
        event: 'open-discover',
        title: '不止聊天，去「发现」看看',
        description: '卡册、宠物和其他玩法集中在这里，不用记住很多入口。',
      },
      {
        id: 'miniapps-entry',
        target: anchor('miniapps-entry'),
        screen: 'discover',
        kind: 'action',
        event: 'open-miniapps',
        title: '这就是「小程序」入口',
        description: '点开后，可以看到微伴内的各种玩法和工具。',
      },
      {
        id: 'miniapps-cards',
        target: anchor('cards-entry'),
        screen: 'miniapps',
        kind: 'action',
        event: 'open-cards',
        title: '先用「卡册」认识一下',
        description: '只打开看看，不领取、不购买，也不要求你现在已经有卡片。',
      },
      {
        id: 'miniapps-close',
        target: anchor('miniapp-close'),
        screen: 'cards',
        kind: 'action',
        event: 'close-miniapp',
        title: '记住这个圆形关闭按钮',
        description: '点它退出小程序，回到刚才的位置。不是退出整个微伴。',
      },
    ],
  },
  ecology: {
    title: '认识 TA 的角色生态',
    subtitle: '先看入口和费用，再自己决定要不要开启',
    icon: Leaf,
    steps: [
      {
        id: 'ecology-me',
        target: anchor('nav-me'),
        screen: 'conversations',
        kind: 'action',
        event: 'open-me',
        title: '先来到「我」',
        description: '自己的服务、积分和设置，都从这里进入。',
      },
      {
        id: 'ecology-services',
        target: anchor('services-entry'),
        screen: 'me',
        kind: 'action',
        event: 'open-services',
        title: '打开「服务」',
        description: '角色生态和模型、积分管理都在这个页面。',
      },
      {
        id: 'ecology-entry',
        target: anchor('ecology-entry'),
        screen: 'services',
        kind: 'action',
        event: 'open-ecology',
        title: '找到「角色生态」',
        description: '让 TA 按设置更新近况，并决定是否主动和你互动。点进去了解一下。',
      },
      {
        id: 'ecology-master',
        target: anchor('ecology-master'),
        screen: 'ecology',
        kind: 'read',
        title: '认识开关，不等于必须开启',
        description:
          '正式功能属于 PRO+，运行会消耗积分。这个教程不会替你开通会员或打开生态；暂不开启，也可以完成学习。',
      },
      {
        id: 'ecology-cost',
        target: anchor('ecology-cost'),
        screen: 'ecology',
        kind: 'read',
        title: '花费要在决定前看清楚',
        description:
          '每次「想一想」和实际行动都会产生积分消耗，积分不足会暂停。先学会入口即可，是否启用由你决定。',
        nextLabel: '了解了，暂不开启',
      },
    ],
  },
  'ecology-settings': {
    title: '看看生态设置',
    subtitle: '仅本地模拟开启，不连接真实服务',
    icon: Leaf,
    steps: [
      {
        id: 'ecology-levels',
        target: anchor('ecology-levels'),
        screen: 'ecology',
        kind: 'read',
        title: '活跃程度影响频率和预计花费',
        description: '不同活跃程度会改变运行频率。引导只说明，不替你切换档位。',
      },
      {
        id: 'ecology-estimate',
        target: anchor('ecology-estimate'),
        screen: 'ecology',
        kind: 'read',
        title: '先看预计每天的积分',
        description:
          '正式页面根据实际设置计算估算值，不是包日承诺。这里展示的是标明了「示例」的模拟数字。',
      },
      {
        id: 'ecology-characters',
        target: anchor('ecology-characters'),
        screen: 'ecology',
        kind: 'read',
        title: '让哪些 TA 参与，由你控制',
        description:
          '可以按角色控制，也可以按动作设置。现在不会替你勾选其他角色，退出引导后可在本地自由试。',
        nextLabel: '学会了，自己试试',
      },
    ],
  },
};
interface Progress {
  id: ChapterId;
  index: number;
}
interface PreviewState {
  screen: Screen;
  panel: Panel;
  active: Progress | null;
  paused: Progress | null;
  completed: ChapterId[];
  done: ChapterId | null;
  enabled: boolean;
}
const STORAGE = 'weiban:onboarding-preview:v1';
const initial: PreviewState = {
  screen: 'conversations',
  panel: 'none',
  active: null,
  paused: null,
  completed: [],
  done: null,
  enabled: false,
};
function restore(): PreviewState {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE) ?? 'null',
    ) as Partial<PreviewState> | null;
    const saved = value?.active ?? value?.paused;
    const paused =
      saved &&
      saved.id in chapters &&
      Number.isInteger(saved.index) &&
      saved.index >= 0 &&
      saved.index < chapters[saved.id].steps.length
        ? saved
        : null;
    return {
      ...initial,
      enabled: value?.enabled === true,
      paused,
      completed: value?.completed?.filter((id) => id in chapters) ?? [],
    };
  } catch {
    return initial;
  }
}
function atStep(state: PreviewState, progress: Progress): PreviewState {
  const step = chapters[progress.id].steps[progress.index]!;
  return {
    ...state,
    active: progress,
    paused: null,
    done: null,
    screen: step.screen,
    panel: step.panel ?? 'none',
  };
}
function nextStep(state: PreviewState): PreviewState {
  if (!state.active) return state;
  const { id, index } = state.active;
  if (index + 1 < chapters[id].steps.length) return atStep(state, { id, index: index + 1 });
  return {
    ...state,
    active: null,
    paused: null,
    panel: 'none',
    done: id,
    completed: [...new Set([...state.completed, id])],
  };
}
const miniapps = [
  { id: 'cards', name: '卡册', icon: 'drawn/cards', tint: 'red' },
  { id: 'achievements', name: '成就', icon: 'wechat/star', tint: 'gold' },
  { id: 'pets', name: '宠物', icon: 'drawn/paw', tint: 'orange' },
  { id: 'daily', name: '每日一问', icon: 'wechat/chat', tint: 'gold' },
  { id: 'wishlist', name: '心愿清单', icon: 'wechat/check', tint: 'green' },
  { id: 'letters', name: '慢信', icon: 'drawn/letter', tint: 'orange' },
  { id: 'focus', name: '陪你专注', icon: 'drawn/hourglass', tint: 'purple' },
  { id: 'reminders', name: 'TA 的提醒', icon: 'wechat/bell', tint: 'blue' },
] as const;
function Preview() {
  const [state, setState] = useState<PreviewState>(restore);
  const [hub, setHub] = useState(true);
  const [dark, setDark] = useState(false);
  const [level, setLevel] = useState(1);
  const [participates, setParticipates] = useState(true);
  const [text, setText] = useState('');
  const [mode, setMode] = useState('日常聊天');
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state));
    } catch {
      /* Preview remains usable without storage. */
    }
  }, [state]);
  useEffect(() => {
    document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
  }, [dark]);
  const active = state.active;
  const step = active ? chapters[active.id].steps[active.index]! : null;
  function start(id: ChapterId, index = 0) {
    setHub(false);
    setState((old) => atStep(old, { id, index }));
  }
  function action(event: string, screen: Screen, panel: Panel = 'none') {
    setState((old) => {
      const updated = { ...old, screen, panel };
      const expected = old.active ? chapters[old.active.id].steps[old.active.index]?.event : null;
      return expected === event ? nextStep(updated) : updated;
    });
  }
  function pause() {
    setState((old) => ({ ...old, paused: old.active ?? old.paused, active: null }));
    showToast('已暂停，可从「？」继续学习', 1800, 'info');
  }
  function reset() {
    setState(initial);
    setLevel(1);
    setParticipates(true);
    setMode('日常聊天');
    setHub(true);
  }
  const help = (
    <button
      type="button"
      className="preview-help"
      aria-label="打开引导中心"
      onClick={() => setHub(true)}
    >
      ?
    </button>
  );
  const avatar = (name: string, alternate = false) => (
    <span className={`preview-avatar ${alternate ? 'alternate' : ''}`} aria-hidden>
      {name.slice(0, 1)}
    </span>
  );
  const heading = (title: string, back?: () => void) => (
    <NavBar title={title} back={!!back} onBack={back} right={help} />
  );
  const demoOnly = () => showToast('本版只演示引导，未连接真实功能', 1800, 'info');
  let page: ReactNode;
  if (state.screen === 'conversations')
    page = (
      <main className="preview-conversations">
        {heading('微伴')}
        <div className="preview-search">搜索</div>
        <button
          type="button"
          className="preview-conversation"
          data-tour-target="conversation"
          onClick={() => action('open-chat', 'chat')}
        >
          {avatar('林舟')}
          <span>
            <strong>林舟</strong>
            <small>今天过得怎么样？想听你说说。</small>
          </span>
          <time>21:30</time>
        </button>
        <button type="button" className="preview-conversation" onClick={demoOnly}>
          {avatar('许言', true)}
          <span>
            <strong>许言</strong>
            <small>给自己留一点慢下来的时间。</small>
          </span>
          <time>昨天</time>
        </button>
        <p className="preview-empty-note">以上均为虚构示例，不是你的真实聊天</p>
      </main>
    );
  else if (state.screen === 'chat')
    page = (
      <main className="preview-chat">
        {heading('林舟', () => action('back-chat', 'conversations'))}
        <div className="preview-chat-body">
          <span className="preview-chat-time">今天 21:30</span>
          <div className="preview-chat-message">
            {avatar('林舟')}
            <p>今天过得怎么样？想听你说说。</p>
          </div>
          <div className="preview-chat-message mine">
            <p>来看看新版微伴有什么新玩法。</p>
            {avatar('你', true)}
          </div>
          <div className="preview-chat-message">
            {avatar('林舟')}
            <p>好呀，慢慢来，我们一起看看。</p>
          </div>
          <span className="preview-chat-disclaimer">本地示例对话 · 没有调用模型</span>
        </div>
        <div className="preview-composer">
          <button type="button" aria-label="语音（预览）" onClick={demoOnly}>
            ◉
          </button>
          <input
            aria-label="示例消息输入框"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="本地预览，不会发送"
          />
          <button type="button" aria-label="表情（预览）" onClick={demoOnly}>
            ☺
          </button>
          <button
            type="button"
            data-tour-target="chat-plus"
            aria-label="更多聊天功能"
            onClick={() => action('open-plus', 'chat', state.panel === 'plus' ? 'none' : 'plus')}
          >
            <Plus size={28} />
          </button>
        </div>
        {state.panel === 'plus' && (
          <div className="preview-plus-grid">
            <button type="button" onClick={demoOnly}>
              <IconTile icon="wechat/album" tint="gray" size="lg" />
              <span>相册</span>
            </button>
            <button type="button" onClick={demoOnly}>
              <IconTile icon="wechat/camera" tint="gray" size="lg" />
              <span>拍摄</span>
            </button>
            <button
              type="button"
              data-tour-target="scenario-entry"
              onClick={() => action('open-scenario', 'chat', 'scenario')}
            >
              <IconTile icon="drawn/scenario_sparkle" tint="green" size="lg" />
              <span>情景预设</span>
            </button>
            <button type="button" onClick={() => action('open-miniapps', 'miniapps')}>
              <IconTile icon="wechat/discover_mini_program" tint="purple" size="lg" />
              <span>小程序</span>
            </button>
          </div>
        )}
      </main>
    );
  else if (state.screen === 'discover')
    page = (
      <main>
        {heading('发现')}
        <MenuGroup>
          <MenuRow label="朋友圈" image="wechat/discover_moments.png" onClick={demoOnly} />
        </MenuGroup>
        <MenuGroup>
          <MenuRow label="角色广场" icon="drawn/people" tint="orange" tile onClick={demoOnly} />
        </MenuGroup>
        <MenuGroup>
          <MenuRow label="扫一扫" icon="wechat/scan" tint="gray" onClick={demoOnly} />
          <MenuRow label="搜一搜" icon="wechat/search" tint="red" onClick={demoOnly} />
        </MenuGroup>
        <MenuGroup>
          <div data-tour-target="miniapps-entry">
            <MenuRow
              label="小程序"
              icon="wechat/discover_mini_program"
              tint="purple"
              onClick={() => action('open-miniapps', 'miniapps')}
            />
          </div>
        </MenuGroup>
      </main>
    );
  else if (state.screen === 'miniapps')
    page = (
      <main>
        {heading('小程序', () => action('back-miniapps', 'discover'))}
        <div className="preview-search">搜索小程序</div>
        <GroupHeader>我的小程序</GroupHeader>
        <div className="preview-mini-grid">
          {miniapps.map((item) => (
            <button
              type="button"
              key={item.id}
              data-tour-target={item.id === 'cards' ? 'cards-entry' : undefined}
              onClick={() => (item.id === 'cards' ? action('open-cards', 'cards') : demoOnly())}
            >
              <IconTile icon={item.icon} tint={item.tint} size="lg" />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
        <p className="preview-page-note">从聊天里进入部分玩法，还会带上当前 TA。</p>
      </main>
    );
  else if (state.screen === 'cards')
    page = (
      <main className="preview-cards">
        <div className="preview-capsule">
          <button type="button" aria-label="小程序更多" onClick={demoOnly}>
            ···
          </button>
          <i />
          <button
            type="button"
            aria-label="关闭小程序"
            data-tour-target="miniapp-close"
            onClick={() => action('close-miniapp', 'miniapps')}
          >
            <span className="preview-capsule-circle" />
          </button>
        </div>
        <div className="preview-cards-content">
          <IconTile icon="drawn/cards" tint="red" size="lg" />
          <h1>卡册</h1>
          <p>和 TA 的每一个特别时刻</p>
          <div className="preview-empty-card">
            <span>✧</span>
            <strong>故事刚刚开始</strong>
            <p>
              这里会收下你们的特别时刻。
              <br />
              现在没有卡片，也不影响继续使用。
            </p>
          </div>
        </div>
      </main>
    );
  else if (state.screen === 'me')
    page = (
      <main>
        {heading('我')}
        <div className="preview-profile">
          {avatar('你')}
          <span>
            <strong>体验账号</strong>
            <small>仅供本地引导演示</small>
          </span>
        </div>
        <MenuGroup>
          <div data-tour-target="services-entry">
            <MenuRow
              label="服务"
              image="wechat/profile_service.webp"
              onClick={() => action('open-services', 'services')}
            />
          </div>
        </MenuGroup>
        <MenuGroup>
          <MenuRow label="收藏" icon="wechat/star" tint="orange" onClick={demoOnly} />
          <MenuRow label="朋友圈" icon="wechat/picture" tint="blue" onClick={demoOnly} />
        </MenuGroup>
        <MenuGroup>
          <MenuRow label="设置" image="color/color_settings.svg" onClick={() => setHub(true)} />
        </MenuGroup>
      </main>
    );
  else if (state.screen === 'services')
    page = (
      <main>
        {heading('服务', () => action('back-services', 'me'))}
        <GroupHeader>钱包</GroupHeader>
        <MenuGroup>
          <MenuRow
            label="积分"
            image="wechat/membership.webp"
            value="示例账号"
            onClick={demoOnly}
          />
          <MenuRow
            label="PRO+ 会员"
            icon="wechat/star"
            tint="orange"
            value="仅模拟"
            onClick={demoOnly}
          />
        </MenuGroup>
        <GroupHeader>模型</GroupHeader>
        <MenuGroup>
          <MenuRow label="模型配置" icon="wechat/grid" tint="blue" onClick={demoOnly} />
          <MenuRow label="AI 模型价格" icon="wechat/tag" tint="green" onClick={demoOnly} />
        </MenuGroup>
        <GroupHeader>偏好</GroupHeader>
        <MenuGroup>
          <div data-tour-target="ecology-entry">
            <MenuRow
              label="角色生态"
              icon="wechat/star"
              tint="green"
              onClick={() => action('open-ecology', 'ecology')}
            />
          </div>
          <MenuRow label="插件" icon="wechat/grid" tint="indigo" onClick={demoOnly} />
        </MenuGroup>
      </main>
    );
  else
    page = (
      <main>
        {heading('角色生态', () => action('back-ecology', 'services'))}
        <p className="preview-page-note">
          TA 会按设置更新近况，并决定是否主动找你、发朋友圈，或者什么也不做。
        </p>
        <MenuGroup>
          <div data-tour-target="ecology-master">
            <SwitchRow
              label="角色生态"
              subtitle="PRO+ 专属 · 按实际运行消耗积分"
              checked={state.enabled}
              onChange={(enabled) =>
                enabled
                  ? setState((old) => ({ ...old, panel: 'cost' }))
                  : setState((old) => ({ ...old, enabled: false }))
              }
            />
          </div>
        </MenuGroup>
        <div className="preview-cost-note" data-tour-target="ecology-cost">
          <strong>先了解花费，再决定是否开启</strong>
          <p>每次「想一想」和实际行动都会消耗积分。积分不足时会暂停。</p>
          <small>本页为模拟数据，不连接服务，不开会员，不扣积分。</small>
        </div>
        {state.enabled && (
          <>
            <GroupHeader>活跃程度</GroupHeader>
            <div data-tour-target="ecology-levels">
              <MenuGroup>
                {['安静一点', '自然相处', '更活跃些'].map((name, index) => (
                  <MenuRow
                    key={name}
                    label={name}
                    subtitle={`示例：每天 ${index + 1}～${(index + 1) * 2} 次`}
                    chevron={false}
                    right={<CheckCircle checked={level === index} />}
                    onClick={() => setLevel(index)}
                  />
                ))}
              </MenuGroup>
            </div>
            <div className="preview-estimate" data-tour-target="ecology-estimate">
              <span>按现在的设置，预计每天</span>
              <strong>示例：约 {3 + level * 4} 积分 / 角色</strong>
              <small>只是演示数值，不是实际报价或真实消费</small>
            </div>
            <GroupHeader>参与角色</GroupHeader>
            <div data-tour-target="ecology-characters">
              <MenuGroup>
                <SwitchRow
                  label="林舟"
                  subtitle="只影响这位 TA 的生态参与"
                  checked={participates}
                  onChange={setParticipates}
                />
              </MenuGroup>
            </div>
            <button
              type="button"
              className="preview-inline-guide"
              onClick={() => start('ecology-settings')}
            >
              带我认识这些设置
            </button>
          </>
        )}
      </main>
    );
  const showTabs = ['conversations', 'discover', 'me'].includes(state.screen);
  const currentChapter = active ? chapters[active.id] : null;
  return (
    <div className="onboarding-preview-root">
      <header className="preview-top">
        <span>
          <img src="/assets/old-ui/brand/icon.png" alt="" />
          <strong>微伴 · 新手引导预览</strong>
        </span>
        <button
          type="button"
          aria-label={dark ? '切换浅色模式' : '切换深色模式'}
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          <span>{dark ? '浅色' : '深色'}</span>
        </button>
      </header>
      <div className="preview-layout">
        <aside className="preview-sidebar">
          <span className="preview-kicker">INTERACTIVE WALKTHROUGH</span>
          <h1>
            不是看说明，
            <br />
            是带你走一遍。
          </h1>
          <p>
            亮起哪里，就点哪里。
            <br />
            只教眼前一步，不把整本说明书塞给你。
          </p>
          <div className="preview-sidebar-chapters">
            {(['scenario', 'miniapps', 'ecology'] as const).map((id, index) => {
              const chapter = chapters[id];
              const Icon = chapter.icon;
              return (
                <button type="button" key={id} onClick={() => start(id)}>
                  <Icon size={23} />
                  <span>
                    <strong>
                      {index + 1}. {chapter.title}
                    </strong>
                    <small>
                      {state.completed.includes(id)
                        ? '已学会 · 可以重看'
                        : `${chapter.steps.length} 步 · 约半分钟`}
                    </small>
                  </span>
                  <span>{state.completed.includes(id) ? '✓' : '→'}</span>
                </button>
              );
            })}
          </div>
          <div className="preview-sidebar-note">
            <strong>这是本地演示，不是真实账号。</strong>
            <p>
              沿用现有导航、菜单、开关、弹层组件和设计令牌；业务页面使用精简示例，不接登录、模型、支付或生态任务。
            </p>
          </div>
          <button type="button" className="preview-reset" onClick={reset}>
            重置本地演示进度
          </button>
        </aside>
        <section className="preview-phone app-shell" aria-label="微伴引导演示界面">
          <div className="preview-local-strip">
            <span>本地预览</span> 示例数据 · 无真实消费
          </div>
          {page}
          {showTabs && (
            <nav className="preview-tabs" aria-label="主导航">
              {[
                {
                  screen: 'conversations' as const,
                  label: '微伴',
                  Icon: ChatCircle,
                  event: 'open-conversations',
                  target: 'nav-chat',
                },
                {
                  screen: 'conversations' as const,
                  label: '通讯录',
                  Icon: Users,
                  event: 'open-contacts',
                  target: 'nav-contacts',
                },
                {
                  screen: 'discover' as const,
                  label: '发现',
                  Icon: Compass,
                  event: 'open-discover',
                  target: 'nav-discover',
                },
                {
                  screen: 'me' as const,
                  label: '我',
                  Icon: UserCircle,
                  event: 'open-me',
                  target: 'nav-me',
                },
              ].map((tab) => (
                <button
                  type="button"
                  key={tab.label}
                  data-tour-target={tab.target}
                  className={
                    state.screen === tab.screen && tab.label !== '通讯录' ? 'selected' : ''
                  }
                  onClick={() =>
                    tab.label === '通讯录' ? demoOnly() : action(tab.event, tab.screen)
                  }
                >
                  <tab.Icon
                    size={25}
                    weight={
                      state.screen === tab.screen && tab.label !== '通讯录' ? 'fill' : 'regular'
                    }
                  />
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
          )}
          {state.panel === 'scenario' && (
            <Sheet
              title="情景预设"
              onClose={() => action('close-scenario', 'chat')}
              action={
                <button
                  type="button"
                  className="nav-bar-icon"
                  aria-label="关闭情景预设"
                  data-tour-target="scenario-close"
                  onClick={() => action('close-scenario', 'chat')}
                >
                  ✕
                </button>
              }
            >
              <div data-tour-target="scenario-options">
                <MenuGroup>
                  {['自动', '日常聊天', '树洞分享', '加油打气'].map((name) => (
                    <MenuRow
                      key={name}
                      label={name}
                      subtitle={
                        name === '日常聊天'
                          ? '轻松自在，聊聊生活'
                          : name === '树洞分享'
                            ? '说说心事，认真听你讲'
                            : name === '加油打气'
                              ? '需要一点鼓励的时候'
                              : '跟着当前对话自然变化'
                      }
                      chevron={false}
                      right={<CheckCircle checked={mode === name} />}
                      onClick={() => {
                        setMode(name);
                        action('choose-mode', 'chat');
                      }}
                    />
                  ))}
                </MenuGroup>
              </div>
              <p className="preview-page-note">仅为示例选项。正式页面以当前角色的可用情景为准。</p>
            </Sheet>
          )}
          {state.panel === 'cost' && (
            <Dialog
              title="模拟打开角色生态"
              actions={[
                { label: '取消', onClick: () => setState((old) => ({ ...old, panel: 'none' })) },
                {
                  label: '仅在演示中开启',
                  tone: 'primary',
                  onClick: () => {
                    setState((old) => ({ ...old, enabled: true, panel: 'none' }));
                    start('ecology-settings');
                  },
                },
              ]}
            >
              <p>正式功能需要 PRO+，每次运行及实际行动都会消耗积分。</p>
              <p>你现在打开的是本地模拟开关，不会购买会员、启用真实生态或产生消费。</p>
            </Dialog>
          )}
          {state.done && (
            <Dialog
              title="这节学会啦"
              actions={[
                { label: '自己逛逛', onClick: () => setState((old) => ({ ...old, done: null })) },
                {
                  label: '看看其他章节',
                  tone: 'primary',
                  onClick: () => {
                    setState((old) => ({ ...old, done: null }));
                    setHub(true);
                  },
                },
              ]}
            >
              <p>已完成「{chapters[state.done].title}」。</p>
              <p>
                {state.done === 'ecology'
                  ? '你没有开启生态，也可以完成这节课。想体验后续设置，可退出后点开模拟开关。'
                  : '没有发送消息，也没有改变真实账号设置。随时可以回来重看。'}
              </p>
            </Dialog>
          )}
          {hub && !active && (
            <div className="preview-hub">
              {heading('新手引导', () => setHub(false))}
              <div className="preview-hub-intro">
                <span className="preview-hub-symbol">✧</span>
                <h1>新版微伴，慢慢认识。</h1>
                <p>
                  选一个感兴趣的章节，
                  <br />
                  我带你点一次，就知道它在哪里。
                </p>
              </div>
              {state.paused && (
                <button
                  type="button"
                  className="preview-resume"
                  onClick={() => start(state.paused!.id, state.paused!.index)}
                >
                  继续上次：{chapters[state.paused.id].title} · 第 {state.paused.index + 1} 步 →
                </button>
              )}
              <div className="preview-hub-chapters">
                {(['scenario', 'miniapps', 'ecology'] as const).map((id) => {
                  const chapter = chapters[id];
                  const Icon = chapter.icon;
                  return (
                    <button
                      type="button"
                      key={id}
                      aria-label={`开始${chapter.title}`}
                      onClick={() => start(id)}
                    >
                      <span className={`preview-chapter-icon ${id}`}>
                        <Icon size={25} />
                      </span>
                      <span>
                        <strong>{chapter.title}</strong>
                        <small>{chapter.subtitle}</small>
                        <em>
                          {state.completed.includes(id)
                            ? '已学会，可重看'
                            : `${chapter.steps.length} 个小步骤`}
                        </em>
                      </span>
                      <span>›</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="preview-explore" onClick={() => setHub(false)}>
                我先自己逛逛
              </button>
              <p className="preview-hub-safety">随时可退出 · 不强迫开启功能 · 不产生真实费用</p>
            </div>
          )}
        </section>
      </div>
      {step && active && currentChapter && (
        <GuidedTour
          key={`${active.id}:${active.index}`}
          step={step}
          chapter={currentChapter.title}
          index={active.index}
          total={currentChapter.steps.length}
          onNext={() => setState(nextStep)}
          onBack={() =>
            setState((old) =>
              old.active
                ? atStep(old, { id: old.active.id, index: Math.max(0, old.active.index - 1) })
                : old,
            )
          }
          onPause={pause}
        />
      )}
      <ToastHost />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <Preview />
  </MemoryRouter>,
);
