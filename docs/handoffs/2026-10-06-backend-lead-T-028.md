# 交接说明：T-028 计费与账号的契约 1.3 配套（进度说明：按总经理要求暂停）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-06 |
| 分支 | `T-028-billing-identity-c13`（起点 origin/main c1e4ec5） |
| 状态 | **进行中**：已完成计费查询端口与 model-access 装配，其余未开始 |

## 做了什么

- 读完输入文档：架构 T-026 交接、ADR-0017、`docs/architecture/billing.md` 8.2 / 8.4 节、后端 T-027 交接；契约 `ports/billing.ts`、`ports/identity.ts`、`events.ts`（`AdminAlertRaised`、`UsageReconciled`）、`http/push.ts`（`AdminAlertFacts`）、`http/billing.ts`（`ReconciliationRun`、`AdminAccountSummary`）。
- 读完现有实现：identity `SettingsService`、`identity.module.ts`、`tokens.ts`；billing `reconciliation.ts`、`platform-budget.ts`、`lifecycle.ts`、`admin.ts`、`reservations.ts`（settle / release）、`infra/db/schema.ts`；`model-access.module.ts`。
- 本地环境已就绪（`pnpm install`、`pnpm db:up`、`.env`）。未运行 `pnpm check`。

## 还剩什么

**已完成（第一小块，pnpm check 全部通过）**：billing 新增 `application/charge-query.ts`（`ChargeQueryService`，实现 `BillingChargeQueryPort` 三个方法）、令牌 `BILLING_CHARGE_QUERY_PORT` 已在 billing `index.ts` 导出；`model-access.module.ts` 的 `MODEL_ACCESS_CHARGE_QUERY` 已改为 `useExisting: BILLING_CHARGE_QUERY_PORT`；测试加在 `test/billing.test.ts` 每日对账用例里。下面第 2 条中的 `BillingChargeQueryPort` 和第 3 条已做完，其余仍待做。注意：`MODEL_PRICE_SOURCE`（档位用价格源）仍是 `EmptyPriceSource`，不在本任务范围；`ChargeQueryUnavailable` 类仍留在 defaults.ts。

接着做时按下面顺序：

1. **identity**（最小）：`tokens.ts` 加 `IDENTITY_DIRECTORY_PORT`；`SettingsService` 再 `implements IdentityDirectoryPort`：`getUsernames`（> 500 抛异常，`inArray(users.id, ids)`）、`listAdminUserIds`（`role = 'admin' and status = 'active'`）；`identity.module.ts` 绑定 `useExisting: SettingsService` 并导出；`index.ts` 导出令牌。
2. **billing**：
   - 新迁移 `0005_billing_c13.sql` + `.down.sql` + snapshot/journal：`reconciliation_runs` 加 `usage_reconciled_at timestamptz null`、`usage_amount_mismatch int not null default 0`、（建议）`usage_checked_at` 用于「以最新 checkedAt 为准」；`ledger_entries` 加 `usage_record_id` 普通索引（查扣费用）。**注意**：并行的 T-029 若也加迁移会撞 0005 编号，合并时按顺序重排。
   - `BillingChargeQueryPort`：可新建 `application/charge-query.ts` 或挂在 `ReconciliationService` 上——`getChargesByUsageRecordIds`（复用现 `chargesByUsage`，补 `chargedAt`，> 1000 抛异常）、`listChargesByDay`（北京日 `startOfLocalDay`，按 `(created_at, id)` 升序，游标 = base64 的「时间|ID」，limit 默认 500 最大 1000）、`listActivePricedModelKeys`（读 active 价目表的 distinct model_key，看 `prices.ts`）。`tokens.ts` 加 `BILLING_CHARGE_QUERY_PORT`，module 绑定并导出，`index.ts` 导出。
   - `settle` / `release` 已经把 `upstreamId` 写进流水（reservations.ts 第 284、352 行），只需补测试确认，并去掉 `UpstreamTag` 这个临时类型（契约已有该字段）。
   - `reconciliation.ts`：`run()` 现在是「删除再插入」，会覆盖第 ② 层字段——改为 upsert，只更新第 ①③ 层字段；`details.usageCheck` 去掉 `pending_model_access`；`toRun` 输出 `usageReconciledAt`、`usageAmountMismatch`。新增 `applyUsageReconciled(payload, tx)`：当天无记录先建一条只有第 ② 层的记录（第 ①③ 层字段填默认值），已有则在 `checkedAt` 更新时覆盖第 ② 层字段。`lifecycle.ts` 订阅 `model_access.usage_reconciled`。
   - 管理员提醒：`platform-budget.ts` 的 `alert()` 和 `reconciliation.ts` 的 flagged 分支，在同一事务 `outbox.publish(tx, 'platform.admin_alert_raised', 'billing', facts)`；合并键 `platform_budget_warning:{日}`、`reconciliation_flagged:{日}:{层}`（billing 发第 ①③ 层，可用 `ledger` / `upstream` 作为层名，与 model-access 的写法对一下）；载荷不含用户 ID / 用户名。先确认 outbox 发 `platform.*` 事件时 producer 传 `'billing'` 是否被平台事件校验接受。
   - `admin.ts listAccounts`：注入 `IDENTITY_DIRECTORY_PORT`，按 500 一批取用户名，取不到为空字符串，不存表。
3. **model-access**：`model-access.module.ts` 一行：`{ provide: MODEL_ACCESS_CHARGE_QUERY, useExisting: BILLING_CHARGE_QUERY_PORT }`（从 `../billing/index.js` 引入）；`ChargeQueryUnavailable` 留在 `defaults.ts` 不动（属于 T-029 可能修改的区域，只改装配）。
4. **测试**：identity 两个方法；billing 三个查询方法（含分页、跨日、上限）、upstreamId 落库、usage_reconciled 先到 / 后到 / 重跑不覆盖、80% 与对账异常发提醒（载荷无用户 ID）、账户列表带用户名；集成测试「发布价目表 → 启用模型成功」，以及未发布时 422；现有 model-access 测试里依赖「端口未接入 503」的用例需要改预期。
5. 文档：`docs/backend/billing.md`、`identity.md`、`model-access.md` 相应小节；最后完整跑一次 `pnpm check`，推送看 CI。

## 改了哪些文件

- 新增本进度说明（唯一改动）。

## 遗留问题

- 全部工作内容未实现，见上。
- 迁移编号可能与 T-029 冲突（见上）。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给项目总负责人：恢复时把本文件路径交给后端负责人，从「还剩什么」第 1 条开始。启用模型目前仍返回 503（端口未接入），T-029 联调前需要本任务完成。
