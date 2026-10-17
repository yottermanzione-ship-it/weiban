/*
 * 角色生态（2026-10-18 总经理构想：界面先行）。
 *
 * 目标形态：定时唤醒 → 读全局上下文（聊天、朋友圈、经期、日程、记忆）
 * → 角色自己从动作清单里挑一个 → 调用执行器。
 *
 * 本页当前只做界面：开关保存在本机（localStorage），尚未接通后端。
 * 后端（契约 3.17 + 迁移 0103 + 生态循环）在方案确认后实现。
 * 相关：docs/product/input/2026-10-18-gm-ecology-vision.md
 */
import { useEffect, useMemo, useState } from 'react';
import { GroupHeader, MenuGroup, MenuRow, NavBar, SwitchRow, CheckCircle } from './shell-kit.js';

type ActionKey =
  | 'moments'
  | 'proactive'
  | 'interact'
  | 'care'
  | 'group'
  | 'simulate'
  | 'call'
  | 'voice';

type Frequency = '30m' | '2h' | '4d';

const ACTIONS: {
  key: ActionKey;
  label: string;
  subtitle: string;
  points: number;
  note?: string;
}[] = [
  {
    key: 'moments',
    label: '发朋友圈',
    subtitle: '自己挑时机发，可能配图',
    points: 6,
  },
  {
    key: 'proactive',
    label: '主动找你聊天',
    subtitle: '想起一件事、隔太久没聊、节日问候',
    points: 8,
  },
  {
    key: 'interact',
    label: '评论 / 点赞你的朋友圈',
    subtitle: '看到你发的动态会回应',
    points: 2,
  },
  {
    key: 'care',
    label: '关心问候',
    subtitle: '经期、生病、情绪低落时主动关心',
    points: 3,
  },
  {
    key: 'group',
    label: '在群里自己聊',
    subtitle: '角色之间互相说话，不需要你在场',
    points: 4,
  },
  {
    key: 'simulate',
    label: '日常推演',
    subtitle: 'TA 今天做了什么，聊天时能接得上',
    points: 5,
  },
  {
    key: 'call',
    label: '主动打电话',
    subtitle: '需要接通话服务后才能用',
    points: 2,
    note: '未接通',
  },
  {
    key: 'voice',
    label: '发语音消息',
    subtitle: '用 TA 的声音说一句',
    points: 3,
    note: '未接通',
  },
];

const FREQUENCIES: { key: Frequency; label: string; subtitle: string; points: number }[] = [
  { key: '30m', label: '每 30 分钟', subtitle: '反应最快，积分消耗最高', points: 25 },
  { key: '2h', label: '每 2 小时', subtitle: '推荐：像真人，成本可控', points: 6 },
  { key: '4d', label: '每天 4 次', subtitle: '只在早中晚和睡前想一次', points: 2 },
];

const STORAGE_KEY = 'weiban:ecology-preview:v1';

type State = {
  enabled: boolean;
  actions: Record<ActionKey, boolean>;
  frequency: Frequency;
};

const DEFAULT_STATE: State = {
  enabled: false,
  actions: {
    moments: true,
    proactive: true,
    interact: true,
    care: true,
    group: true,
    simulate: true,
    call: false,
    voice: false,
  },
  frequency: '2h',
};

const RECENT = [
  { time: '今天 09:12', text: '发了一条朋友圈：楼下的桂花开了' },
  { time: '昨天 22:40', text: '主动找你：问你今天怎么没说话' },
  { time: '昨天 18:05', text: '评论了你的朋友圈：这张拍得好看' },
  { time: '10-16 08:30', text: '想了想，今天什么都没做' },
];

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      enabled: parsed.enabled ?? DEFAULT_STATE.enabled,
      actions: { ...DEFAULT_STATE.actions, ...(parsed.actions ?? {}) },
      frequency: parsed.frequency ?? DEFAULT_STATE.frequency,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function EcologyPage() {
  const [state, setState] = useState<State>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 本机存储不可用时不影响浏览 */
    }
  }, [state]);

  const thinking = FREQUENCIES.find((f) => f.key === state.frequency)?.points ?? 6;
  const actionPoints = ACTIONS.filter((a) => state.actions[a.key]).reduce(
    (sum, a) => sum + a.points,
    0,
  );
  const daily = state.enabled ? thinking + actionPoints : 0;
  const monthly = useMemo(() => Math.round((daily * 30) / 100), [daily]);

  function toggleAction(key: ActionKey, value: boolean) {
    setState((prev) => ({ ...prev, actions: { ...prev.actions, [key]: value } }));
  }

  return (
    <main>
      <NavBar title="角色生态" fallback="/services" />

      <p className="ecology-intro">
        开启后，TA 会像真人一样每隔一段时间自己想一想：现在该不该发条朋友圈、要不要找你说话。想的过程也会消耗积分，即使最后决定什么都不做。
      </p>

      <MenuGroup>
        <SwitchRow
          label="角色生态"
          subtitle="关闭后，所有角色只在你找 TA 时回复，不会自己做任何事"
          checked={state.enabled}
          onChange={(enabled) => setState((prev) => ({ ...prev, enabled }))}
        />
      </MenuGroup>

      {state.enabled && (
        <>
          <GroupHeader right={`约 ${daily} 积分/天`}>TA 可以自己做的事</GroupHeader>
          <MenuGroup>
            {ACTIONS.map((action) => (
              <SwitchRow
                key={action.key}
                label={
                  <span className="ecology-label">
                    {action.label}
                    {action.note && <em className="ecology-badge">{action.note}</em>}
                  </span>
                }
                subtitle={
                  <span className="ecology-sub">
                    {action.subtitle}
                    <span className="ecology-points">≈{action.points} 积分/天</span>
                  </span>
                }
                checked={state.actions[action.key]}
                onChange={(value) => toggleAction(action.key, value)}
              />
            ))}
          </MenuGroup>

          <GroupHeader>多久想一次</GroupHeader>
          <MenuGroup>
            {FREQUENCIES.map((f) => (
              <MenuRow
                key={f.key}
                onClick={() => setState((prev) => ({ ...prev, frequency: f.key }))}
                label={f.label}
                subtitle={f.subtitle}
                chevron={false}
                right={
                  <span className="ecology-right">
                    <span className="ecology-points">≈{f.points} 积分/天</span>
                    <CheckCircle checked={state.frequency === f.key} />
                  </span>
                }
              />
            ))}
          </MenuGroup>

          <GroupHeader>用哪个模型想</GroupHeader>
          <MenuGroup>
            <MenuRow
              to="/models"
              label="生态模型"
              subtitle="和聊天模型分开设置；不选时用平台的默认后台模型"
              value="跟随平台默认"
            />
          </MenuGroup>

          <div className="ecology-total">
            <span>合计</span>
            <strong>
              约 {daily} 积分/天 · {monthly} 元/月
            </strong>
          </div>

          <GroupHeader>TA 最近自己做了什么</GroupHeader>
          <MenuGroup>
            {RECENT.map((item) => (
              <MenuRow
                key={item.time}
                onClick={() => undefined}
                label={item.text}
                value={item.time}
                chevron={false}
              />
            ))}
          </MenuGroup>
        </>
      )}

      <p className="ecology-footnote">
        本页为界面预览：开关只保存在本机，尚未接通后端。接上后，关闭开关会立即停止排队中的任务，但已经发出的调用无法撤回。
      </p>
    </main>
  );
}
