/**
 * 2026-11-02 生态动作清单清理的锁定断言：目录与契约 key 集合、并入 message 的内部 kind、
 * 决策模型可见文字里不再出现已删 key。
 */
import { describe, expect, it } from 'vitest';
import { ECOLOGY_ACTION_KEYS } from '@weiban/contracts';
import {
  ACTION_DEF,
  ECOLOGY_ACTIONS,
  INTERNAL_ACTION_INFO,
  TEXT_MODEL_ACTIONS,
  gateKeyForRunKind,
  jevPrompt,
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

const EXPECTED_KEYS = [
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

describe('生态动作清单清理（2026-11-02）', () => {
  it('契约 key 集合恰好是清理后的 17 个，顺序保持其余不动', () => {
    expect([...ECOLOGY_ACTION_KEYS]).toEqual([...EXPECTED_KEYS]);
  });

  it('动作表与契约 key 一一对应；group_talk 文案已改', () => {
    // 动作表顺序与契约顺序不同（weibo_sync 在表首），只断言集合相等。
    expect([...ECOLOGY_ACTIONS.map((a) => a.key)].sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(new Set(ECOLOGY_ACTIONS.map((a) => a.key)).size).toBe(ECOLOGY_ACTIONS.length);
    for (const key of ECOLOGY_ACTION_KEYS) expect(ACTION_DEF.get(key)).toBeDefined();
    expect(ACTION_DEF.get('group_talk')?.label).toBe('群聊主动话题');
    // 唯一留口子的是照顾宠物（reserved）；其余 16 个都是 decision。
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
      ...[...ECOLOGY_ACTION_KEYS, 'greeting', 'care_anniversary'].map((k) => jevPrompt(k as never)),
    ].join('\n');
    for (const key of REMOVED_KEYS) expect(visible).not.toContain(key);
  });

  it('并入 message 的内部 kind：门控查 message，展示信息保留旧值', () => {
    expect(gateKeyForRunKind('greeting')).toBe('message');
    expect(gateKeyForRunKind('care_anniversary')).toBe('message');
    expect(gateKeyForRunKind('message')).toBe('message');
    expect(gateKeyForRunKind('voice')).toBe('voice');
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
