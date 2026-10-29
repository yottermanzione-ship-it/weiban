import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChat } from '../app/chat.js';
import { Name } from './chat.js';
import { GuidedTour, type GuidedTourStep } from './guided-tour.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, Sheet } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';
import './onboarding-guide.css';

type ChapterId = 'scenario' | 'miniapps' | 'ecology';
interface LiveStep extends GuidedTourStep {
  present?: string;
  absent?: string;
  path?: string;
  allowedDialog?: string;
}
interface Chapter {
  title: string;
  description: string;
  icon: string;
  steps: LiveStep[];
}
const target = (id: string) => `[data-guide="${id}"]`;
const scenarioDialog = '[role="dialog"][aria-label="情景预设"]';
export const onboardingChapters: Record<ChapterId, Chapter> = {
  scenario: {
    title: '情景预设',
    description: '认识聊天里的「＋」，了解不同聊天情景',
    icon: 'drawn/scenario_sparkle',
    steps: [
      {
        id: 'live-scenario-plus',
        target: target('chat-plus'),
        present: target('scenario-entry'),
        kind: 'action',
        title: '更多聊天功能，在这里',
        description: '点开真实聊天页面的「＋」。这里只认识入口，不会发送消息。',
      },
      {
        id: 'live-scenario-open',
        target: target('scenario-entry'),
        present: target('scenario-options'),
        allowedDialog: scenarioDialog,
        kind: 'action',
        title: '打开「情景预设」',
        description: '想换一种聊天情景，就从这个按钮进入。切换情景不是更换角色。',
      },
      {
        id: 'live-scenario-options',
        target: target('scenario-options'),
        allowedDialog: scenarioDialog,
        kind: 'read',
        title: '同一个 TA，不同的聊天情景',
        description:
          '你看到的是当前角色真实可用的选项。这一步只作介绍，保持原来的选择，不替你切换模式。',
        nextLabel: '明白了，保持原设置',
      },
      {
        id: 'live-scenario-close',
        target: `${scenarioDialog} .sheet-head button[aria-label="关闭"]`,
        absent: target('scenario-options'),
        allowedDialog: scenarioDialog,
        kind: 'action',
        title: '回到聊天，随时再来',
        description: '点这里关闭情景面板。以后从「＋ → 情景预设」就能再次找到它。',
      },
    ],
  },
  miniapps: {
    title: '小程序',
    description: '找到各种玩法，并学会退出小程序',
    icon: 'wechat/discover_mini_program',
    steps: [
      {
        id: 'live-miniapps-discover',
        target: target('nav-discover'),
        present: target('miniapps-entry'),
        kind: 'action',
        title: '聊天之外，去「发现」看看',
        description: '点底部「发现」，寻找卡册、宠物和其他玩法。',
      },
      {
        id: 'live-miniapps-entry',
        target: target('miniapps-entry'),
        present: target('miniapp-cards'),
        kind: 'action',
        title: '这就是「小程序」入口',
        description: '各种玩法和工具集中在这里，不用一次记住全部入口。',
      },
      {
        id: 'live-miniapps-cards',
        target: target('miniapp-cards'),
        present: target('miniapp-close'),
        kind: 'action',
        title: '先打开「卡册」看看',
        description: '只查看已有页面，不领取、不购买，没有卡片也能完成这节引导。',
      },
      {
        id: 'live-miniapps-close',
        target: target('miniapp-close'),
        path: '/miniapps',
        kind: 'action',
        title: '记住这个圆形关闭按钮',
        description: '点它退出小程序，回到刚才的列表，不是退出整个微伴。',
      },
    ],
  },
  ecology: {
    title: '角色生态',
    description: '认识入口、开关与花费，不强迫开启',
    icon: 'wechat/star',
    steps: [
      {
        id: 'live-ecology-me',
        target: target('nav-me'),
        present: target('services-entry'),
        kind: 'action',
        title: '先来到「我」',
        description: '自己的服务、积分和设置，都从这里进入。',
      },
      {
        id: 'live-ecology-services',
        target: target('services-entry'),
        present: target('ecology-entry'),
        kind: 'action',
        title: '打开「服务」',
        description: '角色生态和模型、积分管理都在服务页面。',
      },
      {
        id: 'live-ecology-entry',
        target: target('ecology-entry'),
        present: target('ecology-master'),
        kind: 'action',
        title: '找到「角色生态」',
        description: '看看 TA 的日常如何运行。这里只打开设置页面，不会替你打开开关。',
      },
      {
        id: 'live-ecology-master',
        target: target('ecology-master'),
        kind: 'read',
        title: '认识开关，不等于必须开启',
        description:
          '角色生态属于 PRO+ 服务，运行会消耗积分。没有会员或暂不开启，都可以完成了解型引导。现有开关状态不会被修改。',
      },
      {
        id: 'live-ecology-cost',
        target: target('ecology-master'),
        kind: 'read',
        title: '先了解花费，再自己决定',
        description:
          '每次「想一想」和实际行动都会产生积分消耗。启用后可看预计每日积分、活跃程度和参与角色；本次引导不替你开启或调整这些设置。',
        nextLabel: '了解了，不改变设置',
      },
    ],
  },
};
interface Progress {
  chapter: ChapterId;
  index: number;
  armed: boolean;
}
interface Saved {
  completed: ChapterId[];
  paused: ChapterId | null;
}
interface GuideContext {
  completed: ChapterId[];
  paused: ChapterId | null;
  start(chapter: ChapterId, conversationId?: string): void;
  reset(): void;
}
const Context = createContext<GuideContext | null>(null);
function load(key: string): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    return {
      completed: Array.isArray(saved?.completed)
        ? saved.completed.filter(
            (id) => typeof id === 'string' && Object.hasOwn(onboardingChapters, id),
          )
        : [],
      paused:
        typeof saved?.paused === 'string' && Object.hasOwn(onboardingChapters, saved.paused)
          ? saved.paused
          : null,
    };
  } catch {
    return { completed: [], paused: null };
  }
}
export function OnboardingGuideProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = `weiban:guided-tour:v1:${userId}`;
  const [saved, setSaved] = useState<Saved>(() => load(storageKey));
  const [active, setActive] = useState<Progress | null>(null);
  const [done, setDone] = useState<ChapterId | null>(null);
  const owner = useRef(userId);
  const activeRef = useRef(active);
  activeRef.current = active;
  const current = active ? onboardingChapters[active.chapter].steps[active.index]! : null;
  useEffect(() => {
    if (owner.current !== userId) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      /* Guide remains optional when local storage is unavailable. */
    }
  }, [storageKey, saved, userId]);
  const pause = useCallback(() => {
    const old = activeRef.current;
    activeRef.current = null;
    if (old) setSaved((record) => ({ ...record, paused: old.chapter }));
    setActive(null);
  }, []);
  const advance = useCallback((expected: Progress) => {
    const old = activeRef.current;
    // A DOM observer from the preceding step must never advance the new step.
    if (!old || old !== expected) return;
    if (old.index + 1 < onboardingChapters[old.chapter].steps.length) {
      const next = { ...old, index: old.index + 1, armed: false };
      activeRef.current = next;
      setActive(next);
      return;
    }
    activeRef.current = null;
    setSaved((record) => ({
      completed: [...new Set([...record.completed, old.chapter])],
      paused: null,
    }));
    setDone(old.chapter);
    setActive(null);
  }, []);
  useEffect(() => {
    if (!current || !active) return;
    let frame = 0;
    function check() {
      const foreign = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (element) =>
          element.getClientRects().length &&
          !element.classList.contains('guided-tour-card') &&
          !(current!.allowedDialog && element.matches(current!.allowedDialog)),
      );
      if (foreign) {
        pause();
        showToast('请先处理当前弹窗，之后可从新手引导继续', 2500, 'info');
        return;
      }
      if (!active!.armed || current!.kind !== 'action') return;
      const present =
        !current!.present || !!document.querySelector(current!.present)?.getClientRects().length;
      const absent = !current!.absent || !document.querySelector(current!.absent);
      const path = !current!.path || location.pathname === current!.path;
      if (present && absent && path) advance(active!);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    }
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'class'],
    });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [current, active, location.pathname, pause, advance]);
  const start = useCallback(
    (chapter: ChapterId, conversationId?: string) => {
      if (chapter === 'scenario' && !conversationId) return;
      setDone(null);
      setSaved((record) => ({ ...record, paused: chapter }));
      setActive({ chapter, index: 0, armed: false });
      navigate(chapter === 'scenario' ? `/chat/${encodeURIComponent(conversationId!)}` : '/chat');
    },
    [navigate],
  );
  const value = useMemo(
    () => ({
      completed: saved.completed,
      paused: saved.paused,
      start,
      reset: () => {
        setSaved({ completed: [], paused: null });
        setActive(null);
        setDone(null);
      },
    }),
    [saved.completed, saved.paused, start],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {current && active && (
        <GuidedTour
          key={`${active.chapter}:${active.index}`}
          step={current}
          chapter={onboardingChapters[active.chapter].title}
          index={active.index}
          total={onboardingChapters[active.chapter].steps.length}
          onNext={() => advance(active)}
          onPause={pause}
          backLabel="回引导页"
          onBack={() => {
            pause();
            navigate('/help/guide');
          }}
          onTargetAction={(id) =>
            setActive((old) =>
              old && onboardingChapters[old.chapter].steps[old.index]?.id === id
                ? { ...old, armed: true }
                : old,
            )
          }
        />
      )}
      {done && (
        <Dialog
          title="这一节学会了"
          actions={[
            { label: '留在当前页面', onClick: () => setDone(null) },
            {
              label: '看看其他章节',
              tone: 'primary',
              onClick: () => {
                setDone(null);
                navigate('/help/guide');
              },
            },
          ]}
        >
          <p>已了解「{onboardingChapters[done].title}」的真实入口。</p>
          <p>引导没有发送消息、切换聊天情景或改变角色生态设置。</p>
        </Dialog>
      )}
    </Context.Provider>
  );
}
export function OnboardingGuidePage() {
  const guide = useContext(Context);
  const { state } = useChat();
  const [picking, setPicking] = useState(false);
  if (!guide) return null;
  const conversations = state.conversations.filter(
    (item) =>
      item.type !== 'group' &&
      !item.state.hidden &&
      item.participants.some((participant) => participant.kind === 'character'),
  );
  function choose(chapter: ChapterId) {
    if (chapter === 'scenario') setPicking(true);
    else guide!.start(chapter);
  }
  return (
    <main className="onboarding-guide-page">
      <NavBar title="新手引导" fallback="/settings" />
      <div className="onboarding-guide-intro">
        <h2>在真实页面里，带你点一次。</h2>
        <p>亮起哪里，就点哪里。每次只教一个功能，随时可以退出，不会替你开启收费功能。</p>
      </div>
      {guide.paused && (
        <MenuGroup>
          <MenuRow
            label={`继续了解：${onboardingChapters[guide.paused].title}`}
            subtitle="从本章入口重新开始，不自动恢复或修改设置"
            onClick={() => choose(guide.paused!)}
          />
        </MenuGroup>
      )}
      <GroupHeader>认识新版微伴</GroupHeader>
      <MenuGroup>
        {(Object.keys(onboardingChapters) as ChapterId[]).map((id) => (
          <MenuRow
            key={id}
            label={onboardingChapters[id].title}
            subtitle={onboardingChapters[id].description}
            icon={onboardingChapters[id].icon}
            tint={id === 'miniapps' ? 'purple' : 'green'}
            value={
              guide.completed.includes(id) ? '已学会' : `${onboardingChapters[id].steps.length} 步`
            }
            onClick={() => choose(id)}
          />
        ))}
      </MenuGroup>
      <p className="hint page-note">
        直接使用你现在的网页、角色和页面尺寸，不是模拟界面。学习进度仅保存在当前账号的本设备上，暂不跨设备同步。
      </p>
      <MenuGroup>
        <MenuRow label="重置本机学习进度" onClick={guide.reset} />
      </MenuGroup>
      {picking && (
        <Sheet title="选择一段角色私聊" onClose={() => setPicking(false)}>
          {conversations.length ? (
            <MenuGroup>
              {conversations.map((conversation) => (
                <MenuRow
                  key={conversation.conversationId}
                  label={<Name conversation={conversation} />}
                  subtitle="只打开这段聊天，不发送消息"
                  onClick={() => {
                    setPicking(false);
                    guide.start('scenario', conversation.conversationId);
                  }}
                />
              ))}
            </MenuGroup>
          ) : (
            <p className="empty">还没有可用的角色私聊。可以先添加一位角色，或者先学其他章节。</p>
          )}
        </Sheet>
      )}
    </main>
  );
}
