import type { EvalCase } from './index.js';
import { L2_CASES } from '../cases/l2.js';
import { L3_CASES, L3_PROACTIVE_CASES } from '../cases/l3.js';
import { L4_GROUP_CASES, L4_SOCIAL_CASES } from '../cases/l4.js';
import { L6_PET_CASES } from '../cases/l6.js';
import { L7_PLAY_CASES } from '../cases/l7.js';
import { SAFETY_CARE_CASES } from '../cases/safety-care.js';
import { CROSS_CHARACTER_CASES } from '../cases/cross-character.js';
import { TIME_AWARENESS_CASES } from '../cases/time-awareness.js';
import { RELATIONSHIP_CASES } from '../cases/relationships.js';
import {
  ADULT_CONTENT_CASES,
  ADULT_CONTROL_CASES,
  ADULT_RESTRICTED_CHARACTER_CASES,
} from '../cases/adult-boundaries.js';
import { PROACTIVE_TONE_CASES, PROACTIVE_SAFETY_CASES } from '../cases/proactive-boundaries.js';
import {
  REAL_PERSON_BOUNDARY_CASES,
  CHILD_PROTECTION_CASES,
} from '../cases/character-boundaries.js';
import { KEEP_CHATTING_CASES, MEMORY_TIER_CASES } from '../cases/v5-memory.js';

/** 已落地的考题登记，不等于eval-plan全部19类已覆盖。 */
export const EVAL_CASE_VERSION = '2026-10-20.1';
export const EVAL_SUITES = {
  l2: L2_CASES,
  l3_simulation: L3_CASES,
  l3_proactive: L3_PROACTIVE_CASES,
  l4_group: L4_GROUP_CASES,
  l4_social: L4_SOCIAL_CASES,
  l6_pet: L6_PET_CASES,
  l7_play: L7_PLAY_CASES,
  safety_care: SAFETY_CARE_CASES,
  real_person_boundary: REAL_PERSON_BOUNDARY_CASES,
  child_protection: CHILD_PROTECTION_CASES,
  cross_character_sharing: CROSS_CHARACTER_CASES,
  time_awareness: TIME_AWARENESS_CASES,
  proactive_tone: PROACTIVE_TONE_CASES,
  proactive_safety: PROACTIVE_SAFETY_CASES,
  relationships: RELATIONSHIP_CASES,
  adult_content: ADULT_CONTENT_CASES,
  adult_controls: ADULT_CONTROL_CASES,
  adult_restricted_characters: ADULT_RESTRICTED_CHARACTER_CASES,
  // v5 批 B：留住人、记忆分档与翻聊天记录。
  keep_chatting: KEEP_CHATTING_CASES,
  memory_tiers: MEMORY_TIER_CASES,
} as const;
export const EVAL_CASES: readonly EvalCase[] = Object.values(EVAL_SUITES).flat();

export interface EvalCharacter {
  id: string;
  name: string;
  basis: 'original' | 'real_person' | 'fictional';
  realPersonKind: 'celebrity' | null;
  ageSetting: 'adult' | 'minor';
  source: string;
  /** 所有评测角色禁止上架，示例真人也不表示现实人物。 */
  evaluationOnly: true;
}

export const EVAL_CHARACTERS: readonly EvalCharacter[] = [
  ...[
    ['S-01', '阿澈', 'S-01-cheng-che.md'],
    ['S-02', '温言', 'S-02-wen-yan.md'],
    ['S-03', '沈砚秋', 'S-03-shen-yanqiu.md'],
    ['S-04', '苏乔', 'S-04-su-qiao.md'],
    ['S-05', '顾承野', 'S-05-gu-chengye.md'],
    ['S-06', '陆遥川', 'S-06-lu-yaochuan.md'],
  ].map(([id, name, file]) => ({
    id: id!,
    name: name!,
    basis: 'original' as const,
    realPersonKind: null,
    ageSetting: 'adult' as const,
    source: `docs/ai/samples/${file}`,
    evaluationOnly: true as const,
  })),
  {
    id: 'R-01',
    name: '林夏予',
    basis: 'real_person',
    realPersonKind: 'celebrity',
    ageSetting: 'adult',
    source: 'docs/ai/eval-plan.md',
    evaluationOnly: true,
  },
  {
    id: 'C-01',
    name: '罗小黑',
    basis: 'fictional',
    realPersonKind: null,
    ageSetting: 'minor',
    source: 'docs/ai/eval-plan.md',
    evaluationOnly: true,
  },
];

/** 兼容已有儿童用例的child编号；其他未知编号不得默认成S-01。 */
export function resolveEvalCharacter(id: string): EvalCharacter | undefined {
  return EVAL_CHARACTERS.find((role) => role.id === (id === 'child' ? 'C-01' : id));
}

export function validateEvalRegistry(): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const test of EVAL_CASES) {
    if (ids.has(test.id)) problems.push(`duplicate_case:${test.id}`);
    ids.add(test.id);
    if (!resolveEvalCharacter(test.setup.character)) problems.push(`unknown_character:${test.id}`);
    const source = test.setup.crossCharacter?.sourceCharacter;
    if (source && (!resolveEvalCharacter(source) || source === test.setup.character))
      problems.push(`invalid_source_character:${test.id}`);
    if (!test.prdRefs.length || !test.judgeRubric.trim())
      problems.push(`missing_requirement:${test.id}`);
  }
  return problems;
}
