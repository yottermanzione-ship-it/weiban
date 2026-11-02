/**
 * 2026-11-02 生态动作清单清理（契约 5.0）：删 10 个 key 的严格 / 容错行为。
 */
import { describe, expect, it } from 'vitest';
import {
  ECOLOGY_ACTION_KEYS,
  EcologyAction,
  EcologyConfig,
  EcologyMurmur,
  UpdateEcologySettings,
} from '../src/index.js';

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

const ID = '01920000-0000-7000-8000-000000000001';
const NOW = '2026-11-02T09:00:00.000Z';

describe('生态动作清单（契约 5.0）', () => {
  it('key 集合恰好是清理后的 17 个', () => {
    expect([...ECOLOGY_ACTION_KEYS]).toEqual([
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
    ]);
    for (const key of REMOVED_KEYS) expect(ECOLOGY_ACTION_KEYS).not.toContain(key);
  });

  it('严格请求枚举：已删 key 一律拒绝（PATCH 400 的契约侧）', () => {
    expect(
      UpdateEcologySettings.safeParse({ actions: [{ key: 'message', enabled: false }] }).success,
    ).toBe(true);
    for (const key of REMOVED_KEYS) {
      expect(UpdateEcologySettings.safeParse({ actions: [{ key, enabled: false }] }).success).toBe(
        false,
      );
    }
    expect(
      EcologyConfig.safeParse({
        decisionModelKey: null,
        levels: {
          occasional: { min: 1, max: 2 },
          often: { min: 3, max: 5 },
          close: { min: 6, max: 9 },
          inseparable: { min: 10, max: 15 },
        },
        disabledActions: ['message'],
        wakeWindow: { startHour: 8, endHour: 24 },
        decisionMaxOutputTokens: 500,
      }).success,
    ).toBe(true);
    for (const key of REMOVED_KEYS) {
      expect(
        EcologyConfig.safeParse({
          decisionModelKey: null,
          levels: {
            occasional: { min: 1, max: 2 },
            often: { min: 3, max: 5 },
            close: { min: 6, max: 9 },
            inseparable: { min: 10, max: 15 },
          },
          disabledActions: [key],
          wakeWindow: { startHour: 8, endHour: 24 },
          decisionMaxOutputTokens: 500,
        }).success,
      ).toBe(false);
    }
  });

  it('响应侧容错：旧运行记录里的已删 key 读成 unsupported，不报错', () => {
    const base = {
      group: 'chat',
      label: '早安 / 晚安',
      available: true,
      unavailableReason: null,
      enabled: true,
    };
    for (const key of REMOVED_KEYS) {
      const parsed = EcologyAction.safeParse({ ...base, key });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.key).toBe('unsupported');
    }
    const murmur = EcologyMurmur.safeParse({
      murmurId: ID,
      characterId: ID,
      text: '今天天气不错。',
      actionKey: 'greeting',
      actionSummary: '跟你道了早安 / 晚安',
      points: 0,
      origin: 'ecology',
      createdAt: NOW,
    });
    expect(murmur.success).toBe(true);
    if (murmur.success) expect(murmur.data.actionKey).toBe('unsupported');
  });
});
