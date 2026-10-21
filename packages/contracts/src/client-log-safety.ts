/** 日志路由词表：未知片段一律视为 ID，绝不记录查询、搜索词或自由输入。 */
const segments = new Set(
  'api v1 admin me auth login register logout refresh profile settings security privacy about help support tickets replies seen feedback complaints users accounts characters contacts conversations messages groups members timeline episodes memories moments posts comments likes calls sessions token devices push sync updates media upload download assets stickers pets library favorites collections plaza works search candidates import export billing balance budgets ledger prices models model providers upstreams usage plans membership subscriptions orders roles requests public releases announcements status health growth play reminders focus letters wishlist daily-question notifications alerts client-logs realtime ws avatar cover banners read unread hidden clear recall forward retry resolve reopen receipts detail list code password phone email verify send bind unbind reset preferences theme backgrounds account delete chat discover'.split(
    ' ',
  ),
);
export function clientLogRoute(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? '/';
  return (
    '/' +
    clean
      .split('/')
      .filter(Boolean)
      .slice(0, 12)
      .map((s) => (segments.has(s) ? s : ':id'))
      .join('/')
  ).slice(0, 180);
}
/** Public code identifiers only; never use this as a privacy redactor. */
export function clientLogCodeId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
