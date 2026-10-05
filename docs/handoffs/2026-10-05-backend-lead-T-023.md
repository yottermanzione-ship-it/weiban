# 交接说明：T-023 计费模块 billing（D-L0-16）+ 追加 A（注册赠送）/ B（identity 契约 1.2 补充）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-05 |
| 分支 | `T-023-billing`（已合并 origin/main 4a8020f，契约 1.2） |

## 做了什么

**结论**：计费模块完成，模型网关（D-L0-09）现在可以接入「冻结 → 调用 → 结算 / 解冻」。总负责人追加的 A、B 两部分也已完成。`pnpm check` 带数据库全部通过（227 条测试，0 跳过）。

1. **billing 模块**（实现说明 `docs/backend/billing.md`）：用户钱包 + 平台账户；只增不改的流水（数据库触发器拒绝改和删）；冻结 / 结算（多退少补）/ 解冻（失败不扣钱，上游仍收费时记平台吸收）/ 过期清理（每分钟）；价目表版本、发布、分时价估价；用户后台每日上限（含 `countAsBackground`、豁免用途）；平台每日上限原子预留（Q-007）；安全优先透支（上限 2 元，可用环境变量覆盖）；余额事件 changed / depleted / low / restored（Q-008）；用户端 5 个接口、管理端 10 个接口；每日对账（3:30 北京时间）；删除清单。
2. **A. 注册赠送**：billing 订阅 `identity.user_registered`，先查账号状态端口、不是 active 就跳过；钱包按需创建（两处都「有则跳过」）；有赠送时写 `admin_grant`，备注「注册赠送」，幂等键 `signup_bonus:{userId}`。
3. **B. identity 补充**：邀请码表加 `bonus_micros`（迁移 0003 + 回滚）；生成邀请码接口与命令行（`--bonus 元`）支持赠送金额，响应总是带 `bonusMicros`，审计记金额不记码；注册事件带 `signupBonus`；实现 `IdentityAccountStatusPort`（令牌 `IDENTITY_ACCOUNT_STATUS_PORT`，从 identity 的 `index.ts` 导出）；两个注销管理接口 `GET /admin/account-deletions`、`POST /admin/account-deletions/:userId/retry`。
4. **平台内核**：新增 `JobQueue.schedule()`（定时任务）；配置新增 3 个计费变量（`kernel.md` 第 3 节）。

## 验收项实际验证结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| `pnpm check` 带数据库全部通过，0 跳过 | 通过 | 本机 `pnpm check`：format、lint（含 R9 / 依赖检查）、typecheck、20 个测试文件 227 条全部通过、tokens 检查通过；无跳过 |
| 分支 CI success | 见最终回复 | 推送后 `gh run list --branch T-023-billing` |
| 冻结 → 结算多退少补；失败全额解冻；重复结算只扣一次 | 通过 | `billing.test.ts`「多退少补…」「调用失败…」「冻结过期…」：冻结 0.01 元、实扣 0.006 元退回余额；实扣 0.018 元超出照扣；同一 usageRecordId 再结算返回同一条流水、余额不变；解冻后余额不变、无扣费流水 |
| 并发冻结不超额；平台每日上限不被同时突破 | 通过 | 同一用户 20 个请求同时冻结（余额只够 5 个）→ 恰好 5 个成功、可用余额 0；10 个用户 20 个请求同时冻结、上限只够 6 个 → 恰好 6 个成功、预留 30,000 ≤ 上限 32,000，被拒的钱包没有冻结 |
| 余额被拒后加余额发「余额恢复」，不要求从零回正 | 通过 | 余额 0.005 元、冻结 0.01 元被拒 → `insufficient = true`（可用余额仍为正）→ 加余额 → `balance_restored(topped_up_after_rejection)`；解冻不发；另测 `crossed_zero` |
| 安全透支（6.6 第 8 条清单） | 通过 | 余额 0 带透支的 chat_reply 冻结成功、流水为负且带标记、写审计；不带被拒；proactive / memory 带透支被拒（billing 按普通冻结处理，`bad_request` 由网关返回，见遗留 5）；透支到上限后再被拒；加 3 元先抵扣 −1.6 元、发 `balance_restored(crossed_zero)`；平台上限已满时透支冻结同样 `budget_exceeded` |
| 流水只能追加 | 通过 | 测试直接执行 UPDATE / DELETE / TRUNCATE / 删账户级联，全部被数据库拒绝 |
| 期初 + 收入 − 支出 = 期末；对账能发现人为不一致 | 通过 | 流水合计 = 账户余额（0 + 1 − 0.01 = 0.99 元）；手工改账户余额 +1 微元后对账 `ledgerConsistent = false` 并列出差额；同时发现 1 个超时冻结、上游账单偏差标红、透支过深账户标红 |
| 管理员加 / 扣余额必须填原因并写审计 | 通过 | 缺原因 / 原因过短 400；审计 `wallet.admin_grant` / `wallet.admin_deduct` 含原因；幂等；同键不同金额 409；扣超可用余额 422；普通用户 403；用户不存在 404 |
| 提交格式 `T-023 类型: 说明` | 通过 | 见 git log |

**A 部分（billing.md 8.3 第 4 条测试清单）**：带赠送的码注册后余额 = 赠送金额、明细一条备注「注册赠送」的 `admin_grant`（通过）；同一事件投递两次只记一次（收件箱去重 + 直接再调处理函数，幂等键去重，通过）；不带赠送的码不写流水（通过）；账号已注销 / 不存在时迟到的注册事件不建钱包、不记流水（通过）；赠送为负、非整数、超过上限的生成请求 400（通过）；管理员生成的码，流水操作人 = 该管理员（通过）；事件里不带邀请码（通过）。

**B 部分**：邀请码响应总是带 `bonusMicros`，列表同样（通过）；账号状态端口 active / deleting / null（通过）；注销未完成列表含用户名、模块进度（通过），普通会话访问 401（通过）；重新触发 202、记录时间、不存在的账号 404、账号删完后再触发 404（通过）；全部模块已回报时重新触发直接完成账号删除（通过）；billing 删除清单删干净（`verify-purged` 全 0）、审计不含用户 ID 原文、记删除时余额（通过）。identity 原有注销测试已按「billing 也登记了删除清单」更新预期。

**另做的验证**：用测试库启动整个服务器（`tsx src/main.ts`，APP_ROLE=all）：`/health` 正常，pg-boss 里登记了 `billing.expire_holds`（每分钟）和 `billing.reconcile`（每天 3:30，北京时间）两个定时任务。

## 改了哪些文件

- 新增 `apps/server/src/modules/billing/`：`index.ts`、`tokens.ts`、`testing.ts`、`billing.module.ts`、`domain/rules.ts`、`domain/local-time.ts`、`domain/rules.test.ts`、`infra/db/schema.ts`、`application/{ledger,reservations,platform-budget,prices,wallet,admin,reconciliation,lifecycle}.ts`、`http/billing.controller.ts`
- 新增迁移：`apps/server/drizzle/0002_billing.sql`（含手写的只增不改触发器与删除函数）/ `.down.sql`、`0003_identity_invite_bonus.sql` / `.down.sql`、`meta/0002_snapshot.json`、`meta/0003_snapshot.json`；修改 `meta/_journal.json`
- identity：`infra/db/schema.ts`、`application/{invites,accounts,commands,deletion,settings}.ts`、`http/identity.controller.ts`、`identity.module.ts`、`index.ts`、`tokens.ts`；`src/cli/identity.ts`
- 平台内核：`platform/config/config.ts`（+ `config.test.ts`）、`platform/jobs/job-queue.ts`
- 装配：`apps/server/src/app.module.ts`
- 测试：新增 `apps/server/test/billing.test.ts`；修改 `apps/server/test/identity.test.ts`（注销回报预期）
- 文档：新增 `docs/backend/billing.md`；修改 `docs/backend/identity.md`、`docs/backend/kernel.md`；本交接说明

## 遗留问题

1. 管理端账户列表的 `username` 暂为空字符串（需要契约变更申请 1）。
2. 对账第 ② 层（用量记录 ↔ 扣费）要等 model-access（D-L0-08）和契约变更申请 2；目前 `usageWithoutCharge` / `chargeWithoutUsage` 记 0，明细里标 `pending_model_access`。
3. 上游 ID 传不进来（契约变更申请 3），所以对账第 ③ 层和「各上游近 30 天成本」在申请批准前没有数据。
4. 发布价目表时「目录中启用的模型缺少价格 → 422」没实现：billing 不能调用 model-access（依赖方向）。建议 D-L0-08 / D-L0-13 处理（见给架构的说明）。
5. 安全透支条件不满足时，billing 按契约「按普通冻结处理」，`bad_request` 由网关（D-L0-09）返回；网关的这条测试要在 D-L0-09 补。
6. 价目表暂不支持「预约将来生效」（`effectiveFrom` 晚于现在返回 400）。
7. 「通知管理员」（平台预算到 80%、对账异常）目前只写审计和错误日志，等推送 / 管理后台红点。
8. 流水只增不改用的是触发器而不是撤销权限（理由见 `docs/backend/billing.md` 第 4 节），请架构确认这个偏差。

## 需要总经理决定的事

无。（生产环境平台每日总上限的具体数值由运维在 D-L0-14 定，属于工程参数。）

## 给其他负责人的交接

- **给架构负责人（契约变更申请，均为次版本、只新增）**：
  1. `IdentityReadPort`（或新端口）增加「按用户 ID 批量取用户名」，例如 `getUsernames(userIds: string[]): Promise<Record<string, string>>`。原因：`AdminAccountSummary.username` 必填，billing 没有途径取得；billing.md 10.1 第 5 条依赖它把用户名换成 ID。
  2. `BillingReadPort` 增加按用量记录 ID 查扣费的只读方法（T-020 交接第 1 条）：`getChargesByUsageRecordIds(ids: string[]): Promise<Array<{ usageRecordId; ledgerEntryId; amountMicros; costMicros; absorbed; safetyOverdraft }>>`，以及按北京日期列出当天扣费的用量记录 ID（对账第 ② 层由 model-access 比对）。实现已在 `ReconciliationService.chargesByUsage`，批准后挂到端口即可。
  3. `SettleInput`、`ReleaseInput` 增加可选 `upstreamId`。原因：对账第 ③ 层按上游比对、`platform-summary.last30DaysCostByUpstream` 需要；billing 不能读 model-access 的模型目录。实现已接受该字段。
  4. 请确认两处偏差：流水只增不改用触发器（billing.md 5.2 第 2 条写的是撤销权限）；价目表不支持预约生效。
  5. 「发布价目表时启用模型缺价 → 422」需要模型目录：建议由 model-access 提供一个「列出启用模型键」的只读端口，在装配层或管理后台调用前检查，或把这条规则改到 model-access 启用模型时检查价目表（用 BillingReadPort 新方法）。请定方案。
  6. 契约里没有「通知管理员」的事件，平台预算 80%、对账异常、上游余额用完都需要，建议统一设计。
- **给 AI 负责人（D-L0-09 网关）**：注入 `BILLING_RESERVATION_PORT`（`apps/server/src/modules/billing/index.ts`）；用法、幂等、错误、加锁规则见 `docs/backend/billing.md` 第 5 节。注意：用错端口（结算已解冻的冻结等）会抛异常；`price_missing` 对外报 `model_unavailable`；`safetyPriority` 不合法时网关自己返回 `bad_request`（billing 只会按普通冻结处理）。
- **给运维负责人**：新增环境变量 `BILLING_PLATFORM_DAILY_CAP_MICROS`（**生产必填**，不配置服务器拒绝启动；数值请在 D-L0-14 定并写进操作手册），`BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS`（一般不设）、`BILLING_UPSTREAM_DIFF_RATIO`（默认 0.03）。请按需加到 `.env.example`。监控：日志里「平台每日成本已达上限的 80%」「对账发现异常」为错误级，建议告警。定时任务只在 APP_ROLE = worker / all 的进程运行。
- **给 Web / Android 负责人**：接口可以接真实后端了。余额可能为负（安全透支）；流水筛选 `topup` / `spend` 按金额正负；`usage-summary` 的 `groupBy=character` 没有角色的键为 `none`；管理端账户列表的 `username` 暂时为空，先显示用户 ID；邀请码页面的「注册赠送余额」、注销未完成列表与重新触发接口已可用。
- **给质量负责人**：复核命令 `pnpm install && pnpm db:up && pnpm check`；重点看 `apps/server/test/billing.test.ts`（并发、透支清单、只增不改、对账）和 R9（只有 model-access 能引用扣费端口，lint 已通过）。
- **给项目总负责人**：上面 6 条契约 / 设计问题请转架构；`.env` 新变量转运维；model-access 开工时把 `docs/backend/billing.md` 第 5、8 节列为必读。
