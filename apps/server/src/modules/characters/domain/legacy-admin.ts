/**
 * 旧卡后台编辑（纯函数，不碰数据库）。
 *
 * **旧卡就是运行格式**：只读写 `characters.legacy_card` 里的旧字段与两张附属表（世界书 / 示例），
 * 不产生也不读取 WB-Card 密文，不做格式转换。保存规则：
 * - 白名单字段局部合并：`fields` 里没传的字段原样保留；
 * - 明确清空：字段值为空串 / 空数组 / null，或列在 `clear` 里时删除对应旧键（核心人设与名字不可清空）；
 * - 白名单以外的旧字段（raw_json、voice_json、source_json …）一律不动，原样保留；
 * - 世界书 / 示例只动提交的条目，并且必须属于本角色；未提交的键在条目内保留（浅合并）。
 *
 * 这里只算「要变成什么」，数据库读写与审计由 CharacterLegacyAdminService 负责。
 */
import type {
  AdminLegacyCharacterPatch,
  AdminLegacyClearableField,
  AdminLegacyDialogueExample,
  AdminLegacyFields,
  AdminLegacyLorebookEntry,
} from '@weiban/contracts';
import { parseLegacyCard } from './legacy-card.js';

/** 逻辑字段名 → 旧卡（旧库 characters_v2）字段名。 */
export const LEGACY_FIELD_KEYS = {
  displayName: 'display_name',
  nickname: 'nickname',
  aliases: 'aliases_json',
  signature: 'signature',
  corePersona: 'core_persona',
  speakingStyle: 'speaking_style',
  relationshipMode: 'relationship_mode',
  momentProfile: 'moment_profile_json',
  groupChat: 'group_chat_json',
  openingMessages: 'opening_messages_json',
} as const;

export type LegacyAdminField = keyof typeof LEGACY_FIELD_KEYS;

const FIELD_KEYS = Object.values(LEGACY_FIELD_KEYS);
const FIELD_KEY_SET = new Set<string>(FIELD_KEYS);
/** 旧行自带的元数据列，不进「未识别字段」列表。 */
const STRUCTURAL_KEYS = new Set(['id', 'created_at', 'updated_at']);

/** 旧卡里的 JSON 文本字段：旧库存的是字符串化 JSON，读的时候解析。 */
function decodeJsonText(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 旧卡 JSON 文本 → 结构化值。旧库把对象/数组存成 JSON 文本，`JSON.parse` 的结果就是可写回的 JSON 值；
 * 解析失败按「没有这个设定」处理（原文仍在 preserved 里只读保留）。
 */
function jsonValue(value: unknown): AdminLegacyFields['momentProfile'] {
  return decodeJsonText(value) as AdminLegacyFields['momentProfile'];
}

/** 读旧卡可编辑字段（供后台详情用）。 */
export function readLegacyAdminFields(raw: Record<string, unknown>): AdminLegacyFields {
  const card = parseLegacyCard(raw);
  return {
    displayName: card?.displayName ?? '',
    nickname: card?.nickname ?? '',
    aliases: card?.aliases ?? [],
    signature: card?.signature ?? '',
    corePersona: card?.corePersona ?? '',
    speakingStyle: card?.speakingStyle ?? '',
    relationshipMode: card?.relationshipMode ?? '',
    momentProfile: jsonValue(raw.moment_profile_json),
    groupChat: jsonValue(raw.group_chat_json),
    openingMessages: card?.openingMessages ?? [],
  };
}

/** 白名单以外、未识别的旧字段：只读保留，保存时不会被覆盖。 */
export function legacyPreservedFields(raw: Record<string, unknown>): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (STRUCTURAL_KEYS.has(key) || FIELD_KEY_SET.has(key)) continue;
    preserved[key] = value;
  }
  return preserved;
}

/** 运行时搜索用文本（与导入时的算法一致：名字 / 昵称 / 本名 / 别名 / 签名）。 */
export function legacySearchText(raw: Record<string, unknown>): string {
  const card = parseLegacyCard(raw);
  return [
    card?.displayName,
    card?.nickname,
    card?.canonicalName,
    ...(card?.aliases ?? []),
    card?.signature,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .slice(0, 8000);
}

/** 旧卡名字（≤32，与导入一致）。 */
export function legacyDisplayName(raw: Record<string, unknown>): string {
  const card = parseLegacyCard(raw);
  return (card?.displayName || card?.nickname || '未命名角色').slice(0, 32);
}

export type LegacyPrepare<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'invalid'; message: string }
  | { ok: false; kind: 'conflict'; message: string; currentRevision: number };

function invalid(message: string): { ok: false; kind: 'invalid'; message: string } {
  return { ok: false, kind: 'invalid', message };
}

/** 写回旧卡的编码：字符串原样；数组 / 对象按旧库约定存 JSON 文本；空值 = 删键。 */
function encodeField(field: LegacyAdminField, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (field) {
    case 'momentProfile':
    case 'groupChat': {
      if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return null;
        JSON.parse(text); // 非法 JSON 由调用方按 invalid 处理
        return text;
      }
      return JSON.stringify(value);
    }
    case 'aliases':
    case 'openingMessages': {
      const list = Array.isArray(value)
        ? value.map((item) => textOf(item).trim()).filter(Boolean)
        : [];
      return list.length ? JSON.stringify(list) : null;
    }
    case 'displayName':
    case 'corePersona': {
      const text = textOf(value).trim();
      return text || null;
    }
    default: {
      const text = textOf(value).trim();
      return text || null;
    }
  }
}

/** 保存前的可读快照（审计用；对象与数组序列化成 JSON 文本，避免审计脱敏误伤条目内文字）。 */
function snapshotField(field: LegacyAdminField, raw: Record<string, unknown>): unknown {
  const key = LEGACY_FIELD_KEYS[field];
  const value = raw[key];
  if (value === undefined) return null;
  if (field === 'aliases' || field === 'openingMessages') {
    const card = parseLegacyCard(raw);
    const list = field === 'aliases' ? (card?.aliases ?? []) : (card?.openingMessages ?? []);
    return list.length ? JSON.stringify(list) : null;
  }
  if (field === 'momentProfile' || field === 'groupChat') {
    const parsed = decodeJsonText(value);
    return parsed === null ? null : JSON.stringify(parsed);
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** 世界书 / 示例条目写入结果。 */
export interface LegacyEntryWrite {
  id: string;
  payload: Record<string, unknown>;
  sortOrder?: number;
}

/* ---------------- 世界书 ---------------- */

const LOREBOOK_TEXT_LIMIT = 20_000;

function checkKeys(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean' || value === 0 || value === 1;
}

/** 合并后的世界书条目必须像运行时能用的条目：有内容、类型正确。 */
function validateLorebookPayload(payload: Record<string, unknown>): string | null {
  const content = payload.content;
  if (typeof content !== 'string' || !content.trim()) return '世界书条目必须有内容';
  if (content.length > LOREBOOK_TEXT_LIMIT)
    return `世界书条目内容不能超过 ${LOREBOOK_TEXT_LIMIT} 字`;
  const title = payload.title;
  if (title !== undefined && (typeof title !== 'string' || title.length > 200))
    return '世界书标题必须是不超过 200 字的文本';
  for (const key of ['trigger_keys_json', 'trigger_keys', 'keys_json', 'keys']) {
    if (!checkKeys(payload[key])) return '世界书触发词必须是非空文本或文本数组';
  }
  if (payload.priority !== undefined) {
    const priority = payload.priority;
    if (typeof priority !== 'number' || !Number.isFinite(priority)) return '世界书优先级必须是数字';
  }
  for (const key of ['constant', 'is_constant', 'always', 'enabled']) {
    if (!checkOptionalBoolean(payload[key])) return '世界书开关必须是布尔值';
  }
  return null;
}

export function prepareLorebook(
  existing: readonly AdminLegacyLorebookEntry[],
  patch: AdminLegacyCharacterPatch['lorebook'],
  idFactory: () => string,
): LegacyPrepare<{
  create: LegacyEntryWrite[];
  update: LegacyEntryWrite[];
  remove: string[];
}> {
  const byId = new Map<string, Record<string, unknown>>(
    existing.map((entry) => [entry.id, entry.payload] as const),
  );
  const create: LegacyEntryWrite[] = [];
  const update: LegacyEntryWrite[] = [];
  const remove: string[] = [];
  for (const item of patch?.upsert ?? []) {
    const current = item.id ? byId.get(item.id) : undefined;
    if (item.id && current === undefined)
      return invalid(`世界书条目不属于该角色或不存在：${item.id}`);
    const id = item.id ?? idFactory();
    const payload: Record<string, unknown> = { ...(current ?? {}), ...item.payload, id };
    const problem = validateLorebookPayload(payload);
    if (problem) return invalid(problem);
    if (current === undefined) create.push({ id, payload });
    else update.push({ id, payload });
  }
  for (const id of patch?.delete ?? []) {
    if (!byId.has(id)) return invalid(`世界书条目不属于该角色或不存在：${id}`);
    remove.push(id);
  }
  return { ok: true, value: { create, update, remove } };
}

/* ---------------- 示例对话 ---------------- */

const EXAMPLE_TEXT_LIMIT = 4_000;

function validateExamplePayload(payload: Record<string, unknown>): string | null {
  const userText = payload.user_text;
  const assistantText = payload.assistant_text;
  for (const text of [userText, assistantText]) {
    if (text !== undefined && typeof text !== 'string') return '示例对话必须是文本';
    if (typeof text === 'string' && text.length > EXAMPLE_TEXT_LIMIT)
      return `示例对话单条不能超过 ${EXAMPLE_TEXT_LIMIT} 字`;
  }
  const hasUser = typeof userText === 'string' && userText.trim().length > 0;
  const hasAssistant = typeof assistantText === 'string' && assistantText.trim().length > 0;
  if (!hasUser && !hasAssistant) return '示例对话至少要有对方或角色的一句话';
  const scene = payload.scene;
  if (scene !== undefined && (typeof scene !== 'string' || scene.length > 200))
    return '示例场景必须是不超过 200 字的文本';
  const sortOrder = payload.sort_order;
  if (sortOrder !== undefined && (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)))
    return '示例排序必须是整数';
  return null;
}

export function prepareExamples(
  existing: readonly AdminLegacyDialogueExample[],
  patch: AdminLegacyCharacterPatch['examples'],
  idFactory: () => string,
): LegacyPrepare<{
  create: LegacyEntryWrite[];
  update: LegacyEntryWrite[];
  remove: string[];
}> {
  const byId = new Map<string, AdminLegacyDialogueExample>(
    existing.map((entry) => [entry.id, entry] as const),
  );
  let nextSort = existing.reduce((max, entry) => Math.max(max, entry.sortOrder + 1), 0);
  const create: LegacyEntryWrite[] = [];
  const update: LegacyEntryWrite[] = [];
  const remove: string[] = [];
  for (const item of patch?.upsert ?? []) {
    const current = item.id ? byId.get(item.id) : undefined;
    if (item.id && current === undefined)
      return invalid(`示例对话不属于该角色或不存在：${item.id}`);
    const id = item.id ?? idFactory();
    const payload: Record<string, unknown> = { ...(current?.payload ?? {}), ...item.payload, id };
    const sortOrder =
      item.sortOrder ??
      (typeof payload.sort_order === 'number'
        ? payload.sort_order
        : (current?.sortOrder ?? nextSort));
    if (!current) nextSort = Math.max(nextSort, sortOrder + 1);
    payload.sort_order = sortOrder;
    const problem = validateExamplePayload(payload);
    if (problem) return invalid(problem);
    const write = { id, payload, sortOrder };
    if (current === undefined) create.push(write);
    else update.push(write);
  }
  for (const id of patch?.delete ?? []) {
    if (!byId.has(id)) return invalid(`示例对话不属于该角色或不存在：${id}`);
    remove.push(id);
  }
  return { ok: true, value: { create, update, remove } };
}

/* ---------------- 整卡更新计划 ---------------- */

export interface LegacyCardUpdatePlan {
  /** 合并后的 legacy_card（未识别字段原样保留）。 */
  next: Record<string, unknown>;
  name: string;
  searchText: string;
  revision: number;
  /** 本次实际改动的逻辑名（含 lorebook / examples / avatar）。 */
  changedFields: string[];
  /** 保存前内容（审计与修改记录用；对象 / 数组为 JSON 文本）。 */
  before: Record<string, unknown>;
  hasFallbackGreeting: boolean;
  /** undefined = 不动头像；null = 恢复默认头像。 */
  avatarMediaId: string | null | undefined;
  lorebook: { create: LegacyEntryWrite[]; update: LegacyEntryWrite[]; remove: string[] };
  examples: { create: LegacyEntryWrite[]; update: LegacyEntryWrite[]; remove: string[] };
  /** 没有任何实际改动：不写库、不升 revision、不写审计。 */
  noop: boolean;
}

/** 计算一次旧卡保存的结果；不改数据库。 */
export function planLegacyAdminUpdate(input: {
  raw: Record<string, unknown>;
  currentRevision: number;
  expectedRevision: number;
  patch: AdminLegacyCharacterPatch;
  lorebook: readonly AdminLegacyLorebookEntry[];
  examples: readonly AdminLegacyDialogueExample[];
  avatarMediaId: string | null;
  idFactory: () => string;
}): LegacyPrepare<LegacyCardUpdatePlan> {
  const { patch, currentRevision, expectedRevision, raw } = input;
  if (currentRevision !== expectedRevision)
    return {
      ok: false,
      kind: 'conflict',
      message: `角色已被其他人修改（当前版本 ${currentRevision}），请刷新后重试`,
      currentRevision,
    };

  const next: Record<string, unknown> = structuredClone(raw);
  const before: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const clearSet = new Set<AdminLegacyClearableField>(patch.clear ?? []);
  const values = patch.fields ?? {};
  for (const field of Object.keys(values) as LegacyAdminField[]) {
    if (values[field] === undefined) continue;
    let encoded: string | null;
    try {
      encoded = encodeField(field, values[field]);
    } catch {
      return invalid(`${field} 不是合法的 JSON`);
    }
    if ((field === 'displayName' || field === 'corePersona') && encoded === null)
      return invalid(field === 'displayName' ? '角色名字不能为空' : '核心人设不能清空');
    const key = LEGACY_FIELD_KEYS[field];
    const previous = raw[key] === undefined ? null : raw[key];
    if (encoded === null) {
      if (previous === null) continue;
      before[field] = snapshotField(field, raw);
      delete next[key];
      changedFields.push(field);
    } else if (previous !== encoded) {
      before[field] = snapshotField(field, raw);
      next[key] = encoded;
      changedFields.push(field);
    }
  }
  for (const field of clearSet) {
    if (values[field] !== undefined) continue; // 契约已拦，这里兜底
    const key = LEGACY_FIELD_KEYS[field];
    if (next[key] === undefined) continue;
    before[field] = snapshotField(field, raw);
    delete next[key];
    changedFields.push(field);
  }

  const lorebookPlan = prepareLorebook(input.lorebook, patch.lorebook, input.idFactory);
  if (!lorebookPlan.ok) return lorebookPlan;
  const examplePlan = prepareExamples(input.examples, patch.examples, input.idFactory);
  if (!examplePlan.ok) return examplePlan;

  const lorebookAffected = [
    ...lorebookPlan.value.update,
    ...lorebookPlan.value.remove.map((id) => ({ id })),
  ];
  if (lorebookAffected.length) {
    const payloads = new Map<string, Record<string, unknown>>(
      input.lorebook.map((entry) => [entry.id, entry.payload] as const),
    );
    before.lorebook = JSON.stringify(
      lorebookAffected
        .map((item) => ({ id: item.id, payload: payloads.get(item.id) ?? null }))
        .filter((item) => item.payload !== null),
    );
    changedFields.push('lorebook');
  }

  const exampleAffected = [
    ...examplePlan.value.update,
    ...examplePlan.value.remove.map((id) => ({ id })),
  ];
  if (exampleAffected.length) {
    const payloads = new Map<string, Record<string, unknown>>(
      input.examples.map((entry) => [entry.id, entry.payload] as const),
    );
    before.examples = JSON.stringify(
      exampleAffected
        .map((item) => ({ id: item.id, payload: payloads.get(item.id) ?? null }))
        .filter((item) => item.payload !== null),
    );
    changedFields.push('examples');
  }

  const avatarMediaId = patch.avatarMediaId;
  const avatarChanged = avatarMediaId !== undefined && avatarMediaId !== input.avatarMediaId;
  if (avatarChanged) {
    before.avatar = input.avatarMediaId;
    changedFields.push('avatar');
  }

  const noop = changedFields.length === 0;
  return {
    ok: true,
    value: {
      next,
      name: legacyDisplayName(next),
      searchText: legacySearchText(next),
      revision: currentRevision + 1,
      changedFields,
      before,
      hasFallbackGreeting: (parseLegacyCard(next)?.openingMessages.length ?? 0) > 0,
      avatarMediaId,
      lorebook: lorebookPlan.value,
      examples: examplePlan.value,
      noop,
    },
  };
}

/** 详情里「未识别字段」的展示顺序：先字母序，raw_json 这类长文本排在后面。 */
export function preservedEntries(
  preserved: Record<string, unknown>,
): Array<{ key: string; value: unknown }> {
  return Object.entries(preserved)
    .sort(([a], [b]) => {
      if (a === 'raw_json') return 1;
      if (b === 'raw_json') return -1;
      return a.localeCompare(b);
    })
    .map(([key, value]) => ({ key, value }));
}
