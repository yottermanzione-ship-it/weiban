/*
 * F1-5「设个状态」图标：自绘同风格线性图标（24 网格、1.6 线宽、圆头），不使用微信图标文件。
 * 状态项沿用契约里的预设（USER_STATUS_PRESETS）；契约之外补齐的项按「自定义 + 文字」保存，
 * 显示时按文字认回对应图标（服务器与角色读到的就是这段文字）。
 */
import type { ReactNode } from 'react';
import type { UserStatus, UserStatusPreset } from '@weiban/contracts';

const paths: Record<string, ReactNode> = {
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5v1M15 9.5v1" />
    </>
  ),
  rain: (
    <path d="M7.5 15h9.5a3.5 3.5 0 0 0 .3-6.99A5.5 5.5 0 0 0 6.6 9.1 3 3 0 0 0 7.5 15zM9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5" />
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  thermometer: <path d="M10 4.5a2 2 0 0 1 4 0v8.8a4 4 0 1 1-4 0zM12 9v7" />,
  blank: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10h2M13.5 10h2M10 15.5h4" />
    </>
  ),
  sparkle: (
    <path d="M11 3.5l1.8 5.2L18 10.5l-5.2 1.8L11 17.5l-1.8-5.2L4 10.5l5.2-1.8zM18.5 15.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />
  ),
  thought: (
    <>
      <path d="M8.5 13.5h8a3 3 0 0 0 .4-5.97A4.5 4.5 0 0 0 8.4 7a3.25 3.25 0 0 0 .1 6.5z" />
      <circle cx="7.5" cy="17.5" r="1.3" />
      <circle cx="4.8" cy="20.2" r=".8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  heartCrack: (
    <path d="M12 20s-7.5-4.5-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.5 12 20 12 20zM12 7.3l-1.6 3.8 3 1.6-1.4 3.5" />
  ),
  book: (
    <path d="M3.5 5.5c3-.8 5.8-.5 8.5 1.5v12c-2.7-2-5.5-2.3-8.5-1.5zM20.5 5.5c-3-.8-5.8-.5-8.5 1.5v12c2.7-2 5.5-2.3 8.5-1.5z" />
  ),
  laptop: (
    <>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
      <path d="M2.5 19h19" />
    </>
  ),
  hourglass: (
    <path d="M6.5 3.5h11M6.5 20.5h11M8 3.5c0 4 4 5.5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5.5-4 8.5s4 4.5 4 8.5" />
  ),
  fish: (
    <>
      <path d="M16.5 12c-2.5 3.5-7 5-11 2.5L3 12l2.5-2.5c4-2.5 8.5-1 11 2.5zM16.5 12L21 8.5v7z" />
      <circle cx="7.5" cy="11.2" r=".5" />
    </>
  ),
  suitcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5v-2A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2M3.5 13h17" />
    </>
  ),
  balloon: (
    <path d="M12 3a5.5 5.5 0 0 1 5.5 5.5c0 3.5-3 6.5-5.5 7.5-2.5-1-5.5-4-5.5-7.5A5.5 5.5 0 0 1 12 3zM11 16.3l1 1.2 1-1.2M12 17.5c-1 1.2 1 2.3 0 3.5" />
  ),
  gamepad: (
    <>
      <path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 4a2.5 2.5 0 0 1-4.3 1.3L14.5 16h-5l-1.6 1.8a2.5 2.5 0 0 1-4.3-1.3l-.6-4A4 4 0 0 1 7 8zM8 10.8v3.4M6.3 12.5h3.4" />
      <circle cx="15.5" cy="11.5" r=".6" />
      <circle cx="17" cy="13.5" r=".6" />
    </>
  ),
  plane: <path d="M21 3.5L3 10.5l7 3 3 7zM10 13.5L21 3.5" />,
  bed: (
    <>
      <path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" />
      <circle cx="7" cy="11.5" r="1.6" />
    </>
  ),
  dumbbell: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />,
  coffee: (
    <path d="M4.5 10h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16.5 11.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8.5 3.5c-.8 1 .8 2 0 3.5M12.5 3.5c-.8 1 .8 2 0 3.5" />
  ),
  milkTea: (
    <>
      <path d="M5.5 8.5h13M6.8 8.5h10.4l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H9.5A1.5 1.5 0 0 1 8 19.7zM13 8.5l1.5-6h2" />
      <circle cx="10" cy="17" r=".7" />
      <circle cx="12.5" cy="18" r=".7" />
      <circle cx="14" cy="15.8" r=".7" />
    </>
  ),
  bowl: <path d="M3.5 11.5h17c0 4.7-3.8 8-8.5 8s-8.5-3.3-8.5-8zM11 11.5L19.5 3M14 11.5l7-5.5" />,
  pencil: <path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19zM14 7l3 3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
};
export type StatusIconName = keyof typeof paths;

export function StatusIcon({ name, size = 28 }: { name: StatusIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export type StatusChoice = {
  /** 唯一键：契约预设名，或 custom:文字。 */
  key: string;
  label: string;
  icon: StatusIconName;
  preset: UserStatusPreset;
  /** 补齐项：按自定义文字保存。 */
  text?: string;
};
const preset = (p: UserStatusPreset, label: string, icon: StatusIconName): StatusChoice => ({
  key: p,
  label,
  icon,
  preset: p,
});
const extra = (label: string, icon: StatusIconName): StatusChoice => ({
  key: `custom:${label}`,
  label,
  icon,
  preset: 'custom',
  text: label,
});

export const STATUS_GROUPS: ReadonlyArray<{ title: string; items: StatusChoice[] }> = [
  {
    title: '心情想法',
    items: [
      preset('happy', '开心', 'smile'),
      preset('down', '有点低落', 'rain'),
      preset('quiet', '想静静', 'moon'),
      preset('sick', '不舒服', 'thermometer'),
      extra('发呆', 'blank'),
      extra('元气满满', 'sparkle'),
      extra('胡思乱想', 'thought'),
      extra('等天晴', 'sun'),
      extra('emo', 'heartCrack'),
    ],
  },
  {
    title: '工作学习',
    items: [
      preset('studying', '学习中', 'book'),
      preset('working', '工作中', 'laptop'),
      preset('busy', '忙碌', 'hourglass'),
      extra('摸鱼', 'fish'),
      extra('出差', 'suitcase'),
    ],
  },
  {
    title: '活动',
    items: [
      preset('out_playing', '出去玩', 'balloon'),
      preset('gaming', '打游戏', 'gamepad'),
      preset('travelling', '旅行中', 'plane'),
      preset('sleeping', '睡觉中', 'bed'),
      extra('运动', 'dumbbell'),
      extra('喝咖啡', 'coffee'),
      extra('喝奶茶', 'milkTea'),
      extra('干饭', 'bowl'),
      preset('custom', '自定义', 'pencil'),
    ],
  },
];
const allChoices = STATUS_GROUPS.flatMap((g) => g.items);

/** 当前状态对应的图标：先按预设、再按补齐项文字，认不出用铅笔（自定义）。 */
export function statusIconOf(status: Pick<UserStatus, 'preset' | 'text'>): StatusIconName {
  if (status.preset === 'custom') {
    const hit = allChoices.find((c) => c.text && c.text === status.text);
    return hit?.icon ?? 'pencil';
  }
  return allChoices.find((c) => c.key === status.preset)?.icon ?? 'pencil';
}
/** 当前状态在宫格里对应哪一项（用于高亮）。 */
export function statusChoiceOf(status: Pick<UserStatus, 'preset' | 'text'>): StatusChoice {
  if (status.preset === 'custom')
    return (
      allChoices.find((c) => c.text && c.text === status.text) ??
      allChoices.find((c) => c.key === 'custom')!
    );
  return (
    allChoices.find((c) => c.key === status.preset) ?? allChoices.find((c) => c.key === 'custom')!
  );
}
