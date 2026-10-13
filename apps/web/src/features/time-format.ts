/*
 * 旧版时间格式（docs/refactor/06-old-ui-spec.md 4.2、4.4.2）。
 * 时段：凌晨 0–6 / 上午 6–12 / 中午 12–13 / 下午 13–18 / 晚上 18–24；时段与数字之间无空格。
 */
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function period(date: Date): string {
  const h = date.getHours();
  const label = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${label}${hour12}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
function dayDiff(date: Date, now: Date) {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

/** 会话列表右上时间：刚刚 / 上午7:56 / 昨天 / 周一 / 6月1日。 */
export function listTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < 60_000) return '刚刚';
  const days = dayDiff(date, now);
  if (days <= 0) return period(date);
  if (days === 1) return '昨天';
  if (days < 7) return weekdays[date.getDay()]!;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 聊天时间条：上午9:25 / 昨天 下午3:46 / 周一 上午9:25 / 6月1日 下午8:07。 */
export function dividerTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = dayDiff(date, now);
  if (days <= 0) return period(date);
  if (days === 1) return `昨天 ${period(date)}`;
  if (days < 7) return `${weekdays[date.getDay()]} ${period(date)}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${period(date)}`;
}

/** 相邻两条消息间隔超过 5 分钟才显示时间条。 */
export function needsDivider(previous: string | undefined, current: string): boolean {
  if (!previous) return true;
  return new Date(current).getTime() - new Date(previous).getTime() > 5 * 60_000;
}
