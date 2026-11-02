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
import { MembershipEndpoints } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { useRemote } from '../data/use-remote.js';
import { Name } from './chat.js';
import { GuidedTour, type GuidedTourStep } from './guided-tour.js';
import { isGuideBlockingDialog } from './guided-tour-policy.js';
import {
  FLOW_CHAPTER,
  canAutoStart,
  markShown,
  observeTier,
  parseGuideRecord,
  type AutoFlow,
  type ChapterId,
  type GuideRecord,
} from './guide-triggers.js';
import { AutoGuideContext, type AutoGuideApi } from './onboarding-auto.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, Sheet } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';
import './onboarding-guide.css';

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
        description: '点一下聊天框旁的「＋」，看看还有哪些聊天功能。',
      },
      {
        id: 'live-scenario-open',
        target: target('scenario-entry'),
        present: target('scenario-options'),
        allowedDialog: scenarioDialog,
        kind: 'action',
        title: '打开「情景预设」',
        description: '想换一种聊天氛围，就来这里选情景。聊天的还是同一位 TA。',
      },
      {
        id: 'live-scenario-options',
        target: target('scenario-options'),
        allowedDialog: scenarioDialog,
        kind: 'read',
        title: '同一个 TA，不同的聊天情景',
        description: '不同情景会带来不同的表达方式。先认识这些选项，当前选择会保留。',
        nextLabel: '了解了',
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
        description: '和 TA 相处的纪念，可以在卡册里收藏。还没有卡片也没关系，先看看它在哪儿。',
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
    description: '认识入口和花费，了解 TA 的日常',
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
        description: '想让 TA 主动找你聊天、分享生活，可以来这里了解。',
      },
      {
        id: 'live-ecology-master',
        target: target('ecology-master'),
        kind: 'read',
        title: '想用时，再打开这个开关',
        description:
          '角色生态是 PRO+ 会员功能，运行时会消耗积分。先看看开关在哪里，不开启也不影响日常聊天。',
      },
      {
        id: 'live-ecology-cost',
        target: target('ecology-master'),
        kind: 'read',
        title: '先了解花费，再自己决定',
        description:
          '角色「想一想」和采取行动都会消耗积分。开启后，可以查看预计每日花费，并调整活跃程度和参与角色。',
        nextLabel: '了解了',
      },
    ],
  },
};
/**
 * 小程序引导的「下拉面板版」（11-03：第一次下拉打开小程序面板时自动弹）：在面板里认识宫格、打开卡册、
 * 用圆形按钮退回聊天列表。目录里手动学的仍是「发现 › 小程序」那一版；两版学完都记为「小程序」已学会。
 */
const pullPanel = '[role="dialog"][aria-label="小程序"]';
const pullMiniappSteps: LiveStep[] = [
  {
    id: 'live-pull-grid',
    target: target('pull-grid'),
    allowedDialog: pullPanel,
    kind: 'read',
    title: '往下拉，小程序就在这里',
    description:
      '在聊天列表顶部往下拉，就能打开小程序。卡册、宠物和其他玩法都在这里，长按图标可以调整顺序。',
  },
  {
    id: 'live-pull-cards',
    target: target('pull-cards'),
    present: target('miniapp-close'),
    allowedDialog: pullPanel,
    kind: 'action',
    title: '先打开「卡册」看看',
    description: '和 TA 相处的纪念，可以在卡册里收藏。还没有卡片也没关系，先看看它在哪儿。',
  },
  {
    id: 'live-pull-close',
    target: target('miniapp-close'),
    absent: target('miniapp-close'),
    allowedDialog: pullPanel,
    kind: 'action',
    title: '记住这个圆形关闭按钮',
    description: '点它退出小程序，回到聊天列表，不是退出整个微伴。',
  },
];
/** 各自动入口从哪一步开始（新会员入口先弹说明框，点「带我看看」再从「我」走完整一节）。 */
const AUTO_STEPS: Record<Exclude<AutoFlow, 'ecology-member'>, LiveStep[]> = {
  // 第一次进私聊页：就在聊天页，从「＋」开始。
  scenario: onboardingChapters.scenario.steps,
  'miniapps-pull': pullMiniappSteps,
  // 老会员第一次进「服务」：已经在服务页，从「找到角色生态」开始。
  'ecology-services': onboardingChapters.ecology.steps.slice(2),
};
interface Progress {
  chapter: ChapterId;
  steps: LiveStep[];
  index: number;
  armed: boolean;
}
interface GuideContext {
  completed: ChapterId[];
  paused: ChapterId | null;
  start(chapter: ChapterId, conversationId?: string): void;
  reset(): void;
}
const Context = createContext<GuideContext | null>(null);
function load(key: string): GuideRecord {
  try {
    return parseGuideRecord(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return parseGuideRecord(null);
  }
}
/** 等待自动弹出的请求：页面满足条件后，等其他弹窗关掉、目标位置稳定再开始。 */
interface Pending {
  flow: AutoFlow;
  token: number;
}
const POLL_MS = 250;
export function OnboardingGuideProvider({
  userId,
  autoEnabled = true,
  children,
}: {
  userId: string;
  /** 首次填资料 / 选第一个角色的新手流程里不自动弹引导。 */
  autoEnabled?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = `weiban:guided-tour:v1:${userId}`;
  const [saved, setSaved] = useState<GuideRecord>(() => load(storageKey));
  const [active, setActive] = useState<Progress | null>(null);
  const [done, setDone] = useState<ChapterId | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [memberIntro, setMemberIntro] = useState(false);
  const owner = useRef(userId);
  const activeRef = useRef(active);
  activeRef.current = active;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const autoRef = useRef(autoEnabled);
  autoRef.current = autoEnabled;
  const tokenRef = useRef(0);
  const current = active ? active.steps[active.index]! : null;
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
    if (old.index + 1 < old.steps.length) {
      const next = { ...old, index: old.index + 1, armed: false };
      activeRef.current = next;
      setActive(next);
      return;
    }
    activeRef.current = null;
    setSaved((record) => ({
      ...record,
      completed: [...new Set([...record.completed, old.chapter])],
      paused: null,
    }));
    setDone(old.chapter);
    setActive(null);
  }, []);
  /** 自动弹出真正开始的那一刻才记「已看过」（被别的弹窗挡住、没弹出来就离开页面的不算）。 */
  const begin = useCallback((flow: AutoFlow) => {
    const chapter = FLOW_CHAPTER[flow];
    setPending(null);
    setSaved((record) => markShown(record, chapter));
    if (flow === 'ecology-member') {
      setMemberIntro(true);
      return;
    }
    const next: Progress = { chapter, steps: AUTO_STEPS[flow], index: 0, armed: false };
    activeRef.current = next;
    setDone(null);
    setSaved((record) => ({ ...record, paused: chapter }));
    setActive(next);
  }, []);
  const request = useCallback((flow: AutoFlow) => {
    if (!autoRef.current || !canAutoStart(savedRef.current, flow)) return () => {};
    const token = ++tokenRef.current;
    // 新会员入口优先（「开通后马上弹」）：它在等待时，其他页面的请求不顶替它，那些页面下次进入再弹。
    setPending((old) => (old?.flow === 'ecology-member' ? old : { flow, token }));
    return () => setPending((old) => (old?.token === token ? null : old));
  }, []);
  useEffect(() => {
    if (!autoEnabled) setPending(null);
  }, [autoEnabled]);
  // 等待中的自动弹出：没有别的弹窗、没有正在进行的引导、目标元素出现且位置稳定（动画结束）后再开始。
  useEffect(() => {
    if (!pending || active || done || memberIntro) return;
    if (!canAutoStart(saved, pending.flow)) {
      setPending(null);
      return;
    }
    const flow = pending.flow;
    const first = flow === 'ecology-member' ? null : AUTO_STEPS[flow][0]!;
    let last: string | null = null;
    const timer = window.setInterval(() => {
      const blocked =
        !!document.querySelector('.guided-tour-layer') ||
        [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((element) =>
          isGuideBlockingDialog(element, first?.allowedDialog),
        );
      let place = 'ready';
      if (!blocked && first) {
        const element = document.querySelector<HTMLElement>(first.target);
        const box = element?.getClientRects().length ? element.getBoundingClientRect() : null;
        place =
          box && box.width > 0 && box.height > 0
            ? [box.left, box.top, box.width, box.height].map(Math.round).join(',')
            : '';
      }
      if (blocked || !place || place !== last) {
        last = blocked ? null : place || null;
        return;
      }
      window.clearInterval(timer);
      begin(flow);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending, active, done, memberIntro, saved, begin]);
  // 新会员：这台设备上先看到「免费」、后看到「PRO+」= 第一次开通成功，马上弹（guide-triggers.ts）。
  // 只认实时结果（networkOnly），不拿本机缓存的旧档位当依据；余额 / 设置变化时 useRemote 会自动重新拉取。
  const membership = useRemote(MembershipEndpoints.get, { networkOnly: true }, autoEnabled);
  const tier = membership.data?.tier;
  useEffect(() => {
    if (!tier) return;
    const { record, newMember } = observeTier(savedRef.current, tier);
    if (record !== savedRef.current) {
      savedRef.current = record;
      setSaved((old) => observeTier(old, tier).record);
    }
    if (newMember) request('ecology-member');
  }, [tier, request]);
  useEffect(() => {
    if (!current || !active) return;
    let frame = 0;
    function check() {
      const foreign = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (element) => isGuideBlockingDialog(element, current!.allowedDialog),
      );
      if (foreign) {
        pause();
        showToast('先处理这个提示，稍后可以回来继续学', 2500, 'info');
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
      setPending(null);
      // 在目录里手动开始过的章节也算看过：中途「稍后再学」后不会在当前页面又被自动弹出。
      setSaved((record) => ({ ...markShown(record, chapter), paused: chapter }));
      setActive({ chapter, steps: onboardingChapters[chapter].steps, index: 0, armed: false });
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
        // 只重置目录里的学习进度；「已自动弹过」不清，自动引导仍然一生只弹一次。
        setSaved((record) => ({ ...record, completed: [], paused: null }));
        setActive(null);
        setDone(null);
      },
    }),
    [saved.completed, saved.paused, start],
  );
  const auto = useMemo<AutoGuideApi>(() => ({ request }), [request]);
  return (
    <Context.Provider value={value}>
      <AutoGuideContext.Provider value={auto}>{children}</AutoGuideContext.Provider>
      {current && active && (
        <GuidedTour
          key={`${active.chapter}:${active.steps[0]!.id}:${active.index}`}
          step={current}
          chapter={onboardingChapters[active.chapter].title}
          index={active.index}
          total={active.steps.length}
          onNext={() => advance(active)}
          onPause={pause}
          backLabel="返回目录"
          onBack={() => {
            pause();
            navigate('/help/guide');
          }}
          onTargetAction={(id) =>
            setActive((old) =>
              old && old.steps[old.index]?.id === id ? { ...old, armed: true } : old,
            )
          }
        />
      )}
      {memberIntro && (
        <Dialog
          title="PRO+ 已开通"
          actions={[
            { label: '以后再说', onClick: () => setMemberIntro(false) },
            {
              label: '带我看看',
              tone: 'primary',
              onClick: () => {
                setMemberIntro(false);
                start('ecology');
              },
            },
          ]}
        >
          <p>会员专属的「角色生态」可以用了：打开后，TA 会像真人一样主动找你聊天、分享生活。</p>
          <p>运行时会消耗积分。跟着提示走一遍，认识入口和花费，开不开由你决定。</p>
        </Dialog>
      )}
      {done && (
        <Dialog
          title="这一节完成了"
          actions={[
            { label: '我自己试试', onClick: () => setDone(null) },
            {
              label: '再学一个',
              tone: 'primary',
              onClick: () => {
                setDone(null);
                navigate('/help/guide');
              },
            },
          ]}
        >
          <p>下次想用「{onboardingChapters[done].title}」，就从刚才的入口进去。</p>
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
        <h2>跟着点几下，认识微伴。</h2>
        <p>想学哪个就点哪个。跟着提示走一遍，下次就知道去哪里找了。</p>
      </div>
      {guide.paused && (
        <MenuGroup>
          <MenuRow
            label={`继续学习：${onboardingChapters[guide.paused].title}`}
            subtitle="从入口开始，带你再走一遍"
            onClick={() => choose(guide.paused!)}
          />
        </MenuGroup>
      )}
      <GroupHeader>挑一个想了解的功能</GroupHeader>
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
      <p className="hint page-note">学习记录保存在这台设备上，随时可以回来再看。</p>
      <MenuGroup>
        <MenuRow label="重新学习全部教程" onClick={guide.reset} />
      </MenuGroup>
      {picking && (
        <Sheet title="选择一个聊天" onClose={() => setPicking(false)}>
          {conversations.length ? (
            <MenuGroup>
              {conversations.map((conversation) => (
                <MenuRow
                  key={conversation.conversationId}
                  label={<Name conversation={conversation} />}
                  subtitle="打开聊天，认识情景预设的入口"
                  onClick={() => {
                    setPicking(false);
                    guide.start('scenario', conversation.conversationId);
                  }}
                />
              ))}
            </MenuGroup>
          ) : (
            <p className="empty">还没有可以打开的聊天。先去添加一位角色，或看看其他教程吧。</p>
          )}
        </Sheet>
      )}
    </main>
  );
}
