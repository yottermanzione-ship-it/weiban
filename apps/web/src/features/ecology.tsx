/*
 * 角色生态（2026-10-18 总经理构想：界面先行）。
 *
 * 目标形态：定时唤醒 → 读全局上下文（聊天、朋友圈、经期、日程、记忆）
 * → 角色自己从动作清单里挑一个 → 调用执行器。
 *
 * 本页当前只做界面：开关保存在本机（localStorage），尚未接通后端。
 * 后端与会员方案暂缓；这里不启停真实行为，也不扣费。
 * 相关：docs/product/input/2026-10-18-gm-ecology-vision.md
 */
import { useEffect, useState } from 'react';
import { GroupHeader, MenuGroup, MenuRow, NavBar, SwitchRow, CheckCircle } from './shell-kit.js';

type ActionKey =
  'moments' | 'proactive' | 'interact' | 'care' | 'group' | 'simulate' | 'call' | 'voice';

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
  { key: '30m', label: '每 30 分钟', subtitle: '用于讨论较频繁的思考安排', points: 25 },
  { key: '2h', label: '每 2 小时', subtitle: '用于讨论间隔更长的思考安排', points: 6 },
  { key: '4d', label: '每天 4 次', subtitle: '示例：早中晚和睡前各一次', points: 2 },
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
  { time: '示例 09:12', text: '发了一条朋友圈：楼下的桂花开了' },
  { time: '示例 22:40', text: '主动找你：问你今天怎么没说话' },
  { time: '示例 18:05', text: '评论了你的朋友圈：这张拍得好看' },
  { time: '示例 08:30', text: '想了想，今天什么都没做' },
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

  function toggleAction(key: ActionKey, value: boolean) {
    setState((prev) => ({ ...prev, actions: { ...prev.actions, [key]: value } }));
  }

  return (
    <main className="ecology-page">
      <NavBar title="角色生态" fallback="/services" />

      <section className="ecology-intro" aria-label="界面预览说明">
        <strong>界面预览</strong>
        <p>本页只演示设置效果，不会启停真实角色行为，也不会扣积分。</p>
        <p className="ecology-target">
          目标方向：让角色定时了解近况，自主选择聊天、发动态等动作。以下选项和数字仅供讨论。
        </p>
      </section>

      <MenuGroup>
        <SwitchRow
          label="预览角色生态"
          subtitle="仅展开或收起本页演示，不控制现有角色行为，不扣积分"
          checked={state.enabled}
          onChange={(enabled) => setState((prev) => ({ ...prev, enabled }))}
        />
      </MenuGroup>

      {state.enabled && (
        <>
          <GroupHeader>动作选项（预览）</GroupHeader>
          <MenuGroup>
            {ACTIONS.map((action) => (
              <SwitchRow
                key={action.key}
                ariaLabel={action.label}
                label={
                  <span className="ecology-label">
                    {action.label}
                    {action.note && <em className="ecology-badge">{action.note}</em>}
                  </span>
                }
                subtitle={
                  <span className="ecology-sub">
                    {action.subtitle}
                    <span className="ecology-points">示例：{action.points} 积分/天</span>
                  </span>
                }
                checked={state.actions[action.key]}
                onChange={(value) => toggleAction(action.key, value)}
              />
            ))}
          </MenuGroup>

          <GroupHeader>思考频率（示例）</GroupHeader>
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
                    <span className="ecology-points">示例：{f.points} 积分/天</span>
                    <CheckCircle checked={state.frequency === f.key} />
                  </span>
                }
              />
            ))}
          </MenuGroup>

          <GroupHeader>用哪个模型想</GroupHeader>
          <MenuGroup>
            <MenuRow
              label="生态模型"
              subtitle="当前仅为界面预览，生态模型选择尚未接通"
              value="尚未接通"
              chevron={false}
              disabled
            />
          </MenuGroup>

          <div className="ecology-total">
            <span>示例合计（仅供讨论）</span>
            <strong>{daily} 积分/天（示例）</strong>
            <small>演示数字不是实际报价，不会从账户扣除。</small>
          </div>

          <GroupHeader>动作记录示例</GroupHeader>
          <p className="ecology-section-note">以下是虚构演示，不是角色实际执行或发送的记录。</p>
          <MenuGroup className="ecology-example-log">
            {RECENT.map((item) => (
              <MenuRow
                key={item.time}
                label={item.text}
                value={item.time}
                chevron={false}
                disabled
              />
            ))}
          </MenuGroup>
        </>
      )}

      <p className="ecology-footnote">
        预览选择只保存在当前浏览器，不会修改「主动消息与免打扰」或「TA 的日常」等现有设置。
        本页尚未接通实际执行、模型选择或计费。
      </p>
    </main>
  );
}
