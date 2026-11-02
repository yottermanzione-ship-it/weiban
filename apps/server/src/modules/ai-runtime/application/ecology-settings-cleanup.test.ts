/**
 * 2026-11-02 生态动作清理的存量兼容：平台配置容错解析与用户开关写回 pruning（纯函数）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ECOLOGY_CONFIG } from '../domain/ecology.js';
import { mergeDisabledActions, parseEcologyConfigLenient } from './ecology-settings.js';

describe('parseEcologyConfigLenient', () => {
  it('剥离 disabledActions 里的已删 key，其余配置原样保留', () => {
    const parsed = parseEcologyConfigLenient({
      ...DEFAULT_ECOLOGY_CONFIG,
      decisionModelKey: 'jev/jev-latest',
      disabledActions: ['share_link', 'message', 'care_period', 'play_wish'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.disabledActions).toEqual(['message']);
    expect(parsed?.decisionModelKey).toBe('jev/jev-latest');
    expect(parsed?.levels).toEqual(DEFAULT_ECOLOGY_CONFIG.levels);
  });

  it('disabledActions 全是已删 key 时解析成功、为空数组（不整体回退默认）', () => {
    const parsed = parseEcologyConfigLenient({
      ...DEFAULT_ECOLOGY_CONFIG,
      decisionModelKey: 'jev/jev-latest',
      disabledActions: ['care_weather', 'play_letter'],
    });
    expect(parsed?.disabledActions).toEqual([]);
    expect(parsed?.decisionModelKey).toBe('jev/jev-latest');
  });

  it('其余字段非法时仍解析失败（不掩盖真错误）', () => {
    expect(
      parseEcologyConfigLenient({
        ...DEFAULT_ECOLOGY_CONFIG,
        disabledActions: ['share_link'],
        wakeWindow: { startHour: 20, endHour: 8 },
      }),
    ).toBeNull();
    expect(parseEcologyConfigLenient(null)).toBeNull();
    expect(parseEcologyConfigLenient('nope')).toBeNull();
    expect(
      parseEcologyConfigLenient({ ...DEFAULT_ECOLOGY_CONFIG, disabledActions: 'message' }),
    ).toBeNull();
  });
});

describe('mergeDisabledActions', () => {
  it('合并变更并剥离存量未知 key', () => {
    expect(
      mergeDisabledActions(
        ['share_link', 'message', 'play_wish'],
        [{ key: 'voice', enabled: false }],
      ),
    ).toEqual(['message', 'voice']);
    // 关掉 message 后再打开：从禁用集合里移除。
    expect(
      mergeDisabledActions(['message', 'share_link'], [{ key: 'message', enabled: true }]),
    ).toEqual([]);
  });

  it('无变更时也清掉存量垃圾', () => {
    expect(mergeDisabledActions(['care_period', 'greeting', 'status'], [])).toEqual(['status']);
    expect(mergeDisabledActions([], [])).toEqual([]);
  });
});
