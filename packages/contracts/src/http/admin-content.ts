/**
 * 管理后台内容维护接口（T-049）：情景模式维护（ADM-05 第 8 条、MODE-04）与人设版本发布回滚（ADM-06）。
 *
 * 变更说明：任务卡要求本任务**不改** `http/characters.ts`（T-047 同时修改该文件，避免冲突），
 * 因此新增的管理接口集中在本文件。契约变更申请见
 * `docs/handoffs/2026-10-09-backend-lead-T-049.md`。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';
import { AdminCharacter } from './characters.js';

// ---------- 情景模式（ADM-05 第 8 条、MODE-04） ----------

/**
 * 模式的适用范围。管理员新增模式时设定；标记为「含恋爱内容」的模式自动排除儿童角色、
 * 「含成人内容」只对成人模式资格为「是」的角色开放（MODE-01 第 3 条）。
 */
export const ScenarioModeAppliesTo = z.enum(['all', 'non_minor', 'adult_eligible']);
export type ScenarioModeAppliesTo = z.infer<typeof ScenarioModeAppliesTo>;

/** 管理模式条目（ADM-05 第 8 条）。内置模式 isBuiltin = true，不能删除。 */
export const AdminScenarioMode = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(32),
  description: z.string().max(200),
  /** 预设提示词（系统提示词片段）；修改后需重新通过人设稳定检查（MODE-04）。 */
  presetPrompt: z.string().max(4000).nullable(),
  appliesTo: ScenarioModeAppliesTo,
  hasRomanceContent: z.boolean(),
  hasAdultContent: z.boolean(),
  isBuiltin: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  updatedAt: Timestamp,
});
export type AdminScenarioMode = z.infer<typeof AdminScenarioMode>;

/** 新建情景模式：id 为小写英文标识（内置模式 id 除外，见服务端规则）。 */
export const AdminScenarioModeCreate = z.object({
  id: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, 'id 只能用小写字母、数字和下划线，且以字母开头'),
  name: z.string().min(1).max(32),
  description: z.string().max(200).default(''),
  presetPrompt: z.string().max(4000).nullable().default(null),
  appliesTo: ScenarioModeAppliesTo.default('all'),
  hasRomanceContent: z.boolean().default(false),
  hasAdultContent: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});
export type AdminScenarioModeCreate = z.infer<typeof AdminScenarioModeCreate>;

/** 修改情景模式：只传要改的字段；内置模式的 id / 适用范围 / 内容标记不可修改（服务端忽略）。 */
export const AdminScenarioModeUpdate = AdminScenarioModeCreate.omit({ id: true }).partial();
export type AdminScenarioModeUpdate = z.infer<typeof AdminScenarioModeUpdate>;

const scenarioModeParams = z.object({ id: z.string().min(1).max(32) });

export const ScenarioModeAdminEndpoints = {
  listScenarioModes: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/scenario-modes`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminScenarioMode) }),
    summary: '情景模式列表（ADM-05 第 8 条）',
  }),
  createScenarioMode: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/scenario-modes`,
    auth: 'admin',
    body: AdminScenarioModeCreate,
    response: AdminScenarioMode,
    summary: '新增情景模式；id 与内置模式重复 409 conflict',
  }),
  updateScenarioMode: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/scenario-modes/:id`,
    auth: 'admin',
    params: scenarioModeParams,
    body: AdminScenarioModeUpdate,
    response: AdminScenarioMode,
    summary: '修改情景模式；内置模式的适用范围与内容标记不可改',
  }),
  deleteScenarioMode: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/scenario-modes/:id`,
    auth: 'admin',
    params: scenarioModeParams,
    response: NoContent,
    summary: '删除情景模式；内置模式不可删除（422）',
  }),
} as const;

// ---------- 人设版本发布回滚（ADM-06） ----------

/** 人设历史版本（ADM-06 第 1 条：版本号、修改人、修改摘要、人设稳定检查结果）。 */
export const PersonaVersionSummary = z.object({
  version: z.number().int().positive(),
  summary: z.string().max(500).nullable(),
  modifiedBy: Id.nullable(),
  stabilityPassed: z.boolean(),
  publishedAt: Timestamp,
  /** 是否是该角色当前生效的已发布版本。 */
  isCurrent: z.boolean(),
});
export type PersonaVersionSummary = z.infer<typeof PersonaVersionSummary>;

export const PersonaVersionAdminEndpoints = {
  listPersonaVersions: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/characters/:characterId/persona-versions`,
    auth: 'admin',
    params: z.object({ characterId: Id }),
    response: z.object({ items: z.array(PersonaVersionSummary) }),
    summary: '人设历史版本列表（按版本号从新到旧）',
  }),
  rollbackPersonaVersion: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/characters/:characterId/persona-versions/:version/rollback`,
    auth: 'admin',
    params: z.object({ characterId: Id, version: z.coerce.number().int().positive() }),
    response: AdminCharacter,
    summary:
      '回滚到指定人设版本：把该版本内容作为新的草稿并发布，生成一条新版本记录（ADM-06 第 3 条）。版本不存在 404；角色从未上架 422',
  }),
} as const;
