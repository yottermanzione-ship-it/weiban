# 模型接入模块 model-access 后端实现说明（apps/server/src/modules/model-access）

> 负责人：后端负责人 · v1.0 · 2026-10-06 · 来源任务：T-027（D-L0-08，含契约 1.3 追加三项）
> 读者：AI 负责人（D-L0-09 在本模块里加网关）、管理后台与客户端负责人、运维、质量。
> 规则来源（本文不重复）：设计 `docs/architecture/billing.md`（第 3、8.2、8.4、9、10.1 节）；决策 ADR-0012、ADR-0017；
> 接口以 `packages/contracts/src/http/model-access.ts`、`src/ports/model-gateway.ts`、`src/ports/billing.ts`、`src/events.ts` 为准；内核用法 `docs/backend/kernel.md`。

## 0. 一句话

管理员登记「上游」（接口地址 + 平台密钥，密钥加密保存、只显示掩码），在「模型目录」里把模型键指到上游；用户只选模型（全局聊天 / 后台 / 成人模式，按角色单独设置），**无审查模型只能给有成人资格的角色用**；每次调用一条用量记录，管理后台可汇总、看明细、导出；每天 3:45 把用量记录和扣费流水对一遍账。

## 1. 目录

| 位置 | 内容 |
|---|---|
| `index.ts` | 公开出口：`ModelAccessModule`、`MODEL_ACCESS_POLICY`（policy 上线后在装配处绑定） |
| `testing.ts` | 测试出口：假上游 / 假价格 / 假计费查询的注入令牌，网关用的内部服务 |
| `tokens.ts` | 依赖的外部能力：`MODEL_ACCESS_POLICY`、`MODEL_ACCESS_CHARGE_QUERY`、`UPSTREAM_PROBE`、`MODEL_PRICE_SOURCE` |
| `domain/rules.ts` | 纯规则：密钥规整与掩码、连通测试分类、接口地址检查、可用性、价格档位、北京日期、游标 |
| `infra/db/schema.ts` | 表定义（schema `model_access`）；迁移 `drizzle/0004_model_access.sql` + 手写回滚 |
| `infra/upstream-probe.ts` | 连通测试：OpenAI 兼容 `GET {baseUrl}/models` |
| `application/upstreams.ts` | 上游登记、更换密钥、手动测试、删除、`withApiKey`（解密）、`reportStatus`（网关 / 探测报告状态） |
| `application/catalog.ts` | 模型目录（管理端）、模型列表（用户端）、按键查事实、平台默认模型 |
| `application/selection.ts` | 全局选择、角色单独模型（无审查模型闸门：写入时） |
| `application/resolver.ts` | `ModelResolver.resolve`（无审查模型闸门：调用时；识图改用默认识图模型）、`ModelStatusService` |
| `application/usage.ts` | `UsageRecorder`（给网关写用量记录）、`AdminUsageService`（ADM-08 汇总 / 明细 / 导出） |
| `application/reconciliation.ts` | 每日用量对账（第 ② 层） |
| `application/lifecycle.ts` | 删除清单、`contacts.contact_purged` 订阅、定时任务登记 |
| `application/defaults.ts` | 外部能力就绪前的默认实现（见第 2 节） |
| `http/model-access.controller.ts` | 契约 `ModelAccessEndpoints`（6 个）、`ModelAccessAdminEndpoints`（7 个）、`ModelAccessAdminUsageEndpoints`（3 个） |

## 2. 外部能力与默认实现（重要）

| 令牌 | 契约 | 现在绑定的 | 换成真实实现的时机 |
|---|---|---|---|
| `MODEL_ACCESS_POLICY` | `PolicyPort.checkModelForCharacter` | `FailClosedModelPolicy`：**失败即拒绝**——任何角色都不能用 adult_content 模型，普通模型放行 | policy 模块（D-L0-11）导出令牌后，在 `model-access.module.ts` 改为 `useExisting` |
| `MODEL_ACCESS_CHARGE_QUERY` | `BillingChargeQueryPort`（契约 1.3） | `ChargeQueryUnavailable`：调用即报「暂不可用」——**启用模型返回 503**（不放行未查价的模型），用量对账跳过并写错误日志 | billing 实现并导出令牌后改为 `useExisting`（另开任务） |
| `MODEL_PRICE_SOURCE` | 无（契约没有「读当前价目表单价」） | `EmptyPriceSource`：价格档位一律显示「中等」 | 需要契约变更申请，见交接说明 |
| `UPSTREAM_PROBE` | 无（模块内部） | `OpenAiCompatibleProbe` | D-L0-09 的适配器可替换 |

**注意**：在 billing 接上 `BillingChargeQueryPort` 之前，管理后台**无法启用任何模型**（503）。这是有意的：不查价就启用会让模型出现在列表里却调用失败。

## 3. 表（schema `model_access`）

| 表 | 说明 |
|---|---|
| `upstreams` | 名称、类型、接口地址、`secret_ciphertext`（平台数据密钥信封加密，AAD = `upstream:{id}`）、`display_prefix` / `display_suffix`（掩码）、状态、测试与换钥时间 |
| `upstream_status` | 状态变化历史（来源：created / admin_test / key_rotated / gateway / probe；失败类别，不含上游原文）；上游删除时级联删除 |
| `model_catalog` | 契约 `AdminCatalogEntry` 全部字段。`upstream_id` 不加外键（契约允许删除只剩停用模型指向的上游）；CHECK：无审查模型不能有 `default_for` |
| `selections` | 用户全局选择（chat / background / adult，空 = 未设置） |
| `character_overrides` | (用户, 角色) → 聊天模型 |
| `usage_records` | 每次网关调用一行：用途、计费账户、模型角色、模型键、上游、幂等键（唯一）、状态 pending / succeeded / failed、token（**`input_tokens` 是未命中缓存的输入**，与 billing 计价一致）、估算标记、耗时、首字耗时、重试次数、冻结 ID、价目表版本、流水 ID、金额快照（charged / cost / absorbed）、`safety_overdraft`、`snapshot_at`、会话类型、人设版本等。**不存任何内容** |

没有建 `leaderboard_entries`：排行名次就是目录条目的 `leaderboardRank`（契约字段），不需要单独的表。

## 4. 接口与状态码（契约没写死、由后端决定的部分）

| 接口 | 说明 |
|---|---|
| `POST /admin/model/upstreams` | 密钥去首尾空白后 8～512 字，否则 400；接口地址：生产只允许 https，不允许带账号密码 / 查询串 / 片段（400）；先连通测试，失败 422 `upstream_test_failed` + `details.reason`，**不保存**，写审计 `upstream.test_failed`（不含密钥）；成功 201 |
| `PUT .../:id/key` | 新密钥先测试，失败 422 且旧密钥不变；成功替换、状态置 active、审计记新旧掩码；上游不存在 404 |
| `POST .../:id/test` | 用已存密钥测试，**失败也返回 200**（`status` 为新状态） |
| `DELETE .../:id` | 有启用模型指向 409 `conflict`（`details.modelKeys`）；成功 204 |
| `PUT /admin/model/catalog/:modelKey` | 路径需 URL 编码（`/` → `%2F`）；路径与请求体模型键不一致或格式不对 400；无审查模型设默认 422 `model_not_allowed`；默认识图模型没有 vision 能力、停用的模型设默认、启用 / 改指到不存在的上游 → 422 `bad_request`；**保存为启用时当前价目表无价格 → 422 `model_unavailable`**（契约 1.3），计费查询未接入 → 503 `service_unavailable`；设新默认时**自动从原默认模型上摘掉**（审计 `defaultMovedFrom`） |
| `GET /model/models` | 只列启用的；用户看不到上游；`available` = 上游 active |
| `PATCH /model/selection` | 不存在 / 停用 422 `model_unavailable`；chat / background 选无审查模型 422 `model_not_allowed`；任一字段不合法则**整个请求不生效** |
| `PUT /model/character-overrides/:id` | 每次都问 policy（普通模型也问，policy 顺便确认角色属于该用户）：`character_not_found` → 404，`model_not_allowed` → 403，其他拒绝 → 403 `policy_denied`；`chat: null` 恢复默认 |
| `GET /model/character-overrides/:id` | 只查本人的设置，不问 policy |
| `GET /model/status` | 见第 5 节 |
| `POST /admin/model/usage/*` | `from >= to` 400；游标不合法 400；只统计已结束的调用（不含 pending）；导出写审计 `usage.exported`（含筛选条件） |

## 5. 模型解析与无审查模型闸门

解析顺序（`ModelResolver.pick`）：
- chat：角色覆盖 > 全局聊天 > 平台默认聊天；
- background：全局后台 > 用户的聊天模型（角色覆盖 > 全局聊天）> 平台默认后台 > 平台默认聊天；
- adult：只看用户的成人模式模型，不回落；
- 用途 vision：先按上面解析，模型没有 vision 能力时改用平台默认识图模型，没有则 `capability_missing`。
- 选中的模型下架 → `model_unavailable`、上游异常 → `provider_unavailable`，**不自动换**（MDL-04）。

闸门两道：
1. **写入时**（selection.ts）：全局 chat / background 拒绝无审查模型；角色单独模型问 policy。
2. **调用时**（`ModelResolver.resolve`）：解析出的模型带 adult_content 时，没有 `characterId` 或 policy 拒绝 → `model_not_allowed`，网关不得调用上游。这道防的是「管理员事后给已被选为全局聊天模型的模型加上 adult_content」之类绕过；有集成测试。

`GET /model/status`（`ModelStatusService`）：没有可用选择 → `not_configured`；模型问题优先（`model_removed` / `provider_unavailable`），角色单独模型不可用而全局（或平台默认）正常时 `canFallbackToDefault = true`；模型正常再看 `BillingReadPort.getSpendStatus().insufficient` → `insufficient_balance`。

## 6. 上游状态、事件与管理员提醒

`applyStatus`（上游行加锁后）：状态不变什么都不做；变化时写 `upstream_status` 历史、审计 `upstream.status_changed`、错误日志（异常）/ 信息日志（恢复），并在同一事务里：
- 可用性翻转（active ↔ 非 active）时，对指向它的每个**启用**模型发 `model_access.model_status_changed`（`provider_unavailable` / `recovered`）；
- 发 `platform.admin_alert_raised`（billing.md 8.4）：`quota_exhausted` → `upstream_quota_exhausted`（critical）、`invalid` → `upstream_invalid`（critical）、`unavailable` → `upstream_unavailable`（warning）、从异常回到 active → `upstream_recovered`（info）；合并键 `{kind}:{upstreamId}`，说明只含上游展示名，不含用户信息和密钥。

目录条目启用 / 停用、改指上游导致可用性翻转时也发 `model_status_changed`（停用为 `model_removed`）。新建条目不发。选择变化发 `model_access.selection_changed`。

## 7. 每日用量对账（第 ② 层，契约 1.3）

定时任务 `model_access.reconcile_usage`，每天 3:45（北京时间）对前一天；`UsageReconciliationService.run(day)` 也可手动调用。步骤见源码头注释，要点：
- 金额快照缺失的已结束记录先按 billing 返回值补写（`snapshotsRepaired`）；
- 按 usageRecordId 精确匹配；当天对不上的再按 ID 补查（跨零点），不按日期判缺失；
- 失败调用若有向用户收费的流水算金额不一致；流水 ID 与快照记录的不同也算不一致；
- 发 `model_access.usage_reconciled`；有异常再发 `admin_alert_raised`（`reconciliation_flagged:{day}:usage`，warning）、审计 `usage.reconciliation_flagged`（最多各 50 个记录 / 流水 ID）和错误日志。**不自动修复**。
- 计费查询端口未接入时跳过（不发假结果）。

## 8. 给网关（D-L0-09）的构件

| 用途 | 调用 |
|---|---|
| 解析模型 + 闸门 + 识图回退 | `ModelResolver.resolve({ userId, modelRole, purpose, characterId })` → `PortResult<ResolvedModel, GenerateError>` |
| 解密密钥 | `UpstreamService.withApiKey(upstreamId, async (apiKey) => …)`：只在回调里用，不要记录 |
| 报告上游状态 | `UpstreamService.reportStatus(upstreamId, status, 'gateway' \| 'probe', failure?)`（自动发事件和提醒） |
| 用量记录 | `UsageRecorder.start`（同幂等键返回已有记录，`created = false`）→ `attachHold` → `finish` → `writeSettleSnapshot` / `writeReleaseSnapshot` |
| 模型状态 | `ModelStatusService.getModelStatus(userId, characterId)` = 契约 `ModelGatewayPort.getModelStatus` |

用量记录金额口径：成功调用 `charged` / `cost` 为 settle 返回值；失败调用 `absorbed` 与 `cost` 都写 release 返回的平台吸收成本（平台的真实成本）。

## 9. 删除清单

注销：删该用户的 `selections`、`character_overrides`、`usage_records`（含该管理员发起的平台账户调用记录）。角色彻底删除（`contacts.contact_purged`）：删该用户对该角色的单独模型设置；用量记录保留（与 billing 流水一致，随注销删除）。

## 10. 测试

- 单元：`domain/rules.test.ts`（掩码、分类、接口地址、可用性、价格档位、游标）。
- 集成：`apps/server/test/model-access.test.ts`（25 条，本机假上游 HTTP 服务 + 假 policy / 价格 / 计费查询）：上游登记四种失败分类、掩码、数据库只有密文、换钥失败不覆盖、手动测试状态与事件 / 提醒、网关报告状态不重复发、删除 409 / 204 / 404、管理端 403 / 401；目录默认规则、查价 422 / 503、默认转移、审计、用户端列表与筛选；全局选择与角色单独模型闸门（403 / 404 / 422）、调用时闸门绕过测试、解析顺序与识图回退；模型状态四种原因与回退；用量汇总口径、分页、导出审计；对账（补写快照、跨零点、三类异常、事件、提醒、端口未接入）；删除清单；最后全库 + 日志搜索金丝雀密钥。
