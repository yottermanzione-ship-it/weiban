/** 7.11: owner-scoped compatibility for structured legacy persona customizations. */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

export const LegacyPersonaBlockedReason = z.enum([
  'source_unverified',
  'base_missing',
  'base_mismatch',
  'identity_mapping_unverified',
  'target_personal_changes',
  'unsupported_structure',
  'classification_unverified',
  'restricted_identity_change',
  'character_unavailable',
]);
export type LegacyPersonaBlockedReason = z.infer<typeof LegacyPersonaBlockedReason>;
export const LegacyPersonaSummary = z.object({
  characterId: Id,
  characterName: z.string().max(200),
  state: z.enum(['active', 'blocked', 'reset']),
  version: z.number().int().safe().nonnegative(),
  sourceVersion: z.number().int().safe().nonnegative().nullable(),
  sourceUpdatedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
  blockedReason: LegacyPersonaBlockedReason.nullable(),
});
export type LegacyPersonaSummary = z.infer<typeof LegacyPersonaSummary>;
export const LegacyPersonaSection = z.object({
  key: z.enum(['core', 'speech', 'relationship', 'group', 'lorebook', 'examples']),
  title: z.string().max(100),
  fields: z
    .array(z.object({ label: z.string().max(300), value: z.string().max(524_288) }))
    .max(2000),
});
export type LegacyPersonaSection = z.infer<typeof LegacyPersonaSection>;
export const LegacyPersonaDetail = LegacyPersonaSummary.extend({
  sections: z.array(LegacyPersonaSection).max(6),
  resetAllowed: z.boolean(),
  originalRetained: z.boolean(),
});
export type LegacyPersonaDetail = z.infer<typeof LegacyPersonaDetail>;
export const LegacyPersonaReset = z
  .object({
    clientCommandId: Id,
    expectedVersion: z.number().int().safe().nonnegative(),
  })
  .strict();
export type LegacyPersonaReset = z.infer<typeof LegacyPersonaReset>;
const params = z.object({ characterId: Id });
export const LegacyPersonaEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/legacy-personas`,
    auth: 'user',
    response: z.object({ items: z.array(LegacyPersonaSummary).max(2000) }),
    summary: '本人旧专属人设状态；不含公共角色卡变更或其他用户内容',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/legacy-persona`,
    auth: 'user',
    params,
    response: z.object({ item: LegacyPersonaDetail.nullable() }),
    summary: '本人旧定制的可读分区；blocked内容尚未生效，reset不保留原件',
  }),
  reset: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/:characterId/legacy-persona/reset`,
    auth: 'user',
    params,
    body: LegacyPersonaReset,
    response: z.object({ item: LegacyPersonaDetail, replayed: z.boolean() }),
    summary:
      '恢复当前公共人设并删除本人的旧结构原文；保留防复活摘要；版本/命令冲突返回409 conflict',
  }),
} as const;
