import { z } from 'zod';
import { AuthResponse, Id, NotificationEnvelope } from '@weiban/contracts';
export const PushOwner = z.object({ userId: Id, sessionId: Id, enabled: z.boolean() });
export type PushOwner = z.infer<typeof PushOwner>;
export const PushControl = z.object({ type: z.literal('push.pause'), userId: Id, sessionId: Id });
/** 新客户端只接受完整归属；旧载荷或过期载荷不展示正文。 */
export function ownedNotification(
  raw: unknown,
  ownerRaw: unknown,
  sessionRaw: unknown,
  now: number,
): NotificationEnvelope | null {
  const notice = NotificationEnvelope.safeParse(raw);
  const owner = PushOwner.safeParse(ownerRaw);
  const auth = AuthResponse.safeParse(sessionRaw);
  if (!notice.success || !owner.success || !owner.data.enabled || !auth.success) return null;
  if (auth.data.session.kind !== 'app' || Date.parse(auth.data.session.expiresAt) <= now)
    return null;
  if (
    owner.data.userId !== auth.data.user.userId ||
    owner.data.sessionId !== auth.data.session.sessionId ||
    notice.data.recipientUserId !== owner.data.userId ||
    notice.data.recipientSessionId !== owner.data.sessionId
  )
    return null;
  const sent = Date.parse(notice.data.sentAt);
  if (sent > now + 60_000 || now - sent > 600_000) return null;
  return notice.data;
}
export function notificationRoute(value: string): string | null {
  return /^\/chat\/[0-9a-f-]{36}$/i.test(value) ||
    ['/chat', '/wallet', '/models', '/services'].includes(value)
    ? value
    : null;
}
