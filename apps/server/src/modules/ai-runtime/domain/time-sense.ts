/**
 * 时间感知（docs/refactor/03 第 2.2 A、F 节）：
 * - 前缀里只放「今天几号」（一天才变一次，不打断前缀缓存）；
 * - 精确时间和「距上一条消息多久」放在请求最后（旧版「时间三明治」的结尾那片，模型最重视结尾）。
 * 爱语的阈值：距上一条超过 3 分钟才告诉模型离开了多久。
 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function parts(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const map = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday ?? '');
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: map.minute ?? '00',
    weekday: WEEKDAYS[weekdayIndex] ?? '',
  };
}

function period(hour: number): string {
  if (hour < 5) return '凌晨';
  if (hour < 8) return '早上';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 18) return '下午';
  if (hour < 23) return '晚上';
  return '深夜';
}

/** 前缀用：只到日期。 */
export function todayLine(now: Date, timeZone: string): string {
  const p = parts(now, timeZone);
  return `今天是${p.year}年${p.month}月${p.day}日${p.weekday}`;
}

function gapText(ms: number): string | null {
  const minutes = Math.floor(ms / 60000);
  if (minutes <= 3) return null;
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `约 ${hours} 小时`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '隔了一天' : `隔了 ${days} 天`;
}

/** 尾部用：精确到分钟的当地时间 + 距上一条消息多久（超过 3 分钟才写）。 */
export function nowLine(now: Date, timeZone: string, previousAt: Date | null): string {
  const p = parts(now, timeZone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const gap = previousAt ? gapText(now.getTime() - previousAt.getTime()) : null;
  return `【现在】${p.month}月${p.day}日${p.weekday} ${period(p.hour)} ${hour12}:${p.minute}（当地时间）${
    gap ? `；距上一条消息${gap}，可以自然地察觉，但不要追问或责怪` : ''
  }。这是背景信息，不需要主动报时。`;
}

/** 当地小时（0–23）。 */
export function localHourIn(now: Date, timeZone: string): number {
  return parts(now, timeZone).hour;
}
