/** 表情包标签文本拼装：把 library_sticker_labels 的一行拼成选图用的 tags 数组。 */

/** listStickersForCharacter 从标签表读出的列（只取拼 tags 需要的文本列）。 */
export interface StickerLabelRow {
  primaryTag: string;
  fullDescription: string;
  imageText: string;
  literalMeaning: string;
  usageMeaning: string;
  suitableContexts: string;
}

/**
 * 标签行拼成 tags：主标签 + 五项完整意思（完整描述、图里原文字、字面意思、使用意思、适合场合）。
 * 「不适合场合」不拼入：否定语境里的词（如「不适合安慰」里的「安慰」）不能反过来当肯定含义匹配。
 * 图里无文字时打标为「无」，不是标签，丢掉；没有标签行或拼不出任何文本时返回 undefined（退回旧逻辑）。
 */
export function buildStickerLabelTags(
  label: StickerLabelRow | null | undefined,
): string[] | undefined {
  if (!label) return undefined;
  const tags = [
    label.primaryTag,
    label.fullDescription,
    label.imageText,
    label.literalMeaning,
    label.usageMeaning,
    label.suitableContexts,
  ]
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag !== '无');
  const unique = [...new Set(tags)];
  return unique.length ? unique : undefined;
}

/** listStickersForCharacter 的 JOIN 行：标签行可能不存在（回填前），存在时带两标记。 */
export interface StickerListJoinRow {
  stickerId: string;
  mediaId: string;
  description: string;
  label: (StickerLabelRow & { reviewNeeded: boolean; retryExcluded: boolean }) | null;
}

/** listStickersForCharacter 返回的候选行。 */
export interface StickerListOption {
  stickerId: string;
  mediaId: string;
  description: string;
  tags?: string[];
}

/**
 * JOIN 行 → 选图候选：已有标签行且 review_needed 或 retry_excluded 任一为 true 的整行排除
 * （彻底排除，返回 null，默认不参与选图）；无标签行保留、退回 description 旧逻辑；
 * 标签行两标记均为 false 时读出 tags。
 */
export function toStickerListOption(row: StickerListJoinRow): StickerListOption | null {
  if (row.label && (row.label.reviewNeeded || row.label.retryExcluded)) return null;
  const tags = buildStickerLabelTags(row.label);
  return {
    stickerId: row.stickerId,
    mediaId: row.mediaId,
    description: row.description,
    ...(tags ? { tags } : {}),
  };
}
