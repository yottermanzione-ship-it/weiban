/**
 * 新手引导自动弹出的触发规则（任务卡 T-20261103 第 2 项）。纯逻辑，便于单测；界面在 onboarding-guide.tsx。
 *
 * 三个引导（章节）各自一生只自动弹一次：
 * - 情景预设 scenario：第一次进入私聊页（有「＋」的聊天）时弹；
 * - 小程序 miniapps：第一次下拉打开小程序面板时弹（面板版步骤）；
 * - 角色生态 ecology：
 *   (a) 新会员——这台设备上先看到过「免费」、之后看到「PRO+」，即第一次开通成功，马上弹；
 *   (b) 老会员——本次更新前就已是会员（这台设备上从没看到过「免费」），第一次进「服务」页时弹；
 *   (c) 任何一条路径弹过一次就记为已看过，之后都不再弹（例：更新后才开通的新会员，开通时弹过，进服务不再弹）。
 *
 * 「已看过」沿用引导现有的记录方式：本机 localStorage `weiban:guided-tour:v1:<用户ID>`，按账号区分。
 * 项目里没有现成的「服务端按用户存引导状态」机制，所以换设备、清浏览器数据后会再弹一次（交接已写明）。
 * 在新手引导目录里手动开始过（记入 shown）或学完（completed）的章节也算看过，不再自动弹。
 */
export type ChapterId = 'scenario' | 'miniapps' | 'ecology';
export const CHAPTER_IDS: readonly ChapterId[] = ['scenario', 'miniapps', 'ecology'];

/** 自动弹出的入口：同一章节可以有不同入口（生态的新会员 / 老会员）或不同步骤（小程序的下拉面板版）。 */
export type AutoFlow = 'scenario' | 'miniapps-pull' | 'ecology-services' | 'ecology-member';
export const FLOW_CHAPTER: Record<AutoFlow, ChapterId> = {
  scenario: 'scenario',
  'miniapps-pull': 'miniapps',
  'ecology-services': 'ecology',
  'ecology-member': 'ecology',
};

export type MemberTier = 'free' | 'pro_plus';

export interface GuideRecord {
  /** 走完的章节（目录里显示「已学会」）。 */
  completed: ChapterId[];
  /** 中途退出的章节（目录里「继续学习」）。 */
  paused: ChapterId | null;
  /** 已经弹过（自动弹出或在目录里手动开始）的章节：自动弹出一生只一次。 */
  shown: ChapterId[];
  /** 这台设备上最近一次看到的会员档位；null = 还没看到过（用来区分新老会员）。 */
  tier: MemberTier | null;
}

export const EMPTY_RECORD: GuideRecord = { completed: [], paused: null, shown: [], tier: null };

const isChapter = (value: unknown): value is ChapterId =>
  typeof value === 'string' && (CHAPTER_IDS as readonly string[]).includes(value);

/** 读本机记录；旧版记录（只有 completed / paused）照常读出，新字段取默认值。 */
export function parseGuideRecord(raw: unknown): GuideRecord {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RECORD };
  const saved = raw as Partial<Record<keyof GuideRecord, unknown>>;
  const chapters = (value: unknown) => (Array.isArray(value) ? value.filter(isChapter) : []);
  return {
    completed: chapters(saved.completed),
    paused: isChapter(saved.paused) ? saved.paused : null,
    shown: chapters(saved.shown),
    tier: saved.tier === 'free' || saved.tier === 'pro_plus' ? saved.tier : null,
  };
}

/** 这个章节算不算已经看过（自动弹过，或在目录里学完）。 */
export function guideSeen(record: GuideRecord, chapter: ChapterId): boolean {
  return record.shown.includes(chapter) || record.completed.includes(chapter);
}

/** 这个入口现在还能不能自动弹。 */
export function canAutoStart(record: GuideRecord, flow: AutoFlow): boolean {
  return !guideSeen(record, FLOW_CHAPTER[flow]);
}

/** 记下「已自动弹过」。 */
export function markShown(record: GuideRecord, chapter: ChapterId): GuideRecord {
  return record.shown.includes(chapter) ? record : { ...record, shown: [...record.shown, chapter] };
}

/**
 * 看到一次会员档位：记下来，并判断是不是「第一次开通成功」。
 * 只有这台设备上先看到过「免费」、现在看到「PRO+」才算新开通；从没看到过档位就直接是 PRO+ 的，
 * 是本次更新前就开通的老会员，交给「进服务页」那条路径。
 */
export function observeTier(
  record: GuideRecord,
  tier: MemberTier,
): { record: GuideRecord; newMember: boolean } {
  const newMember = tier === 'pro_plus' && record.tier === 'free';
  return { record: record.tier === tier ? record : { ...record, tier }, newMember };
}

/** 「服务」页的老会员路径：只有当前是 PRO+ 才弹。 */
export function servicesGuideWanted(tier: MemberTier | null | undefined): boolean {
  return tier === 'pro_plus';
}
