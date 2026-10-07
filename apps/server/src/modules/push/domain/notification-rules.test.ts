import { describe, expect, it } from 'vitest';
import { newId } from '../../../platform/index.js';
import type { NotificationSettings } from '@weiban/contracts';
import {
  isDoNotDisturb,
  messageNotification,
  notificationText,
  notificationTopic,
} from './notification-rules.js';

const settings: NotificationSettings = {
  proactiveMessagesEnabled: true,
  proactiveCallsEnabled: false,
  pushSoundEnabled: true,
  pushShowContent: true,
  doNotDisturb: { enabled: true, start: '22:00', end: '08:00' },
  allowCharacterGroupInvites: true,
  updatedAt: '2026-10-06T12:00:00.000Z',
};
describe('通知隐私、免打扰与合并规则', () => {
  it('按本地时区跨午夜，含开始不含结束；同时间表示全天，关闭不拦', () => {
    for (const [date, expected] of [
      ['2026-10-06T13:59:00Z', false],
      ['2026-10-06T14:00:00Z', true],
      ['2026-10-06T23:59:00Z', true],
      ['2026-10-07T00:00:00Z', false],
    ] as const)
      expect(isDoNotDisturb(new Date(date), 'Asia/Shanghai', settings.doNotDisturb)).toBe(expected);
    expect(
      isDoNotDisturb(new Date('2026-10-07T00:00:00Z'), 'America/New_York', settings.doNotDisturb),
    ).toBe(false);
    expect(isDoNotDisturb(new Date(), 'UTC', { enabled: true, start: '08:00', end: '08:00' })).toBe(
      true,
    );
    expect(
      isDoNotDisturb(new Date(), 'UTC', { enabled: false, start: '08:00', end: '08:00' }),
    ).toBe(false);
    expect(
      isDoNotDisturb(new Date('2026-10-06T12:00:00Z'), 'UTC', {
        enabled: true,
        start: '09:00',
        end: '17:00',
      }),
    ).toBe(true);
  });
  it('adult及关闭内容永不泄漏文本；合并三条、静音、同会话点击与collapse', () => {
    const input = {
      conversationId: newId(),
      name: '备注',
      content: { type: 'text' as const, text: '正文金丝雀' },
      scope: 'normal' as const,
      count: 1,
      settings,
      muted: false,
      quiet: false,
      sentAt: settings.updatedAt,
    };
    expect(messageNotification(input).body).toBe('正文金丝雀');
    expect(messageNotification({ ...input, scope: 'adult' }).body).not.toContain('金丝雀');
    expect(
      messageNotification({ ...input, settings: { ...settings, pushShowContent: false } }).body,
    ).toBe('备注 发来一条消息');
    const merged = messageNotification({ ...input, count: 3, muted: true });
    expect(merged.body).toBe('备注 发来 3 条消息');
    expect(merged.sound).toBe(false);
    expect(merged.collapseKey).toBe(input.conversationId);
    expect(merged.deepLink).toBe(`/chat/${input.conversationId}`);
    expect(messageNotification({ ...input, quiet: true }).sound).toBe(false);
  });
  it('不截断emoji，清控制符；通道topic稳定且不含角色名或内容', () => {
    expect(notificationText('🙂🙂🙂', 5)).toBe('🙂🙂');
    expect(notificationText(' A\nB\u0000C ', 200)).toBe('A B C');
    const topic = notificationTopic('角色名与正文金丝雀');
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(topic).toBe(notificationTopic('角色名与正文金丝雀'));
  });
});
