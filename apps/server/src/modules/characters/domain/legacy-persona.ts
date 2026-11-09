/** Structured legacy personalization. Pure functions; never reads a legacy database or credentials. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  LegacyPersonaBlockedReason,
  LegacyPersonaSection,
  LegacyRuntimeContext,
} from '@weiban/contracts';
import { CharacterClassificationInput } from '@weiban/contracts';
import { childFeaturesIn } from './child-features.js';

export type JsonObject = Record<string, unknown>;
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const MIRRORS = [
  'soulspec',
  'celebrity_profile',
  'chat_persona_engine',
  'memory_rules',
  'character',
];
const LEGACY = [
  'core_persona',
  'speaking_style',
  'relationship_mode',
  'knowledge',
  'opening_messages',
  'soft_identity_replies',
  'forbidden_claims',
  'group_chat',
];
const RAW = new Set([...MIRRORS, 'lorebook', 'examples', 'example_dialogues']);
const HEX = z.string().regex(/^[a-f0-9]{64}$/);
export const LegacyPersonaImport = z.strictObject({
  format: z.literal('weiban-legacy-persona-v1'),
  sourceAccountId: z.uuid(),
  characterId: z.uuid(),
  expectedTargetDigest: HEX,
  cutoff: z.iso.datetime(),
  source: z.strictObject({
    personaName: z.string().min(1).max(200),
    version: z.number().int().min(0).max(2_147_483_646),
    state: z.enum(['customized', 'reset']),
    baseSignature: z.string().max(200),
    baseRevision: z.string().max(200),
    patchJson: z.string().max(524_288),
    updatedAt: z.iso.datetime(),
  }),
  base: z
    .strictObject({
      personaName: z.string().min(1).max(200),
      signature: z.string().max(200),
      revision: z.string().max(200),
      packageJson: z.string().max(2_097_152),
      packageSha256: HEX,
    })
    .nullable(),
  evidence: z.strictObject({
    sourceVerified: z.boolean(),
    baseVersionVerified: z.boolean(),
    identityMappingVerified: z.boolean(),
    targetLifecycleReviewed: z.boolean(),
    classificationReviewed: z.boolean(),
  }),
  reviewedClassification: CharacterClassificationInput.nullable(),
});
export type LegacyPersonaImport = z.infer<typeof LegacyPersonaImport>;
export const isObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
const own = (value: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export function personaDigest(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    item instanceof Date
      ? item.toISOString()
      : Buffer.isBuffer(item)
        ? { hash: createHash('sha256').update(item).digest('hex') }
        : Array.isArray(item)
          ? item.map(canonical)
          : isObject(item)
            ? Object.fromEntries(
                Object.keys(item)
                  .sort()
                  .map((key) => [key, canonical(item[key])]),
              )
            : item;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export const bytesDigest = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
export function personaChildFeatures(value: unknown): boolean {
  const numeric = (child: unknown): boolean =>
    (typeof child === 'number' ||
      (typeof child === 'string' && /^\d+(?:\.\d+)?$/.test(child.trim()))) &&
    Number.isFinite(Number(child)) &&
    Number(child) >= 0 &&
    Number(child) < 18;
  const text = JSON.stringify(value);
  const root = obj(value),
    raw = obj(root.raw_persona),
    character = obj(raw.character),
    identity = obj(obj(raw.soulspec).identity);
  return (
    childFeaturesIn(text) ||
    /\b(?:[0-9]|1[0-7])[ -]*(?:years?[ -]*old|y\/?o)\b/iu.test(text) ||
    [root.age, root.年龄, character.age, character.年龄, identity.age, identity.年龄].some(numeric)
  );
}
export function assertSafePersonaJson(value: unknown): void {
  let nodes = 0;
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 20_000 || depth > 32) throw new Error('LEGACY_PERSONA_STRUCTURE_LIMIT');
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (isObject(item))
      for (const [key, child] of Object.entries(item)) {
        if (
          UNSAFE.has(key) ||
          /(?:password|passwd|secret|access.?token|api.?key|authorization|credential)/iu.test(key)
        )
          throw new Error('LEGACY_PERSONA_UNSAFE_FIELD');
        visit(child, depth + 1);
      }
  };
  visit(value, 0);
}
/** Original RFC7396 semantics: arrays atomic; null deletes; empty text is explicit. */
export function applyPersonaMergePatch(base: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return clone(patch);
  const output: JsonObject = isObject(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE.has(key)) continue;
    if (value === null) delete output[key];
    else output[key] = applyPersonaMergePatch(output[key], value);
  }
  return output;
}
export function editablePersonaDocument(card: JsonObject): {
  raw_persona: JsonObject;
  legacy_fields: JsonObject;
} {
  const raw = isObject(card.raw_persona) ? clone(card.raw_persona) : {};
  for (const field of MIRRORS)
    if (!own(raw, field) && isObject(card[field])) raw[field] = clone(card[field]);
  if (!own(raw, 'lorebook') && Array.isArray(card.lorebook)) raw.lorebook = clone(card.lorebook);
  if (!own(raw, 'examples') && Array.isArray(card.example_dialogues))
    raw.examples = clone(card.example_dialogues);
  const legacy: JsonObject = {};
  for (const field of LEGACY) if (own(card, field)) legacy[field] = clone(card[field]);
  return { raw_persona: raw, legacy_fields: legacy };
}
export function materializePersonaCard(base: JsonObject, patch: JsonObject): JsonObject {
  const doc = applyPersonaMergePatch(editablePersonaDocument(base), patch) as JsonObject;
  const card = clone(base),
    raw = isObject(doc.raw_persona) ? doc.raw_persona : {};
  card.raw_persona = raw;
  for (const field of MIRRORS) {
    if (own(raw, field)) card[field] = clone(raw[field]);
    else delete card[field];
  }
  for (const [rawKey, key] of [
    ['lorebook', 'lorebook'],
    ['examples', 'example_dialogues'],
  ] as const) {
    if (own(raw, rawKey)) card[key] = Array.isArray(raw[rawKey]) ? clone(raw[rawKey]) : [];
    else delete card[key];
  }
  const legacy = isObject(doc.legacy_fields) ? doc.legacy_fields : {};
  for (const field of LEGACY) {
    if (own(legacy, field)) card[field] = clone(legacy[field]);
    else delete card[field];
  }
  card._source = 'server_base_with_user_patch';
  return card;
}
function json(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    throw new Error('LEGACY_PERSONA_TARGET_JSON_INVALID');
  }
}
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
const obj = (value: unknown): JsonObject => (isObject(value) ? value : {});
/** Exact editable portion of old character_store.rowToCard; runtime/service/voice credentials are excluded. */
export function targetPersonaPackage(
  row: JsonObject,
  lorebook: unknown[],
  examples: unknown[],
): JsonObject {
  const raw = obj(json(row.raw_json, {}));
  return {
    id: row.id,
    display_name: row.display_name,
    canonical_name: row.canonical_name,
    schema_kind: row.schema_kind ?? '',
    raw_persona: raw,
    core_persona: row.core_persona ?? '',
    speaking_style: row.speaking_style ?? '',
    relationship_mode: row.relationship_mode ?? '',
    knowledge: json(row.knowledge_json, []),
    opening_messages: json(row.opening_messages_json, []),
    soft_identity_replies: json(row.soft_identity_replies_json, []),
    forbidden_claims: json(row.forbidden_claims_json, []),
    group_chat: json(row.group_chat_json, {}),
    celebrity_profile: raw.celebrity_profile ?? {},
    chat_persona_engine: raw.chat_persona_engine ?? {},
    memory_rules: raw.memory_rules ?? {},
    lorebook: lorebook.map((value) => {
      const entry = obj(value);
      return {
        keys: json(entry.trigger_keys_json, []),
        content: entry.content,
        priority: entry.priority,
        enabled: entry.enabled === 1 || entry.enabled === true,
      };
    }),
    example_dialogues: examples.map((value) => {
      const entry = obj(value);
      return { user: entry.user_text, assistant: entry.assistant_text, scene: entry.scene };
    }),
    soulspec: {
      identity: {
        type: row.identity_type ?? '',
        description: row.identity_description ?? '',
        disclaimer: row.identity_disclaimer ?? '',
      },
      boundary: {
        must_not_claim_real_person: row.boundary_must_not_claim !== 0,
        rules: json(row.boundary_rules_json, []),
      },
      soul: {
        personality: row.soul_personality ?? '',
        relationship_mode: row.soul_relationship_mode ?? '',
        emotional_tone: row.soul_emotional_tone ?? '',
      },
      style: {
        chat_style: row.style_chat_style ?? '',
        emoji_level: row.style_emoji_level ?? '',
        avoid: json(row.style_avoid_json, []),
      },
      memory_rules: {
        remember: json(row.memory_remember_json, []),
        avoid: json(row.memory_avoid_json, []),
      },
    },
  };
}
/** Same recursive value rendering as the old runtime adapter; never String(object). */
export function personaValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(personaValueText).filter(Boolean).join('；');
  if (isObject(value))
    return Object.entries(value)
      .map(([key, item]) => {
        const content = personaValueText(item);
        return content ? `${key}: ${content}` : '';
      })
      .filter(Boolean)
      .join('；');
  return text(value).trim();
}
function leaves(value: unknown, path: string[] = []): Array<{ path: string[]; value: unknown }> {
  if (isObject(value) && Object.keys(value).length)
    return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
  return [{ path, value }];
}
function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}
const PROTECTED =
  /^(?:basis|real_person_kind|is_real_person|identity_type|adult_mode_eligible|romance_allowed|allow_nsfw|voice|heartbeat|schema_kind|schema_name|display_name|canonical_name|name|age|birthday|age_setting|child_appearance|child_features_detected)$/u;
export function personaPatchReason(patch: unknown): LegacyPersonaBlockedReason | null {
  try {
    assertSafePersonaJson(patch);
  } catch {
    return 'unsupported_structure';
  }
  if (
    !isObject(patch) ||
    Object.keys(patch).some((key) => !['raw_persona', 'legacy_fields'].includes(key))
  )
    return 'unsupported_structure';
  for (const root of ['raw_persona', 'legacy_fields']) {
    if (own(patch, root) && patch[root] !== null && !isObject(patch[root]))
      return 'unsupported_structure';
    for (const field of Object.keys(obj(patch[root])))
      if (!(root === 'raw_persona' ? RAW.has(field) : LEGACY.includes(field)))
        return 'unsupported_structure';
  }
  const rawPatch = obj(patch.raw_persona),
    soulPatch = obj(rawPatch.soulspec);
  if (
    patch.raw_persona === null ||
    rawPatch.character === null ||
    rawPatch.soulspec === null ||
    soulPatch.identity === null
  )
    return 'restricted_identity_change';
  for (const field of MIRRORS)
    if (own(rawPatch, field) && rawPatch[field] !== null && !isObject(rawPatch[field]))
      return 'unsupported_structure';
  // Only main-character identity/control paths are protected. A relative's name/age inside
  // personality prose, lorebook metadata or example metadata is not an identity rewrite.
  const actor = obj(rawPatch.character),
    identity = obj(soulPatch.identity);
  if (
    Object.keys(actor).some((key) => PROTECTED.test(key)) ||
    Object.keys(identity).some((key) => key === 'type' || PROTECTED.test(key)) ||
    own(soulPatch, 'voice') ||
    own(soulPatch, 'heartbeat')
  )
    return 'restricted_identity_change';
  if (own(obj(soulPatch.boundary), 'must_not_claim_real_person'))
    return 'restricted_identity_change';
  if (Object.keys(actor).some((key) => !['short_intro', 'tags'].includes(key)))
    return 'unsupported_structure';
  for (const key of ['identity', 'soul', 'style', 'boundary'])
    if (own(soulPatch, key) && soulPatch[key] !== null && !isObject(soulPatch[key]))
      return 'unsupported_structure';
  for (const [key, allowed] of [
    ['identity', ['description', 'disclaimer']],
    ['soul', ['personality', 'relationship_mode', 'emotional_tone']],
    ['style', ['chat_style', 'emoji_level', 'avoid']],
    ['boundary', ['rules']],
  ] as const)
    if (
      Object.keys(obj(soulPatch[key])).some(
        (field) => !(allowed as readonly string[]).includes(field),
      )
    )
      return 'unsupported_structure';
  // Memory extraction rules, hardware/heartbeat/voice settings do not map to a persona prompt.
  if (
    own(obj(patch.raw_persona), 'memory_rules') ||
    own(obj(obj(patch.raw_persona).soulspec), 'memory_rules')
  )
    return 'unsupported_structure';
  const soulFields = new Set([
    'personality_core',
    'values',
    'emotional_baseline',
    'must_preserve',
    'must_avoid',
    'identity',
    'soul',
    'style',
    'personality',
    'relationship_mode',
    'emotional_tone',
    'speaking_style',
    'boundary',
  ]);
  if (Object.keys(obj(obj(patch.raw_persona).soulspec)).some((key) => !soulFields.has(key)))
    return 'unsupported_structure';
  return null;
}
function normalizedContext(card: JsonObject, sourceKey: string): LegacyRuntimeContext {
  const raw = obj(card.raw_persona);
  const lore = Array.isArray(raw.lorebook)
    ? raw.lorebook
    : Array.isArray(card.lorebook)
      ? card.lorebook
      : [];
  const examples = Array.isArray(raw.examples)
    ? raw.examples
    : Array.isArray(raw.example_dialogues)
      ? raw.example_dialogues
      : Array.isArray(card.example_dialogues)
        ? card.example_dialogues
        : [];
  return {
    lorebook: lore.flatMap((value, index) => {
      const entry = typeof value === 'string' ? { content: value } : obj(value);
      if (!isObject(value) && typeof value !== 'string')
        throw new Error('LEGACY_PERSONA_LOREBOOK_INVALID');
      const contentValue = entry.content || entry.text || entry.value;
      if (
        contentValue !== undefined &&
        typeof contentValue !== 'string' &&
        typeof contentValue !== 'number'
      )
        throw new Error('LEGACY_PERSONA_LOREBOOK_INVALID');
      const content = text(entry.content || entry.text || entry.value).trim();
      if (!content || entry.enabled === false) return [];
      const keys = Array.isArray(entry.keys || entry.trigger_keys)
        ? entry.keys || entry.trigger_keys
        : [entry.key, entry.keyword].filter(Boolean);
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))
        throw new Error('LEGACY_PERSONA_LOREBOOK_INVALID');
      return [
        {
          id: `${sourceKey}:lore:${index}`,
          title: text(entry.title),
          keys: keys as string[],
          secondaryKeys: [],
          constant: keys.length === 0,
          priority: Number(entry.priority) || 50,
          content,
        },
      ];
    }),
    examples: examples.flatMap((value, index) => {
      const entry = typeof value === 'string' ? { assistant: value } : obj(value);
      if (!isObject(value) && typeof value !== 'string')
        throw new Error('LEGACY_PERSONA_EXAMPLE_INVALID');
      for (const field of [
        'user',
        'user_text',
        'input',
        'assistant',
        'assistant_text',
        'reply',
        'output',
        'scene',
        'context',
      ])
        if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'string')
          throw new Error('LEGACY_PERSONA_EXAMPLE_INVALID');
      const userText = text(entry.user || entry.user_text || entry.input).trim(),
        assistantText = text(
          entry.assistant || entry.assistant_text || entry.reply || entry.output,
        ).trim();
      return userText || assistantText
        ? [
            {
              id: `${sourceKey}:example:${index}`,
              scene: text(entry.scene || entry.context),
              userText,
              assistantText,
              sortOrder: index,
            },
          ]
        : [];
    }),
  };
}
const TITLES = {
  core: '人设与性格',
  speech: '说话方式',
  relationship: '相处方式',
  group: '群聊设置',
  lorebook: '专属词条',
  examples: '对话示例',
} as const;
const LABELS: Record<string, string> = {
  core_persona: '核心人设',
  speaking_style: '说话风格',
  relationship_mode: '相处模式',
  personality_core: '人格核心',
  values: '价值观',
  emotional_baseline: '情绪基调',
  must_preserve: '保留特征',
  must_avoid: '避免事项',
  public_persona: '公众人设',
  private_feel: '私下感',
  stage_image: '舞台形象',
  fan_interaction_mode: '互动方式',
  interaction_distance: '互动距离',
  emotional_texture: '情绪质感',
  persona_tensions: '人设张力',
  fandom_terms: '交流称呼',
  controversy_boundaries: '争议边界',
  short_intro: '简介',
  tags: '特点',
  soul: '性格',
  style: '风格',
  chat_style: '聊天风格',
  emoji_level: '表情使用',
  avoid: '避免表达',
  personality: '性格',
  emotional_tone: '情绪基调',
  default_reply_mode: '通常回复',
  cold_reply_mode: '冷淡时',
  warm_reply_mode: '亲近时',
  teasing_mode: '调侃时',
  comfort_mode: '安慰时',
  jealousy_mode: '吃醋时',
  boundary_shift_mode: '边界变化',
  privacy_question_mode: '私人问题',
  gossip_question_mode: '八卦问题',
  schedule_question_mode: '日程问题',
  official_stance_mode: '公开立场',
  over_boundary_reply_mode: '越界问题',
  anti_generic_ai_rules: '表达习惯',
  sentence_rules: '句式',
  response_length_rules: '回复长短',
  opening_messages: '开场白',
  knowledge: '资料',
  soft_identity_replies: '身份回应',
  forbidden_claims: '避免声明',
  group_chat: '群聊',
  description: '描述',
  disclaimer: '身份提示',
  identity: '身份描述',
  boundary: '表达边界',
  rules: '规则',
  character: '角色',
  soulspec: '性格设定',
  celebrity_profile: '人物设定',
  chat_persona_engine: '回复方式',
};
function sectionFor(path: string[]): keyof typeof TITLES {
  if (path.includes('lorebook')) return 'lorebook';
  if (path.includes('examples') || path.includes('example_dialogues')) return 'examples';
  if (path.includes('group_chat')) return 'group';
  if (path.some((key) => /relationship|interaction/u.test(key))) return 'relationship';
  if (path.some((key) => /style|speaking|chat_persona_engine|reply|sentence/u.test(key)))
    return 'speech';
  return 'core';
}
export function projectPersonalPersona(
  targetRow: JsonObject,
  targetCard: JsonObject,
  patch: JsonObject,
  sourceKey: string,
) {
  const effective = materializePersonaCard(targetCard, patch),
    doc = editablePersonaDocument(effective);
  const projected = clone(targetRow),
    sections = new Map<keyof typeof TITLES, LegacyPersonaSection>();
  const context = normalizedContext(effective, sourceKey);
  const rawNotes: string[] = [];
  const projectionPaths = [
    ['soulspec.personality_core', 'soul_personality'],
    ['soulspec.personality', 'soul_personality'],
    ['soulspec.soul.personality', 'soul_personality'],
    ['soulspec.emotional_baseline', 'soul_emotional_tone'],
    ['soulspec.emotional_tone', 'soul_emotional_tone'],
    ['soulspec.soul.emotional_tone', 'soul_emotional_tone'],
    ['soulspec.relationship_mode', 'soul_relationship_mode'],
    ['soulspec.soul.relationship_mode', 'soul_relationship_mode'],
    ['soulspec.speaking_style', 'style_chat_style'],
    ['soulspec.style.chat_style', 'style_chat_style'],
    ['soulspec.style.emoji_level', 'style_emoji_level'],
    ['soulspec.style.avoid', 'style_avoid_json'],
  ] as const;
  const affects = (path: string[]) => {
    let item: unknown = patch;
    for (const key of path) {
      if (item === null) return true;
      if (!isObject(item) || !own(item, key)) return false;
      item = item[key];
    }
    return true;
  };
  const appliedPaths: string[][] = [];
  for (const [sourcePath, field] of projectionPaths) {
    const path = ['raw_persona', ...sourcePath.split('.')];
    if (!affects(path)) continue;
    const value = readPath(doc, path);
    projected[field] = field.endsWith('_json') ? clone(value ?? []) : personaValueText(value);
    appliedPaths.push(path);
  }
  const legacyKeys: Record<string, string> = {
    core_persona: 'core_persona',
    speaking_style: 'speaking_style',
    relationship_mode: 'relationship_mode',
    knowledge: 'knowledge_json',
    opening_messages: 'opening_messages_json',
    soft_identity_replies: 'soft_identity_replies_json',
    forbidden_claims: 'forbidden_claims_json',
    group_chat: 'group_chat_json',
  };
  for (const field of Object.keys(obj(patch.legacy_fields))) {
    const value = obj(doc.legacy_fields)[field];
    projected[legacyKeys[field]!] =
      value === undefined
        ? field.endsWith('persona') || field.endsWith('style') || field.endsWith('mode')
          ? ''
          : []
        : clone(value);
  }
  for (const leaf of leaves(patch)) {
    if (leaf.path.length < 2) throw new Error('LEGACY_PERSONA_ROOT_REPLACEMENT_UNSUPPORTED');
    const key = sectionFor(leaf.path),
      value = readPath(doc, leaf.path);
    const label = leaf.path
      .slice(1)
      .map((field) => LABELS[field] ?? field)
      .join(' · ');
    const rendered =
      leaf.value === null
        ? '已清除'
        : Array.isArray(value) && value.length === 0
          ? '已清空'
          : personaValueText(value) || '（留空）';
    const section = sections.get(key) ?? { key, title: TITLES[key], fields: [] };
    if (key === 'lorebook' && Array.isArray(value) && value.length) {
      section.fields.push(
        ...context.lorebook.map((item) => ({
          label: item.keys.length ? `触发词：${item.keys.join('、')}` : '常用词条',
          value: item.content,
        })),
      );
    } else if (key === 'examples' && Array.isArray(value) && value.length) {
      section.fields.push(
        ...context.examples.map((item, index) => ({
          label: item.scene || `示例 ${index + 1}`,
          value: `${item.userText ? `对方：${item.userText}\n` : ''}角色：${item.assistantText}`,
        })),
      );
    } else section.fields.push({ label, value: rendered });
    if (
      section.fields.length > 2000 ||
      section.fields.some((item) => item.label.length > 300 || item.value.length > 524_288)
    )
      throw new Error('LEGACY_PERSONA_VIEW_LIMIT');
    sections.set(key, section);
    const mapped = appliedPaths.some((path) =>
      path
        .slice(0, Math.min(path.length, leaf.path.length))
        .every((part, index) => leaf.path[index] === part),
    );
    if (leaf.path[0] === 'raw_persona' && !['lorebook', 'examples'].includes(key) && !mapped)
      rawNotes.push(`${label}：${rendered}`);
  }
  // Only the user-selected paths are projected. Unmodified public columns (including MUSE revisions)
  // remain the current public values. This is a typed personal override, never the public supplement.
  projected._legacy_personal_notes = rawNotes.length
    ? `【本人的专属定制：以下字段覆盖默认同名设定，平台边界不变】\n${rawNotes.join('\n')}`
    : '';
  projected.raw_json = clone(doc.raw_persona);
  return {
    legacyCard: projected,
    context,
    sections: [...sections.values()],
    effectiveDocument: doc,
  };
}
