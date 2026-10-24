/**
 * 批量操作的纯逻辑：合并资格标注、从草稿里剔除选中条目。
 * 放在单独文件里方便单测；页面只负责弹窗和调用接口。
 */
import {
  CharacterEligibilityFacts,
  type AgeSetting,
  type CharacterBasis,
  type CharacterEligibilityFacts as Facts,
  type RealPersonKind,
} from '@weiban/contracts';

export interface EligibilityBatchPatch {
  basis?: CharacterBasis;
  /** basis = real_person 时用；不传则保留原类型，没有原类型时按「公众人物」。 */
  realPersonKind?: RealPersonKind | null;
  ageSetting?: AgeSetting;
  childAppearance?: boolean;
  childFeaturesDetected?: boolean;
}

/**
 * 以每个角色当前的人工标注（没有就用自动结果）为底，只覆盖本次勾选的字段。
 * 切换角色原型时同步修正真人类型，避免真人 / 非真人组合校验失败。
 */
export function applyEligibilityPatch(base: Facts, patch: EligibilityBatchPatch): Facts {
  const next: Facts = { ...base };
  if (patch.basis !== undefined) {
    next.basis = patch.basis;
    next.realPersonKind =
      patch.basis === 'real_person'
        ? (patch.realPersonKind ??
          (base.basis === 'real_person' ? base.realPersonKind : null) ??
          'celebrity')
        : null;
  } else if (patch.realPersonKind !== undefined) {
    if (base.basis !== 'real_person') throw new Error('只有真人角色才能设置真人类型');
    next.realPersonKind = patch.realPersonKind;
  }
  if (patch.ageSetting !== undefined) next.ageSetting = patch.ageSetting;
  if (patch.childAppearance !== undefined) next.childAppearance = patch.childAppearance;
  if (patch.childFeaturesDetected !== undefined)
    next.childFeaturesDetected = patch.childFeaturesDetected;
  return CharacterEligibilityFacts.parse(next);
}

/** 按 key 拆出「保留」和「删除」两组，保持原顺序。 */
export function splitSelected<T>(
  items: readonly T[],
  selectedKeys: readonly string[],
  keyOf: (item: T, index: number) => string,
): { remaining: T[]; removed: T[] } {
  const selected = new Set(selectedKeys);
  const remaining: T[] = [];
  const removed: T[] = [];
  items.forEach((item, index) => {
    if (selected.has(keyOf(item, index))) removed.push(item);
    else remaining.push(item);
  });
  return { remaining, removed };
}
