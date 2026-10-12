import { createHash } from 'node:crypto';
import {
  NotificationPayload,
  type NotificationSettings,
  type MessageContent,
} from '@weiban/contracts';

/** 时区必须来自已验证Profile；开始含边界、结束不含；跨午夜正确。 */
export function isDoNotDisturb(
  now: Date,
  timeZone: string,
  setting: NotificationSettings['doNotDisturb'],
): boolean {
  if (!setting.enabled) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const local = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  if (setting.start === setting.end) return true;
  return setting.start < setting.end
    ? local >= setting.start && local < setting.end
    : local >= setting.start || local < setting.end;
}

/** 按契约UTF-16长度限制裁剪，同时不截断代理对，避免半个emoji。 */
export function notificationText(input: string, limit: number): string {
  const normalized = Array.from(input, (char) => {
    const code = char.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  let result = '';
  for (const char of normalized) {
    if (result.length + char.length > limit) break;
    result += char;
  }
  return result;
}

export function messageNotification(input: {
  conversationId: string;
  name: string;
  content: MessageContent | null;
  scope: 'normal' | 'adult';
  /** 消息标签；含 health 时只显示「XX 发来一条消息」（CHAT-10 第 7 条，health-data.md 第 5 节）。 */
  labels?: readonly string[];
  count: number;
  settings: NotificationSettings;
  muted: boolean;
  quiet: boolean;
  sentAt: string;
}) {
  const name = notificationText(input.name, 48) || '微伴';
  // 慢信送达（PLAY-05 第 6 条，T-093）：角色寄来的信件卡片推送 kind = letter，不显示信的内容，点开到信箱里的这封信。
  if (input.content?.type === 'letter' && input.content.direction === 'from_character')
    return NotificationPayload.parse({
      v: 1,
      kind: 'letter',
      collapseKey: `letter:${input.content.letterId}`,
      title: name,
      body: `${name} 给你寄来了一封信`,
      count: 1,
      deepLink: `/play/letters/${input.content.letterId}`,
      conversationId: input.conversationId,
      sound: input.settings.pushSoundEnabled && !input.muted && !input.quiet,
      sentAt: input.sentAt,
    });
  let body = `${name} 发来一条消息`;
  if (input.count > 1) body = `${name} 发来 ${input.count} 条消息`;
  else if (
    input.settings.pushShowContent &&
    input.scope === 'normal' &&
    !input.labels?.includes('health') &&
    input.content
  ) {
    switch (input.content.type) {
      case 'text':
        body = input.content.text;
        break;
      case 'nudge':
        body = '[戳一戳]';
        break;
      default:
        body = '[消息]';
    }
  }
  return NotificationPayload.parse({
    v: 1,
    kind: 'message',
    collapseKey: input.conversationId,
    title: name,
    body: notificationText(body, 200),
    count: input.count,
    deepLink: `/chat/${input.conversationId}`,
    conversationId: input.conversationId,
    sound: input.settings.pushSoundEnabled && !input.muted && !input.quiet,
    sentAt: input.sentAt,
  });
}

/** Web Push Topic只有32字节的URL安全字符；不暴露角色名/内容。 */
export function notificationTopic(collapseKey: string): string {
  return createHash('sha256').update(collapseKey).digest('base64url').slice(0, 32);
}
