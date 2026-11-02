/**
 * 2026-11-02 生态动作清单清理的锁定断言：目录与契约 key 集合、并入 message 的内部 kind、
 * 决策模型可见文字里不再出现已删 key。
 * 2026-11-03 按对照表 v3 收拢（T-20261103b）：只展示 6 个开关、私人朋友圈开关的存储映射、基础层动作。
 */
import { describe, expect, it } from 'vitest';
import { ECOLOGY_ACTION_KEYS } from '@weiban/contracts';
import {
  ACTION_DEF,
  ECOLOGY_ACTIONS,
  ECOLOGY_SWITCHES,
  INTERNAL_ACTION_INFO,
  TEXT_MODEL_ACTIONS,
  gateKeyForRunKind,
  jevPrompt,
  mergeDisabledActions,
  switchEnabled,
} from './ecology.js';
import { MAIN_LINE_ACTIONS, SEPARATE_LINE_ACTIONS } from './ecology-counters.js';

const REMOVED_KEYS = [
  'share_link',
  'care_weather',
  'play_letter',
  'play_wish',
  'play_focus',
  'play_daily_question',
  'play_reminder',
  'greeting',
  'care_anniversary',
  'care_period',
] as const;

/** 动作目录里的 17 个动作（private_moments 只是开关，不在目录里）。 */
const ACTION_KEYS = [
  'message',
  'voice',
  'photo',
  'sticker',
  'nudge',
  'moment_post',
  'moment_interact',
  'moment_reply',
  'moment_peer',
  'weibo_sync',
  'status',
  'signature',
  'care_absence',
  'care_late_night',
  'care_follow_up',
  'play_pet',
  'group_talk',
] as const;

const BASE_LAYER = [
  'voice',
  'photo',
  'sticker',
  'nudge',
  'moment_interact',
  'moment_reply',
  'moment_peer',
  'care_late_night',
] as const;

describe('生态动作清单清理（2026-11-02）', () => {
  it('契约 key = 17 个动作 + 5.2 新增的 private_moments 开关', () => {
    expect([...ECOLOGY_ACTION_KEYS].sort()).toEqual([...ACTION_KEYS, 'private_moments'].sort());
  });

  it('动作表覆盖除 private_moments 外的全部契约 key；group_talk 文案已改', () => {
    // 动作表顺序与契约顺序不同（weibo_sync 在表首），只断言集合相等。
    expect([...ECOLOGY_ACTIONS.map((a) => a.key)].sort()).toEqual([...ACTION_KEYS].sort());
    expect(new Set(ECOLOGY_ACTIONS.map((a) => a.key)).size).toBe(ECOLOGY_ACTIONS.length);
    for (const key of ECOLOGY_ACTION_KEYS)
      if (key !== 'private_moments') expect(ACTION_DEF.get(key)).toBeDefined();
    expect(ACTION_DEF.get('private_moments')).toBeUndefined();
    expect(ACTION_DEF.get('group_talk')?.label).toBe('群聊主动话题');
    // 唯一留口子的是照顾宠物（reserved）。
    expect(ECOLOGY_ACTIONS.filter((a) => a.mode === 'reserved').map((a) => a.key)).toEqual([
      'play_pet',
    ]);
  });

  it('已删 / 已并入的 10 个 key 不在动作表、文字模型集合与计数集合里', () => {
    for (const key of REMOVED_KEYS) {
      expect(ECOLOGY_ACTIONS.map((a) => a.key)).not.toContain(key);
      expect([...TEXT_MODEL_ACTIONS]).not.toContain(key);
      expect([...MAIN_LINE_ACTIONS]).not.toContain(key);
    }
    expect([...SEPARATE_LINE_ACTIONS]).toEqual([
      'greeting',
      'care_anniversary',
      'care_follow_up',
      'care_late_night',
    ]);
  });

  it('决策模型可见文字里不再出现已删 key（工具说明、Jev 题干）', () => {
    const visible = [
      ...ECOLOGY_ACTIONS.map((a) => `${a.key}:${a.label}:${a.tool}:${a.summary}`),
      ...[...ACTION_KEYS, 'greeting', 'care_anniversary'].map((k) => jevPrompt(k as never)),
    ].join('\n');
    for (const key of REMOVED_KEYS) expect(visible).not.toContain(key);
  });

  it('并入 message 的内部 kind：门控查 message，展示信息保留旧值', () => {
    expect(gateKeyForRunKind('greeting')).toBe('message');
    expect(gateKeyForRunKind('care_anniversary')).toBe('message');
    expect(gateKeyForRunKind('message')).toBe('message');
    expect(INTERNAL_ACTION_INFO.greeting).toEqual({
      label: '早安 / 晚安',
      hint: '只在早上或睡前合适。',
      summary: '跟你道了早安 / 晚安',
    });
    expect(INTERNAL_ACTION_INFO.care_anniversary).toEqual({
      label: '生日、纪念日、约定的日子',
      hint: '今天是特别的日子时表达心意。',
      summary: '记得今天是特别的日子',
    });
    expect(jevPrompt('greeting')).toContain('早安 / 晚安');
    expect(jevPrompt('care_anniversary')).toContain('生日、纪念日、约定的日子');
  });
});

describe('按对照表 v3 收拢开关（2026-11-03）', () => {
  it('只展示 6 个开关，顺序与分组固定', () => {
    expect(ECOLOGY_SWITCHES.map((s) => [s.key, s.group, s.label])).toEqual([
      ['message', 'chat', '主动消息'],
      ['private_moments', 'moments', '私人朋友圈'],
      ['status', 'life', '更新状态'],
      ['signature', 'life', '改个性签名'],
      ['play_pet', 'play', '照顾宠物'],
      ['group_talk', 'group', '群聊主动话题'],
    ]);
  });

  it('门控归属：跟进 / 久未问候归主动消息，微博同步 / 转发归私人朋友圈，基础层不属于任何开关', () => {
    expect(gateKeyForRunKind('care_absence')).toBe('message');
    expect(gateKeyForRunKind('care_follow_up')).toBe('message');
    expect(gateKeyForRunKind('weibo_sync')).toBe('private_moments');
    expect(gateKeyForRunKind('moment_post')).toBe('private_moments');
    expect(gateKeyForRunKind('status')).toBe('status');
    expect(gateKeyForRunKind('group_talk')).toBe('group_talk');
    for (const key of BASE_LAYER) {
      expect(gateKeyForRunKind(key)).toBeNull();
      expect(ACTION_DEF.get(key)?.mode).toBe('base');
    }
    // 每个决策动作都有开关管。
    for (const def of ECOLOGY_ACTIONS.filter((a) => a.mode === 'decision'))
      expect(gateKeyForRunKind(def.key)).not.toBeNull();
  });

  it('私人朋友圈：两个存储 key 都被关才算关；只关了一个显示为开', () => {
    expect(switchEnabled([], 'private_moments')).toBe(true);
    expect(switchEnabled(['weibo_sync'], 'private_moments')).toBe(true);
    expect(switchEnabled(['moment_post'], 'private_moments')).toBe(true);
    expect(switchEnabled(['weibo_sync', 'moment_post'], 'private_moments')).toBe(false);
  });

  it('主动消息：旧数据里单独关掉的跟进 / 久未问候不影响显示', () => {
    expect(switchEnabled(['care_absence', 'care_follow_up'], 'message')).toBe(true);
    expect(switchEnabled(['message'], 'message')).toBe(false);
  });

  it('切换私人朋友圈时两个存储 key 一起写', () => {
    expect(
      mergeDisabledActions(['weibo_sync'], [{ key: 'private_moments', enabled: false }]),
    ).toEqual(['moment_post', 'weibo_sync']);
    expect(
      mergeDisabledActions(['weibo_sync', 'status'], [{ key: 'private_moments', enabled: true }]),
    ).toEqual(['status']);
  });

  it('旧客户端发来已收拢 / 已归基础层的 key：照收但不起作用', () => {
    for (const key of [
      'weibo_sync',
      'moment_post',
      'care_absence',
      'care_follow_up',
      ...BASE_LAYER,
    ] as const) {
      expect(mergeDisabledActions(['status'], [{ key, enabled: false }])).toEqual(['status']);
      expect(mergeDisabledActions([key], [{ key, enabled: true }])).toEqual([key]);
    }
  });
});
