# 计费模块 billing 实现说明（apps/server/src/modules/billing）

> 负责人：后端负责人 · v1.0 · 2026-10-05 · 来源任务：T-023（D-L0-16）
> 读者：model-access（网关接计费端口）、ai-runtime（读余额状态、订阅余额事件）、管理后台与客户端负责人、运维、质量。
> 规则来源（本文不重复）：设计 `docs/architecture/billing.md`（v1.3）；决策 ADR-0012、ADR-0016；接口以 `packages/contracts/src/http/billing.ts`、`src/ports/billing.ts`、`src/events.ts` 为准；内核用法 `docs/backend/kernel.md`。

## 0. 一句话

每个用户一个钱包，另有一个平台账户；每笔钱的变动都是一条**只能追加**的流水；模型调用前**冻结**估算金额，成功后按实际用量**结算**（多退少补），失败**解冻**（不扣钱）；冻结时同时检查余额、用户后台每日上限、平台每日上限（原子预留）；安全关怀可透支到 −2 元；每晚自动对账。

## 1. 目录

| 位置 | 内容 |
|---|---|
| `index.ts` | 公开出口：`BillingModule`、`BILLING_RESERVATION_PORT`（**只给 model-access**，R9）、`BILLING_READ_PORT` |
| `testing.ts` | 测试出口：`BillingTestQueries`、`ReservationService`（手动触发过期清理）、`ReconciliationService`（手动对账）、`BillingLifecycle`、默认值常量 |
| `domain/rules.ts` | 纯规则：常量（透支上限默认值、最低冻结额、冻结有效期等）、用途 → 分组、是否计入后台上限、透支资格、计价与分时价、价目表校验 |
| `domain/local-time.ts` | 当地日期、北京时间自然日、下一次当地零点 |
| `infra/db/schema.ts` | 表定义（schema `billing`）；迁移 `drizzle/0002_billing.sql` + 手写回滚 |
| `application/ledger.ts` | 账户加锁、钱包按需创建、写流水 + 改余额 + 余额事件（所有改余额的路径都经过这里） |
| `application/reservations.ts` | 计费端口实现：冻结 / 结算 / 解冻、过期清理 |
| `application/platform-budget.ts` | 平台每日上限的原子预留 |
| `application/prices.ts` | 价目表草稿 / 修改 / 发布 |
| `application/wallet.ts` | 用户端钱包、流水、用量汇总；`BillingReadPort.getSpendStatus` |
| `application/admin.ts` | 管理端账户列表、加扣余额、某用户流水、上游账单、平台花费 |
| `application/reconciliation.ts` | 每日对账；按用量记录 ID 查扣费（对账第 ② 层用，待契约） |
| `application/lifecycle.ts` | 订阅注册事件（注册赠送）、删除清单、定时任务登记 |
| `http/billing.controller.ts` | 契约 `BillingEndpoints`（5 个）+ `BillingAdminEndpoints`（10 个） |

## 2. 接口与状态码

字段以契约为准。下表只写契约没写死、由后端决定的部分：

| 接口 | 成功 | 说明 |
|---|---|---|
| `GET /billing/wallet` | 200 | 钱包不存在时**按需创建**（余额 0，billing.md 8.3 第 3 条）。`resetsAt` = 用户时区（取自资料）的次日 0 点 |
| `PATCH /billing/wallet/settings` | 200 | 只改传了的字段 |
| `GET /billing/ledger` | 200 | `topup` = 金额为正的流水，`spend` = 金额为负的流水；游标是 `(created_at, id)` 的 base64url，游标不合法 400 |
| `GET /billing/prices` | 200 | 没有生效的价目表时 404 `not_found` |
| `GET /billing/usage-summary` | 200 | 只算调用扣费（`charge`，不含平台吸收）；`from`～`to` 按用户当地日期、含两端、最多 366 天；`groupBy=character` 没有角色的记 `none` |
| `POST /admin/billing/accounts/:userId/adjustments` | 201 | 原因必填（契约 2–200 字）；幂等键按「用户 + 键」唯一，重复提交返回第一次的流水；**同一个键换了方向或金额 409 `conflict`**；扣减超过可用余额 422 `insufficient_balance`；用户不存在或正在注销 404 |
| `GET /admin/billing/accounts` | 200 | `username` **暂为空字符串**（见第 8 节遗留） |
| `GET /admin/billing/accounts/:userId/ledger` | 200 | 用户还没有钱包 404 |
| `POST /admin/billing/price-versions` | 201 | 同一模型同一单位同一时段重复、或有时段价却没有全天价 → 400 |
| `PATCH /admin/billing/price-versions/:id` | 200 | 非草稿 409 `price_version_immutable` |
| `POST .../activate` | 200 | `effectiveFrom` 晚于现在 → 400（**暂不支持预约生效**）；重复发布已生效版本直接返回；已停用版本 409 |
| `POST /admin/billing/upstream-bills` | 201 | 开始日期晚于结束日期 400；写审计 |
| `GET /admin/billing/reconciliation` | 200 | 按日期升序 |
| `GET /admin/billing/platform-summary` | 200 | `todayCostMicros` 只算北京时间今天已结算部分 |

## 3. 表（schema `billing`）

| 表 | 主要字段 | 说明 |
|---|---|---|
| `accounts` | `kind` user/platform、`user_id`（唯一）、`balance_micros`、`held_micros`（≥ 0）、提醒线、后台每日上限、`time_zone`、`insufficient_since`、`low_notified_on`、`version` | 平台账户只有一个（部分唯一索引） |
| `ledger_entries` | `type`、`amount_micros`（有符号）、`balance_after_micros`、`idempotency_key`（全局唯一）、`usage_record_id`（未吸收的 charge 唯一）、`hold_id`、`purpose`、`model_key`、`character_id`、`price_version_id`、`upstream_id`、`cost_micros`、`absorbed`、`safety_overdraft`、`reason`、`operator_user_id` | **只增不改**，见第 4 节 |
| `holds` | 金额、用途、模型、幂等键（唯一）、价目表版本、`status`、`expires_at`、`budget_day` + `reserved_cost_micros`、`counts_as_background` + `background_day`、`safety_overdraft`、结束信息 | |
| `daily_spend` | `(account_id, day)` → 后台已结算、总扣费 | `day` 为用户当地日期 |
| `platform_daily_budget` | `budget_day`（北京日期）、`cap_micros`、`settled_cost_micros`、`reserved_cost_micros`、`alert_sent_at` | |
| `price_versions` / `price_items` | 版本状态（只有一个 active）、价格（`band` 为契约 `PriceTimeBand` 或 null） | |
| `upstream_bills`、`reconciliation_runs` | 上游账单、每日对账结果（同一天重跑覆盖；`details` 存异常明细） | |

幂等键的写法：调用扣费 `charge:{usageRecordId}`；平台吸收 `absorbed:{holdId}`；管理员加扣 `admin:{userId}:{后台页面的键}`；注册赠送 `signup_bonus:{userId}`。

## 4. 流水只增不改怎么实现（与 billing.md 5.2 第 2 条的差异，请架构确认）

设计写的是「数据库层面撤销本表的更新、删除权限」。实际上应用和迁移用的是**同一个数据库账号，而且它是表的所有者**，单靠 `REVOKE` 拦不住所有者（所有者可以随时给自己授回）。所以迁移里：

1. `REVOKE UPDATE, DELETE, TRUNCATE ... FROM PUBLIC`（保留，防将来新增的只读账号）；
2. 触发器 `ledger_entries_append_only`：任何 `UPDATE`、`DELETE`、`TRUNCATE` 一律报错（含删除账户时的级联删除）；
3. 唯一例外是注销用的数据库函数 `billing.purge_user_account(userId)`：它在函数内部临时打开事务级开关 `billing.ledger_purge`，删完该用户的流水立刻关掉。

测试直接用数据库连接执行 `UPDATE` / `DELETE` / `TRUNCATE` / 删账户，全部被拒。若以后运维把应用账号和表所有者分开（推荐），再加真正的权限撤销即可，触发器保留。

## 5. 一次调用的计费（给 model-access）

```ts
@Inject(BILLING_RESERVATION_PORT) private readonly billing: BillingReservationPort
const r = await this.billing.estimateAndReserve({ account, purpose, modelKey, characterId, estimate, idempotencyKey, safetyOverdraft, countAsBackground });
// r.ok === false：insufficient_balance / budget_exceeded / price_missing（对外报 model_unavailable）
await this.billing.settle({ holdId, usageRecordId, actual, startedAt });       // 成功
await this.billing.release({ holdId, reason, upstreamUsage?, usageRecordId? }); // 失败
```

| 规则 | 实现 |
|---|---|
| 冻结额 | 估算用量 × **当前生效价目表**的售价（分时价按冻结时刻），向上取整，最低 1,000 微元；同时按成本价算出「平台预算预留」 |
| 结算 | 按**冻结时的价目表版本**、`startedAt` 时刻的分时价计算；实际 > 冻结照常扣（余额可小额为负）；用量里有价目表没定价的单位按 0 计并写错误日志 |
| 命中缓存的输入 | 模型没有单独的缓存价时按普通输入价 |
| 幂等 | 冻结按 `idempotencyKey`（同键返回同一个冻结）；结算按 `usageRecordId`（同 ID 返回第一次的结果）；重复解冻返回第一次的吸收金额 |
| 程序错误 | 用错端口（结算已解冻的冻结、一条用量记录对两个冻结、未知用途、负数用量）**抛异常**，不是 PortResult |
| 过期 | 冻结 10 分钟有效；定时任务 `billing.expire_holds` 每分钟把过期的改为 `expired`、释放额度、归还平台预留；过期后才来的结算照常扣一次 |
| 平台吸收 | 解冻时传了 `upstreamUsage`：按成本价在平台账户记一条 `charge`（`absorbed = true`），计入平台当日已结算成本，用户不付钱 |
| 加锁顺序 | 用户账户 → 平台账户 → 冻结记录 → 平台每日预算行（防死锁） |

**安全优先透支**（billing.md 6.6）：`safetyOverdraft = true` 且用途是 `chat_reply` / `safety_check` / `safety_followup` 且是用户钱包时，可用余额不够就判断「可用余额 − 冻结额 ≥ −上限」；上限默认 2 元，`BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS` 可覆盖。条件不满足时 **billing 按普通冻结处理**（契约规定；返回 `bad_request` 是网关的职责）。每次动用写审计 `safety_overdraft.used`（用户 ID、冻结 ID、金额）。平台每日上限不为透支让路。

**后台每日上限**：用户账户行加锁后检查「当天（用户时区）后台已结算 + 当前后台冻结 + 本次」≤ 上限；`BACKGROUND_PURPOSES` 总计入，`BUDGET_EXEMPT_PURPOSES` 永不计入，其他用途看 `countAsBackground`。平台账户不受后台上限约束。

**平台每日上限**：冻结事务里一条带条件的 `UPDATE ... WHERE settled + reserved + 本次 <= cap`，更新到 0 行即 `budget_exceeded`（此时还没写冻结，不留半个冻结）。当天第一次冻结时建行，`cap_micros` 取当时的配置。达到 80% 写审计 `platform_budget.alert` + 错误日志（管理员通知渠道尚未实现）。

## 6. 余额事件（billing.md 6.3 第 3 条）

只在**改余额**时（结算、加扣余额、注册赠送）判断，冻结 / 解冻 / 过期不发：

| 事件 | 条件 |
|---|---|
| `billing.balance_changed` | 用户钱包每次余额变化 |
| `billing.balance_depleted` | 余额减少，且「之前」可用余额 > 0、之后 ≤ 0。「之前」不算本次结算释放的冻结（冻结正好用光余额、结算后变负也算耗尽） |
| `billing.balance_low` | 余额减少后可用余额低于提醒线，同一账户同一当地日期最多一次 |
| `billing.balance_restored` | 余额增加后：可用余额从 ≤ 0 到 > 0（`crossed_zero`），或 `insufficient_since` 不为空且之后 > 0（`topped_up_after_rejection`）；发出后清空 `insufficient_since` |

冻结因余额不足被拒时在同一事务记下 `insufficient_since`（已有则不变）；`getSpendStatus.insufficient` = 可用余额 ≤ 0 或 `insufficient_since` 不为空。

## 7. 注册赠送、对账、删除清单、定时任务

- **注册赠送**（billing.md 8.3）：订阅者 `billing.on_user_registered` 先查 `IdentityAccountStatusPort`，不是 `active` 就跳过；建钱包（已有跳过）；有 `signupBonus` 时同一事务写 `admin_grant`，原因「注册赠送」，操作人 = `grantedByUserId`（可空），幂等键 `signup_bonus:{userId}`。
- **对账**（`billing.reconcile`，每天 3:30 北京时间对前一天）：① 每个账户流水合计 = 余额、冻结合计 = `held_micros`、超过 1 小时的 active 冻结、余额低于 −(透支上限 + 1 元) 的用户钱包；② 待 model-access（见第 8 节）；③ 近 35 天内结束的上游账单与同期 `cost_micros` 汇总比较，偏差 > `BILLING_UPSTREAM_DIFF_RATIO`（默认 3%）标红。异常写审计 `reconciliation.flagged` + 错误日志，明细存 `reconciliation_runs.details`，**不自动修复**。
- **删除清单**：`purgeUser` 调数据库函数删除钱包、流水、冻结、每日汇总，审计 `wallet.purged` 只记用户 ID 哈希、删除时余额（负数 = 平台承担的透支，TD-024）和删除行数。
- **定时任务**：内核新增 `JobQueue.schedule(name, cron, { tz })`（kernel.md 第 8 节），只在消费任务的进程生效。

## 8. 已知限制（交接说明里有对应的申请）

1. `AdminAccountSummary.username` 返回空字符串：identity 端口没有「按用户 ID 取用户名」的方法。
2. 对账第 ② 层（用量记录 ↔ 扣费）和金额快照修复：`ReconciliationService.chargesByUsage(ids)` 已实现，但还没挂到契约 `BillingReadPort`。
3. 上游 ID：流水有 `upstream_id` 列，`settle` / `release` 已接受扩展字段 `upstreamId`，但契约 `SettleInput` / `ReleaseInput` 还没有该字段，网关目前传不了 → 第 ③ 层对账和「各上游近 30 天成本」在申请批准前没有数据。
4. 「目录中启用的模型缺少价格时 422」：需要模型目录，billing 不能调用 model-access，未实现（建议 model-access 发布前检查，或管理后台提示）。
5. 价目表不支持预约将来生效。
6. 「通知管理员」（80% 预算、对账异常）目前只有审计 + 错误日志。

## 9. 测试

- 单元：`domain/rules.test.ts`（计价、分时价含跨午夜、缺价、用途分类、透支资格、时区日期）。
- 集成：`apps/server/test/billing.test.ts`（27 条）：价目表；钱包按需创建；多退少补、重复结算只扣一次、冻结幂等；失败解冻与平台吸收；过期清理与过期后结算；**并发**（同一用户 20 个同时冻结只成功 5 个；10 个用户 20 个同时冻结，平台上限只放行 6 个）；余额事件（topped_up_after_rejection、depleted、crossed_zero、low 每天一次）；安全透支清单（6.6 第 8 条全部 6 项）；后台上限；管理员加扣（原因必填、幂等、409、422、审计、403、404）；流水分页与用量汇总；流水只增不改；对账发现人为不一致、过期冻结、账单偏差、透支过深；注册赠送（A 部分）与 identity 补充（B 部分）。
