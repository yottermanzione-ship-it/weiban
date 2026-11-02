import { describe, expect, it } from 'vitest';
import {
  EMPTY_RECORD,
  canAutoStart,
  guideSeen,
  markShown,
  observeTier,
  parseGuideRecord,
  servicesGuideWanted,
  type GuideRecord,
  type MemberTier,
} from '../src/features/guide-triggers.js';

/** 模拟一台设备上依次看到的会员档位，返回最后的记录与「新开通」判断。 */
function observeAll(record: GuideRecord, tiers: MemberTier[]) {
  let newMember = false;
  for (const tier of tiers) {
    const result = observeTier(record, tier);
    record = result.record;
    newMember = result.newMember;
  }
  return { record, newMember };
}

describe('新手引导触发条件（T-20261103 第 2 项）', () => {
  it('情景预设：第一次进入聊天页时弹，弹过后不再弹', () => {
    let record = { ...EMPTY_RECORD };
    expect(canAutoStart(record, 'scenario')).toBe(true);
    record = markShown(record, 'scenario');
    expect(canAutoStart(record, 'scenario')).toBe(false);
    // 其他引导不受影响
    expect(canAutoStart(record, 'miniapps-pull')).toBe(true);
    expect(canAutoStart(record, 'ecology-services')).toBe(true);
  });

  it('小程序：第一次下拉打开面板时弹，弹过后不再弹', () => {
    let record = { ...EMPTY_RECORD };
    expect(canAutoStart(record, 'miniapps-pull')).toBe(true);
    record = markShown(record, 'miniapps');
    expect(canAutoStart(record, 'miniapps-pull')).toBe(false);
    expect(guideSeen(record, 'miniapps')).toBe(true);
  });

  it('在新手引导目录里学完的章节也算看过，不再自动弹', () => {
    const record: GuideRecord = { ...EMPTY_RECORD, completed: ['scenario', 'ecology'] };
    expect(canAutoStart(record, 'scenario')).toBe(false);
    expect(canAutoStart(record, 'ecology-services')).toBe(false);
    expect(canAutoStart(record, 'ecology-member')).toBe(false);
    expect(canAutoStart(record, 'miniapps-pull')).toBe(true);
  });

  it('角色生态 (a) 新会员：先看到免费、再看到 PRO+ 就是第一次开通，马上弹', () => {
    const { record, newMember } = observeAll({ ...EMPTY_RECORD }, ['free', 'pro_plus']);
    expect(newMember).toBe(true);
    expect(record.tier).toBe('pro_plus');
    expect(canAutoStart(record, 'ecology-member')).toBe(true);
  });

  it('角色生态 (c) 新会员开通时弹过，之后进「服务」不再弹', () => {
    let { record } = observeAll({ ...EMPTY_RECORD }, ['free', 'pro_plus']);
    record = markShown(record, 'ecology');
    expect(servicesGuideWanted(record.tier)).toBe(true);
    expect(canAutoStart(record, 'ecology-services')).toBe(false);
    // 到期后续费也不会再弹
    const renewed = observeAll(record, ['free', 'pro_plus']);
    expect(renewed.newMember).toBe(true);
    expect(canAutoStart(renewed.record, 'ecology-member')).toBe(false);
  });

  it('角色生态 (b) 老会员：从没看到过免费、直接是 PRO+，不算新开通；第一次进「服务」时弹一次', () => {
    const first = observeAll({ ...EMPTY_RECORD }, ['pro_plus', 'pro_plus']);
    expect(first.newMember).toBe(false);
    let record = first.record;
    expect(servicesGuideWanted(record.tier)).toBe(true);
    expect(canAutoStart(record, 'ecology-services')).toBe(true);
    record = markShown(record, 'ecology');
    // 再进服务、之后到期再续费都不再弹
    expect(canAutoStart(record, 'ecology-services')).toBe(false);
    const renewed = observeAll(record, ['free', 'pro_plus']);
    expect(canAutoStart(renewed.record, 'ecology-member')).toBe(false);
  });

  it('免费用户进「服务」不弹生态引导；一直免费也不算新开通', () => {
    const { record, newMember } = observeAll({ ...EMPTY_RECORD }, ['free', 'free']);
    expect(newMember).toBe(false);
    expect(servicesGuideWanted(record.tier)).toBe(false);
    expect(servicesGuideWanted(undefined)).toBe(false);
  });

  it('档位没变时不产生新记录对象（避免无谓写本机存储）', () => {
    const record: GuideRecord = { ...EMPTY_RECORD, tier: 'free' };
    expect(observeTier(record, 'free').record).toBe(record);
    const shown = markShown(record, 'scenario');
    expect(markShown(shown, 'scenario')).toBe(shown);
  });

  it('读旧版本机记录（只有 completed / paused）时补默认值，并丢掉不认识的值', () => {
    expect(parseGuideRecord({ completed: ['scenario', 'nope'], paused: 'miniapps' })).toEqual({
      completed: ['scenario'],
      paused: 'miniapps',
      shown: [],
      tier: null,
    });
    expect(parseGuideRecord({ shown: ['ecology', 1], tier: 'vip', paused: 'x' })).toEqual({
      completed: [],
      paused: null,
      shown: ['ecology'],
      tier: null,
    });
    expect(parseGuideRecord(null)).toEqual(EMPTY_RECORD);
    expect(parseGuideRecord('broken')).toEqual(EMPTY_RECORD);
  });
});
