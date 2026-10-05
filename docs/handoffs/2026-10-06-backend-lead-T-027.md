# 交接说明：T-027 模型接入模块 model-access（后端部分，D-L0-08）+ 契约 1.3 追加三项

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-06 |
| 分支 | `T-027-model-access`（已合并 origin/main c60ece1，契约 1.3） |

## 做了什么

**结论**：model-access 的后端部分完成，契约里 model-access 的 16 个后端接口全部实现并有测试；AI 负责人可以在本模块里接着做网关（D-L0-09）。总负责人追加的契约 1.3 三项（启用模型查价、每日用量对账、上游状态发管理员提醒）也已完成，其中 billing 侧的查询端口还没实现，先用「暂不可用」占位（见遗留 1）。

1. **上游登记**：先连通测试（OpenAI 兼容 `GET /models`，不花钱）再保存；平台密钥信封加密（AAD = `upstream:{id}`），数据库只有密文和掩码；更换、手动测试、删除；全部写审计；生产只允许 https 接口地址。
2. **模型目录**：管理端维护（默认规则：无审查模型不能当默认、识图默认必须有 vision、每种默认只有一个且自动转移）；用户端列表（只列启用的，用户看不到上游）。
3. **用户模型选择**：全局 chat / background / adult、按角色单独设置；**无审查模型闸门**写入时 + 调用时两道。
4. **用量记录表**一次建好 ADM-08 需要的全部字段（金额快照、`safety_overdraft`、`conversation_kind` 等），给网关的写入方法；管理后台汇总 / 明细 / 导出。
5. **模型状态**：`GET /model/status`、`ModelGatewayPort.getModelStatus` 的实现；`model_status_changed`、`selection_changed` 事件。
6. **契约 1.3 追加**：① 启用模型时查价（缺价 422 `model_unavailable`）；② 每天 3:45 用量对账，发 `model_access.usage_reconciled`，异常发 `reconciliation_flagged` 提醒；③ 上游状态变化发 `platform.admin_alert_raised`。
7. 删除清单；订阅 `contacts.contact_purged` 删角色单独模型。

实现说明：`docs/backend/model-access.md`。

## 验收项实际验证结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| 契约中 model-access 的后端接口全部实现，每个接口都有测试 | 通过 | `apps/server/test/model-access.test.ts` 25 条覆盖用户端 6 个、管理端上游 5 个 + 目录 2 个、用量 3 个接口（含 400 / 401 / 403 / 404 / 409 / 422 / 503） |
| 平台密钥：数据库只有密文，接口只返回掩码，日志中搜不到 | 通过 | 金丝雀密钥 `sk-weiban-canary-…`：密文字节里不含原文；上游表整行、状态历史、审计、发件箱、全部日志里都搜不到完整密钥和后 16 位；响应只有 `sk-w…xxxx`；`withApiKey` 能解密回原文。假上游故意在 401 响应里回显密钥，网关不读不记 |
| 无审查模型闸门：没有成人资格的角色选不了，接口绕不过去 | 通过 | 全局 chat / background 选无审查模型 422；无资格角色单独设置 403、角色不存在 404；有资格角色可以；**绕过测试**：管理员事后给用户已选的全局聊天模型加上 adult_content，调用时解析对无资格角色 / 无角色都返回 `model_not_allowed`；成人模式模型同样受限；无审查模型设平台默认 422（数据库 CHECK 兜底） |
| 契约 1.3 ①②③ | 通过 | 缺价 422、端口未接入 503、停用保存不查价；对账补写 2 条快照、跨零点补查、缺扣费 / 多扣费 / 金额不一致各被发现、事件与提醒发出、提醒不含用户 ID、端口未接入时不发假结果；上游 invalid / quota_exhausted（critical）、unavailable（warning）、恢复（info）提醒，状态不变不重复发 |
| 本机只运行一次 `pnpm check`（带数据库） | 见最终回复 | — |
| 提交格式 `T-027 类型: 说明` | 通过 | git log |

另：因为 model-access 登记了删除清单，identity / billing 原有注销测试的预期从「billing（+ chat）」更新为「再加 model_access」。

## 改了哪些文件

- 新增 `apps/server/src/modules/model-access/`：`index.ts`、`testing.ts`、`tokens.ts`、`model-access.module.ts`、`domain/rules.ts`、`domain/rules.test.ts`、`infra/db/schema.ts`、`infra/upstream-probe.ts`、`application/{upstreams,catalog,selection,resolver,usage,reconciliation,lifecycle,defaults}.ts`、`http/model-access.controller.ts`
- 新增迁移 `apps/server/drizzle/0004_model_access.sql`、`0004_model_access.down.sql`、`meta/0004_snapshot.json`；修改 `meta/_journal.json`
- 装配：`apps/server/src/app.module.ts`
- 测试：新增 `apps/server/test/model-access.test.ts`；修改 `apps/server/test/identity.test.ts`、`apps/server/test/billing.test.ts`（删除清单多了 model_access）
- 文档：新增 `docs/backend/model-access.md`、本交接说明

## 遗留问题

1. **billing 还没实现 `BillingChargeQueryPort`**（契约 1.3，总负责人另开任务）。现在绑定的占位实现会让「启用模型」返回 503、每日对账跳过。也就是说：**billing 那一项做完之前，管理后台无法启用任何模型**。billing 导出令牌后，在 `model-access.module.ts` 把 `MODEL_ACCESS_CHARGE_QUERY` 改成 `useExisting` 即可（一行）。
2. **policy 模块（D-L0-11）未实现**：无审查模型闸门暂用「失败即拒绝」——任何角色都不能用无审查模型（总经理测试成人模式要等 D-L0-11）。policy 导出令牌后把 `MODEL_ACCESS_POLICY` 改成 `useExisting`。
3. **价格档位 `priceTier` 暂时一律「中等」**：契约没有「读当前价目表单价」的端口（`listActivePricedModelKeys` 只有键没有价格），见下方变更申请。
4. 上游恢复探测（每 5 分钟）、真正的模型调用、`checkAdultGeneration`、`safetyPriority` 校验属于 D-L0-09（AI 负责人），本任务只提供构件。
5. `model.status_updated`（每用户更新日志）要等 realtime 的 SyncPort（D-L1-01）；现在只有领域事件。
6. 种子数据（首批上游与目录）没有做：上游需要真实密钥，总经理暂不配置；目录初始数据属于 D-L0-09。
7. 管理员把某个已被用户选为全局聊天 / 后台的模型改成无审查模型时，服务器不拒绝修改，只在调用时拒绝（选择页显示仍为可用）。如需在管理端直接拦下，可后续加「该模型被多少用户选为全局模型」提示。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- **给项目总负责人**：遗留 1 是 L0 能跑通的前置条件，请让 billing 补 `BillingChargeQueryPort` 的任务尽快排上；遗留 2 同理依赖 D-L0-11。
- **给架构负责人（契约变更申请，次版本、只新增）**：在 `BillingChargeQueryPort`（或新只读接口）增加「当前生效价目表的文本单价」，例如 `getActiveTextPrices(modelKeys): Promise<Record<modelKey, { inputPerMillionMicros; cachedInputPerMillionMicros | null; outputPerMillionMicros }>>`（同一单位有分时段价时返回最高价）。原因：`ModelInfo.priceTier` 契约写明「由价目表推算」，model-access 看不到价格；推算规则已按 `cost-estimate.md` 7.2 实现并测试，接上即可。
- **给 AI 负责人（D-L0-09 要点）**：
  1. 网关类放在本模块（`model-access/`），实现 `ModelGatewayPort`，在 `index.ts` 导出它的注入令牌；`getModelStatus` 直接转调 `ModelStatusService.getModelStatus`。
  2. 选模型一律用 `ModelResolver.resolve(...)`：它已做「调用时无审查模型闸门」和识图回退，返回的错误码就是 `GenerateError`。`modelRole = adult` 另需调 `PolicyPort.checkAdultGeneration`（本任务没做）。
  3. 密钥只用 `UpstreamService.withApiKey(upstreamId, fn)`，回调里发请求，别记录、别缓存；上游错误原文按 `security-and-privacy.md` 第 4 节消毒后才可记录。
  4. 上游故障 / 余额用完 / 密钥失效时调 `UpstreamService.reportStatus(upstreamId, 'unavailable' | 'quota_exhausted' | 'invalid', 'gateway', 错误类别)`，恢复探测成功调 `reportStatus(..., 'active', 'probe')`；事件、管理员提醒、审计会自动发出，不要自己再发。恢复探测任务（每 5 分钟）可以复用 `UPSTREAM_PROBE`。
  5. 用量记录：`UsageRecorder.start`（`created = false` 表示同一幂等键已调用过，走「返回第一次结果」分支——注意用量记录不存模型输出，24 小时内返回第一次结果需要你另存结果，并决定存哪里、多久删）→ 冻结成功后 `attachHold` → 结束 `finish`（`inputTokens` 填**未命中缓存**的输入）→ `settle` 后 `writeSettleSnapshot`、`release` 后 `writeReleaseSnapshot`。快照没写成也没关系，每日对账会按 billing 补写。
  6. `settle` / `release` 记得传 `upstreamId`（`ResolvedModel.upstreamId`，契约 1.3）。
  7. 连通测试现在用 `GET /models`（不花钱、不记账）；若某家的模型列表不校验密钥，改为极小生成请求时要走平台账户 `admin_upstream_test`。
  8. 目录初始数据：管理员录入顺序必须是「登记上游 → 发布含价格的价目表 → 启用模型」，否则启用会被 422 拒绝。
- **给后端（billing 补充任务）**：实现 `BillingChargeQueryPort` 并在 billing `index.ts` 导出令牌；`model-access.module.ts` 里 `MODEL_ACCESS_CHARGE_QUERY` 改 `useExisting`；`listChargesByDay` 的游标格式自定（model-access 原样回传）。
- **给 Web 负责人（D-L0-12 / D-L0-13）**：接口可接；目录保存路径里的模型键要 `encodeURIComponent`；缺价 422 时提示「先发布价格再启用」；503 时提示「计费查询暂不可用」；`POST .../test` 失败也是 200，看返回的 `status`；用户端价格档位暂时都是「中等」。
- **给运维负责人**：没有新增环境变量。生产环境上游接口地址必须是 https。日志告警请覆盖「上游状态异常，需要管理员处理」「用量与扣费对账发现异常」「计费查询端口尚未接入，用量对账（第 ② 层）未运行」三条错误日志。定时任务 `model_access.reconcile_usage` 只在 APP_ROLE = worker / all 的进程运行。
- **给质量负责人**：复核 `pnpm install && pnpm db:up && pnpm check`；重点看 `apps/server/test/model-access.test.ts` 的金丝雀与闸门绕过用例，以及 `application/resolver.ts` 调用时闸门；policy 与计费查询目前是「失败即拒绝」占位，验收 D-L0-15 时要在真实 policy 上重跑闸门用例。
