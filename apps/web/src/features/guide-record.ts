import {
  CHAPTER_IDS,
  parseGuideRecord,
  type ChapterId,
  type GuideRecord,
} from './guide-triggers.js';

export const guideStorageKey = (userId: string) => `weiban:guided-tour:v1:${userId}`;
export function seenChapters(record: GuideRecord): ChapterId[] {
  const all = new Set([
    ...record.shown,
    ...record.completed,
    ...(record.paused ? [record.paused] : []),
  ]);
  return CHAPTER_IDS.filter((chapter) => all.has(chapter));
}
export function mergeGuideSeen(record: GuideRecord, seen: readonly ChapterId[]): GuideRecord {
  const all = new Set([...seenChapters(record), ...seen]);
  return { ...record, shown: CHAPTER_IDS.filter((chapter) => all.has(chapter)) };
}
export function readGuideRecord(key: string): GuideRecord {
  try {
    return parseGuideRecord(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return parseGuideRecord(null);
  }
}
/** 写入前并入其他页面的新标记；目录重置可以清学习进度，但不会重新启用自动提示。 */
export function writeGuideRecord(key: string, record: GuideRecord): GuideRecord {
  const next = mergeGuideSeen(record, seenChapters(readGuideRecord(key)));
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* 本机不可写时保留内存，并由账号端保存已见集合。 */
  }
  return next;
}
