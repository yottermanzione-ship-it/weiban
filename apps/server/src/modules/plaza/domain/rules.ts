/**
 * plaza 纯函数（T-087）：P-34 热门窗口、快照文字字段、隐私片段遮盖、更严合并。
 * 「是否更严」的判定只在 policy（PolicyExtensionPort.compareClassification，hard-boundaries.md 第 6 节第 3 条）；
 * 这里的 mergeStricter 只用于管理员更正时给下游作品 / 角色算出「两者中更严的那一组」，结果仍交 policy 复核。
 */
import type {
  CharacterClassificationInput,
  ClassificationFacts,
  PlazaSnapshot,
  PlazaSnapshotClassification,
} from '@weiban/contracts';

/** P-34：「最近 7 天内：点赞数 × 1 + 添加 / 应用次数 × 2 + 评论数 × 1，从高到低；相同时较新的在前」。 */
export const HOT_WINDOW_DAYS = 7;
export const HOT_WEIGHTS = { like: 1, adopt: 2, comment: 1 } as const;

/** 发布草稿保留 24 小时（契约 PlazaPublishDraft）。 */
export const DRAFT_TTL_MS = 24 * 3600_000;

/** 未被用户确认保留的片段替换成的遮盖符（PLZ-02 第 6 条）。 */
export const MASK = '▢';

export const DELETED_AUTHOR_NAME = '已注销用户';

/** 快照里交给隐私检查的文字字段（fieldKey 与契约 PrivacySpan.fieldKey 一致）。 */
export function snapshotTexts(snapshot: PlazaSnapshot): Array<{ fieldKey: string; text: string }> {
  if (snapshot.kind === 'preset_variant')
    return [{ fieldKey: 'variantText', text: snapshot.variantText }];
  const out: Array<{ fieldKey: string; text: string }> = [
    { fieldKey: 'name', text: snapshot.name },
    { fieldKey: 'description', text: snapshot.description },
    { fieldKey: 'speechStyle', text: snapshot.speechStyle },
    { fieldKey: 'exampleDialogue', text: snapshot.exampleDialogue },
  ];
  snapshot.catchphrases.forEach((text, i) => out.push({ fieldKey: `catchphrases.${i}`, text }));
  snapshot.tags.forEach((text, i) => out.push({ fieldKey: `tags.${i}`, text }));
  return out.filter((t) => t.text.length > 0);
}

interface Span {
  fieldKey: string;
  start: number;
  end: number;
}

/** 把一段文字中的若干区间各替换成一个遮盖符；重叠区间合并。 */
export function maskText(text: string, spans: Array<{ start: number; end: number }>): string {
  const sorted = spans
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(text.length, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  let out = text;
  for (let i = merged.length - 1; i >= 0; i -= 1) {
    const m = merged[i]!;
    out = out.slice(0, m.start) + MASK + out.slice(m.end);
  }
  return out;
}

/** 按字段遮盖快照；返回新对象，不改入参。 */
export function maskSnapshot(snapshot: PlazaSnapshot, spans: Span[]): PlazaSnapshot {
  const byField = new Map<string, Span[]>();
  for (const s of spans) byField.set(s.fieldKey, [...(byField.get(s.fieldKey) ?? []), s]);
  const apply = (key: string, text: string) => {
    const list = byField.get(key);
    return list?.length ? maskText(text, list) : text;
  };
  if (snapshot.kind === 'preset_variant')
    return { ...snapshot, variantText: apply('variantText', snapshot.variantText) };
  return {
    ...snapshot,
    name: apply('name', snapshot.name),
    description: apply('description', snapshot.description),
    speechStyle: apply('speechStyle', snapshot.speechStyle),
    exampleDialogue: apply('exampleDialogue', snapshot.exampleDialogue),
    catchphrases: snapshot.catchphrases.map((t, i) => apply(`catchphrases.${i}`, t)),
    tags: snapshot.tags.map((t, i) => apply(`tags.${i}`, t)),
  };
}

export function toFacts(c: PlazaSnapshotClassification): ClassificationFacts {
  return {
    basis: c.basis,
    realPersonKind: c.realPersonKind,
    ageSetting: c.ageSetting,
    childAppearance: c.childAppearance,
    childFeaturesDetected: c.childFeaturesDetected,
    everPrivatePerson: c.everPrivatePerson,
  };
}

/**
 * 管理员更正连带下游时：在「下游当前分类」和「管理员给出的目标分类」之间逐项取更严的一边。
 * 真人优先于原创 / 虚构；未满 18 岁优先于成年；布尔标记取或。
 */
export function mergeStricter(
  current: PlazaSnapshotClassification,
  target: CharacterClassificationInput & { childFeaturesDetected?: boolean },
): PlazaSnapshotClassification {
  const basis =
    current.basis === 'real_person' || target.basis === 'real_person'
      ? 'real_person'
      : current.basis;
  const realPersonKind =
    basis === 'real_person'
      ? current.basis === 'real_person'
        ? current.realPersonKind
        : (target.realPersonKind ?? null)
      : null;
  return {
    basis,
    realPersonKind,
    ageSetting: current.ageSetting === 'minor' || target.ageSetting === 'minor' ? 'minor' : 'adult',
    childAppearance: current.childAppearance || target.childAppearance,
    childFeaturesDetected: current.childFeaturesDetected || !!target.childFeaturesDetected,
    everPrivatePerson: current.everPrivatePerson || realPersonKind === 'private_person',
  };
}

export function toClassificationInput(
  c: PlazaSnapshotClassification,
): CharacterClassificationInput {
  return {
    basis: c.basis,
    realPersonKind: c.realPersonKind,
    ageSetting: c.ageSetting,
    childAppearance: c.childAppearance,
  } as CharacterClassificationInput;
}

export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function encodeOffset(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const n = raw.startsWith('o:') ? Number.parseInt(raw.slice(2), 10) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
