/**
 * 旧角色卡导入计划（纯函数，不碰数据库）。
 *
 * 输入是旧库导出的 JSON：`characters`（characters_v2 整行）、`lorebook`
 * （character_lorebook_entries 整行）、`examples`（character_example_dialogues 整行）。
 * 输出「要创建什么 + 报告」，由 CLI 决定 dry-run 打印还是 apply 写库。
 *
 * 规则：
 * - 不转换字段：`characters` 的整行原样进 `legacy_card`，世界书 / 示例整行进附属表；
 * - 幂等：按旧 id 去重，已存在或同批重复的行只报告、不重复创建；
 * - 只报告不修改：字段缺失 / 超长都原样保留，报告里列出，导入不截断旧卡。
 */
import { LegacyCharacterCard, type CharacterClassificationInput } from '@weiban/contracts';
import { childFeaturesIn } from './child-features.js';

export interface LegacyImportInput {
  characters: readonly unknown[];
  lorebook: readonly unknown[];
  examples: readonly unknown[];
}

export interface LegacyImportExisting {
  characterIds: ReadonlySet<string>;
  lorebookIds: ReadonlySet<string>;
  exampleIds: ReadonlySet<string>;
}

export type LegacyImportKind = 'characters' | 'lorebook' | 'examples';

export interface LegacyImportIssue {
  kind: LegacyImportKind;
  /** 旧行的 id；没有 id 时用 `#序号`。 */
  id: string;
  field?: string;
  reason: string;
  length?: number;
  max?: number;
}

export interface LegacyCharacterPlan {
  id: string;
  /** characters_v2 一整行，原样进 legacy_card。 */
  row: Record<string, unknown>;
  name: string;
  searchText: string;
  categoryId: string;
  classification: CharacterClassificationInput;
  childFeaturesDetected: boolean;
  openingMessages: string[];
}

export interface LegacyRowPlan {
  id: string;
  characterId: string;
  /** 旧库一整行，原样进 payload。 */
  payload: Record<string, unknown>;
  sortOrder: number;
}

export interface LegacyImportPlan {
  characters: {
    total: number;
    toCreate: LegacyCharacterPlan[];
    alreadyExists: string[];
    duplicates: string[];
    invalid: LegacyImportIssue[];
    missing: LegacyImportIssue[];
    overlong: LegacyImportIssue[];
  };
  lorebook: {
    total: number;
    toCreate: LegacyRowPlan[];
    alreadyExists: string[];
    duplicates: string[];
    invalid: LegacyImportIssue[];
    missing: LegacyImportIssue[];
    overlong: LegacyImportIssue[];
    orphan: LegacyImportIssue[];
  };
  examples: {
    total: number;
    toCreate: LegacyRowPlan[];
    alreadyExists: string[];
    duplicates: string[];
    invalid: LegacyImportIssue[];
    missing: LegacyImportIssue[];
    overlong: LegacyImportIssue[];
    orphan: LegacyImportIssue[];
  };
}

/** 旧卡字段的实用上限：超过只报告，不截断。 */
export const LEGACY_FIELD_LIMITS = {
  display_name: 32,
  nickname: 32,
  signature: 60,
  alias: 100,
  core_persona: 20_000,
  speaking_style: 4_000,
  style_chat_style: 4_000,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean);
  const text = textOf(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.map(textOf).filter(Boolean);
  } catch {
    /* 旧库也有逗号分隔的写法 */
  }
  return text
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function checkLimit(
  issues: LegacyImportIssue[],
  kind: LegacyImportKind,
  id: string,
  field: string,
  value: string,
  max: number,
): void {
  if (value.length > max)
    issues.push({ kind, id, field, reason: 'overlong', length: value.length, max });
}

/**
 * 旧卡的分类默认值：身份类型明确为虚构 / 原创时按旧字段，其余按真人公众人物（宁可多审）。
 * 年龄没有可靠来源时默认 adult，儿童特征由文本检出另外标记。
 */
export function legacyClassification(row: Record<string, unknown>): CharacterClassificationInput {
  const identityType = textOf(pick(row, ['identity_type', 'identityType'])).toLowerCase();
  if (identityType === 'fictional')
    return {
      basis: 'fictional',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    };
  if (identityType === 'original')
    return { basis: 'original', realPersonKind: null, ageSetting: 'adult', childAppearance: false };
  if (identityType === 'historical')
    return {
      basis: 'real_person',
      realPersonKind: 'historical',
      ageSetting: 'adult',
      childAppearance: false,
    };
  return {
    basis: 'real_person',
    realPersonKind: 'celebrity',
    ageSetting: 'adult',
    childAppearance: false,
  };
}

/** 分类 ID（characters.categories 的固定四项）。 */
export function legacyCategoryId(classification: CharacterClassificationInput): string {
  if (classification.basis === 'fictional') return 'fictional';
  if (classification.basis === 'original') return 'original';
  return classification.realPersonKind === 'historical' ? 'historical' : 'celebrity';
}

export function buildLegacyImportPlan(
  input: LegacyImportInput,
  existing: LegacyImportExisting,
): LegacyImportPlan {
  const plan: LegacyImportPlan = {
    characters: {
      total: input.characters.length,
      toCreate: [],
      alreadyExists: [],
      duplicates: [],
      invalid: [],
      missing: [],
      overlong: [],
    },
    lorebook: {
      total: input.lorebook.length,
      toCreate: [],
      alreadyExists: [],
      duplicates: [],
      invalid: [],
      missing: [],
      overlong: [],
      orphan: [],
    },
    examples: {
      total: input.examples.length,
      toCreate: [],
      alreadyExists: [],
      duplicates: [],
      invalid: [],
      missing: [],
      overlong: [],
      orphan: [],
    },
  };
  const seenCharacters = new Set<string>();
  const seenLorebook = new Set<string>();
  const seenExamples = new Set<string>();
  const characterIds = new Set<string>(existing.characterIds);

  input.characters.forEach((value, index) => {
    const row = recordOf(value);
    const id = textOf(row ? pick(row, ['id']) : undefined);
    if (!row || !id) {
      plan.characters.invalid.push({
        kind: 'characters',
        id: id || `#${index + 1}`,
        reason: row ? 'missing_id' : 'not_an_object',
      });
      return;
    }
    if (!UUID_RE.test(id)) {
      plan.characters.invalid.push({ kind: 'characters', id, reason: 'invalid_uuid' });
      return;
    }
    const card = LegacyCharacterCard.from(row);
    const displayName = textOf(pick(row, ['display_name', 'displayName', 'name']));
    if (!displayName)
      plan.characters.missing.push({
        kind: 'characters',
        id,
        field: 'display_name',
        reason: 'missing',
      });
    if (!card?.corePersona)
      plan.characters.missing.push({
        kind: 'characters',
        id,
        field: 'core_persona',
        reason: 'missing',
      });
    if (!card?.openingMessages.length)
      plan.characters.missing.push({
        kind: 'characters',
        id,
        field: 'opening_messages_json',
        reason: 'empty',
      });
    const nickname = textOf(pick(row, ['nickname']));
    const signature = textOf(pick(row, ['signature', 'bio']));
    checkLimit(
      plan.characters.overlong,
      'characters',
      id,
      'display_name',
      displayName,
      LEGACY_FIELD_LIMITS.display_name,
    );
    checkLimit(
      plan.characters.overlong,
      'characters',
      id,
      'nickname',
      nickname,
      LEGACY_FIELD_LIMITS.nickname,
    );
    checkLimit(
      plan.characters.overlong,
      'characters',
      id,
      'signature',
      signature,
      LEGACY_FIELD_LIMITS.signature,
    );
    checkLimit(
      plan.characters.overlong,
      'characters',
      id,
      'core_persona',
      card?.corePersona ?? '',
      LEGACY_FIELD_LIMITS.core_persona,
    );
    checkLimit(
      plan.characters.overlong,
      'characters',
      id,
      'speaking_style',
      card?.speakingStyle ?? '',
      LEGACY_FIELD_LIMITS.speaking_style,
    );
    checkLimit(
      plan.characters.overlong,
      'characters',
      id,
      'style_chat_style',
      card?.styleChatStyle ?? '',
      LEGACY_FIELD_LIMITS.style_chat_style,
    );
    for (const alias of card?.aliases ?? [])
      checkLimit(
        plan.characters.overlong,
        'characters',
        id,
        'aliases_json',
        alias,
        LEGACY_FIELD_LIMITS.alias,
      );
    if (seenCharacters.has(id) || existing.characterIds.has(id)) {
      if (existing.characterIds.has(id)) plan.characters.alreadyExists.push(id);
      else plan.characters.duplicates.push(id);
      return;
    }
    seenCharacters.add(id);
    characterIds.add(id);
    const classification = legacyClassification(row);
    plan.characters.toCreate.push({
      id,
      row,
      name: (displayName || nickname || '未命名角色').slice(0, 32),
      searchText: [
        displayName,
        nickname,
        card?.canonicalName ?? '',
        ...(card?.aliases ?? []),
        signature,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 8000),
      categoryId: legacyCategoryId(classification),
      classification,
      childFeaturesDetected: childFeaturesIn(
        `${displayName}\n${card?.corePersona ?? ''}\n${card?.speakingStyle ?? ''}`,
      ),
      openingMessages: card?.openingMessages ?? [],
    });
  });

  const importCharacter = (value: unknown) => {
    const row = recordOf(value);
    const id = textOf(row ? pick(row, ['id']) : undefined);
    return { row, id };
  };

  input.lorebook.forEach((value, index) => {
    const { row, id } = importCharacter(value);
    const fallbackId = id || `#${index + 1}`;
    if (!row || !id) {
      plan.lorebook.invalid.push({
        kind: 'lorebook',
        id: fallbackId,
        reason: row ? 'missing_id' : 'not_an_object',
      });
      return;
    }
    const characterId = textOf(pick(row, ['character_id', 'characterId']));
    if (!characterId) {
      plan.lorebook.invalid.push({ kind: 'lorebook', id, reason: 'missing_character_id' });
      return;
    }
    const content = textOf(pick(row, ['content']));
    if (!content) {
      plan.lorebook.missing.push({ kind: 'lorebook', id, field: 'content', reason: 'missing' });
      return;
    }
    if (!listOf(pick(row, ['trigger_keys_json', 'trigger_keys', 'keys'])).length)
      plan.lorebook.missing.push({
        kind: 'lorebook',
        id,
        field: 'trigger_keys_json',
        reason: 'empty',
      });
    checkLimit(plan.lorebook.overlong, 'lorebook', id, 'content', content, 4000);
    for (const key of listOf(pick(row, ['trigger_keys_json', 'trigger_keys', 'keys'])))
      checkLimit(plan.lorebook.overlong, 'lorebook', id, 'trigger_keys_json', key, 100);
    if (!characterIds.has(characterId)) {
      plan.lorebook.orphan.push({ kind: 'lorebook', id, reason: 'character_not_imported' });
      return;
    }
    if (seenLorebook.has(id) || existing.lorebookIds.has(id)) {
      if (existing.lorebookIds.has(id)) plan.lorebook.alreadyExists.push(id);
      else plan.lorebook.duplicates.push(id);
      return;
    }
    seenLorebook.add(id);
    plan.lorebook.toCreate.push({
      id,
      characterId,
      payload: row,
      sortOrder: 0,
    });
  });

  input.examples.forEach((value, index) => {
    const { row, id } = importCharacter(value);
    const fallbackId = id || `#${index + 1}`;
    if (!row || !id) {
      plan.examples.invalid.push({
        kind: 'examples',
        id: fallbackId,
        reason: row ? 'missing_id' : 'not_an_object',
      });
      return;
    }
    const characterId = textOf(pick(row, ['character_id', 'characterId']));
    if (!characterId) {
      plan.examples.invalid.push({ kind: 'examples', id, reason: 'missing_character_id' });
      return;
    }
    const userText = textOf(pick(row, ['user_text', 'userText']));
    const assistantText = textOf(pick(row, ['assistant_text', 'assistantText']));
    if (!userText && !assistantText) {
      plan.examples.missing.push({
        kind: 'examples',
        id,
        field: 'user_text/assistant_text',
        reason: 'missing',
      });
      return;
    }
    checkLimit(plan.examples.overlong, 'examples', id, 'user_text', userText, 4000);
    checkLimit(plan.examples.overlong, 'examples', id, 'assistant_text', assistantText, 4000);
    if (!characterIds.has(characterId)) {
      plan.examples.orphan.push({ kind: 'examples', id, reason: 'character_not_imported' });
      return;
    }
    if (seenExamples.has(id) || existing.exampleIds.has(id)) {
      if (existing.exampleIds.has(id)) plan.examples.alreadyExists.push(id);
      else plan.examples.duplicates.push(id);
      return;
    }
    seenExamples.add(id);
    plan.examples.toCreate.push({
      id,
      characterId,
      payload: row,
      sortOrder: Number.parseInt(textOf(pick(row, ['sort_order', 'sortOrder'])) || '0', 10) || 0,
    });
  });

  return plan;
}

/** dry-run / apply 共用的报告（不含整行原文，避免刷屏）。 */
export function legacyImportReport(plan: LegacyImportPlan) {
  const summary = (part: {
    total: number;
    toCreate: unknown[];
    alreadyExists: string[];
    duplicates: string[];
    invalid: LegacyImportIssue[];
    missing: LegacyImportIssue[];
    overlong: LegacyImportIssue[];
  }) => ({
    total: part.total,
    toCreate: part.toCreate.length,
    alreadyExists: part.alreadyExists.length,
    duplicateCount: part.duplicates.length,
    invalidCount: part.invalid.length,
    missingFields: part.missing.length,
    overlongFields: part.overlong.length,
  });
  return {
    characters: {
      ...summary(plan.characters),
      sampleIds: plan.characters.toCreate.slice(0, 10).map((row) => row.id),
      duplicateIds: plan.characters.duplicates.slice(0, 50),
      alreadyExistIds: plan.characters.alreadyExists.slice(0, 50),
      missing: plan.characters.missing,
      overlong: plan.characters.overlong,
      invalid: plan.characters.invalid,
    },
    lorebook: {
      ...summary(plan.lorebook),
      orphan: plan.lorebook.orphan.length,
      sampleIds: plan.lorebook.toCreate.slice(0, 10).map((row) => row.id),
      duplicateIds: plan.lorebook.duplicates.slice(0, 50),
      alreadyExistIds: plan.lorebook.alreadyExists.slice(0, 50),
      missing: plan.lorebook.missing,
      overlong: plan.lorebook.overlong,
      invalid: plan.lorebook.invalid,
      orphans: plan.lorebook.orphan,
    },
    examples: {
      ...summary(plan.examples),
      orphan: plan.examples.orphan.length,
      sampleIds: plan.examples.toCreate.slice(0, 10).map((row) => row.id),
      duplicateIds: plan.examples.duplicates.slice(0, 50),
      alreadyExistIds: plan.examples.alreadyExists.slice(0, 50),
      missing: plan.examples.missing,
      overlong: plan.examples.overlong,
      invalid: plan.examples.invalid,
      orphans: plan.examples.orphan,
    },
  };
}
