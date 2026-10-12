# 交接说明：T-049 管理后台用量/对账/情景模式/人设版本

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人 |
| 日期 | 2026-10-09 |

## 做了什么

T-049-l2-admin-usage：为管理后台实现了用量查询、对账、情景模式管理和人设版本回滚的全套后端接口，以及对应的管理前端页面。

具体内容：

1. 数据库迁移 0017：新增 `characters.scenario_modes` 表（含 4 条内置模式 daily/tsundere/romance/adult），同时给 `persona_versions` 表追加 `summary`、`modified_by`、`stability_passed` 三列。

2. 情景模式后端（ADM-05 第 8 条，MODE-04）：ScenarioModeService（list/create/update/delete，内置模式不可删除，builtin 模式的 appliesTo/内容标记不可修改）和 ScenarioModeAdminController，路由 `/api/v1/admin/scenario-modes`。

3. 人设版本后端（ADM-06）：CharacterService 新增 `listPersonaVersions` 和 `rollbackPersonaVersion`；新增 PersonaVersionAdminController，路由 `/api/v1/admin/characters/:characterId/persona-versions`。回滚语义：把目标版本的密文作为新草稿和新发布版本，版本号自增，生成一条新 persona_versions 记录（summary 写明"回滚到版本 N"），发送 `persona_version_published` 事件，写审计日志。

4. 新增契约文件 `packages/contracts/src/http/admin-content.ts`（v2.4）：ScenarioModeAdminEndpoints、PersonaVersionAdminEndpoints 及相关类型，不改 characters.ts（T-047 防冲突）。

5. 管理前端（apps/admin）：新增三个页面——UsagePage（ADM-08 用量/费用，含汇总/明细/CSV 导出）、BillingPage（平台汇总/对账/上游账单录入）、ScenarioModesPage（情景模式管理，含内置保护提示）；注册路由 /usage、/billing、/scenario-modes。

6. ADM-08 口径核对集成测试（model-gateway.test.ts）：验证用量页 chargedMicros == billing.ledger_entries 扣费合计。

## 改了哪些文件

**数据库迁移**
- `apps/server/drizzle/0017_admin_usage_scenario_modes.sql`（新增）
- `apps/server/drizzle/0017_admin_usage_scenario_modes.down.sql`（新增）
- `apps/server/drizzle/meta/_journal.json`（追加 idx 17）

**后端 schema & 服务**
- `apps/server/src/modules/characters/infra/db/schema.ts`（新增 scenarioModes 表，personaVersions 追加三列）
- `apps/server/src/modules/characters/application/scenario-modes.ts`（新增）
- `apps/server/src/modules/characters/application/characters.ts`（publish 记录 modifiedBy/stabilityPassed；新增 listPersonaVersions、rollbackPersonaVersion）
- `apps/server/src/modules/characters/http/scenario-modes.controller.ts`（新增）
- `apps/server/src/modules/characters/http/persona-versions.controller.ts`（新增）
- `apps/server/src/modules/characters/characters.module.ts`（注册两个新 controller）
- `apps/server/src/modules/model-access/testing.ts`（导出 AdminUsageService）

**契约**
- `packages/contracts/src/http/admin-content.ts`（新增）
- `packages/contracts/src/index.ts`（追加 admin-content 导出）
- `packages/contracts/src/version.ts`（2.3 → 2.4）
- `packages/contracts/README.md`（目录表追加 admin-content.ts 一行）

**管理前端**
- `apps/admin/src/features/usage.tsx`（新增）
- `apps/admin/src/features/billing.tsx`（新增）
- `apps/admin/src/features/scenario-modes.tsx`（新增）
- `apps/admin/src/app/app.tsx`（注册三个路由和导航链接）

**测试**
- `apps/server/test/model-gateway.test.ts`（追加 ADM-08 口径核对测试）

## 遗留问题

1. scenario-modes.tsx 前端页面目前使用 raw fetch（页面早于契约文件而写），可以改用 ScenarioModeAdminEndpoints via api client。属于清理工作，不影响功能，可在后续任务顺带处理。

2. 人设版本回滚目前不重置 characters.checks（checks.checked = false / personaStabilityPassed = false），因为回滚内容来自已通过检查的历史版本，当前实现认为可以直接发布。若产品要求回滚后必须重新检查，需要产品负责人给出明确规则。

3. AdminUsageService 和 BillingAdminEndpoints 的后端控制器已存在于 model-access 模块（T-023 交付），前端 billing.tsx 与其对接；对账后端（ReconciliationRun）同理。本任务只补了前端页面，未重复实现这部分后端。

4. PersonaVersionAdminController 的 `@HttpCode(200)` 未显式标注（NestJS 默认 GET 200、POST 201），rollback POST 目前返回 200（符合契约，AdminCharacter 响应）。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给架构负责人：本任务新增了 `packages/contracts/src/http/admin-content.ts` 并将版本从 2.3 升至 2.4。变更内容均为新增接口/类型（次版本变更）。建议架构复核确认，写入契约变更记录。

- 给 Web 前端负责人：管理前端三个页面（usage.tsx、billing.tsx、scenario-modes.tsx）已在 apps/admin 中实现，但这是管理后台（apps/admin），与用户端 Web（apps/web）无关，仅供知悉。

- 给 AI 负责人：PersonaVersionAdminEndpoints.rollbackPersonaVersion 使用已有的 `characters.persona_version_published` 领域事件，若 AI 运行时订阅了该事件，需注意版本号自增的含义与正常发布相同，无额外字段区分。
