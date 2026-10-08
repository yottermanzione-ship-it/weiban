# T-049 L2 管理后台：用量与费用、情景模式预设、人设版本发布回滚、对账与平台花费

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（服务端）+ web-lead（后台页面） |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-08 |
| 状态 | 待开始 |

## 目标

补齐 L2 管理后台缺口（D-L2-07 与 D-L2-11）：**用量与费用页（ADM-08）**、情景模式与预设提示词管理、排行榜数据配置、人设版本发布与回滚（发布前跑人设稳定检查）、对账结果与上游账单录入、平台花费页、默认识图模型设置。

## 背景

- 管理后台已有：`accounts.tsx`、`alerts.tsx`、`catalog.tsx`、`characters.tsx`、`invites.tsx`、`login.tsx`、`prices.tsx`、`upstreams.tsx`。
- **契约已就绪、实现待补**：
  - `packages/contracts/src/http/model-access.ts` 第 428 / 436 / 448 行已定义 `ModelAccessAdminUsageEndpoints` 的三个接口：`/admin/model/usage/summary`、`/admin/model/usage/records`、`/admin/model/usage/export`。
  - `packages/contracts/src/http/billing.ts` 已有 `createUpstreamBill`（第 369 行「录入上游实际账单金额」）、`listReconciliation`（第 377 行「每日对账结果」）、`getPlatformSummary`（第 385 行「平台今日成本、每日上限、平台账户、各上游近 30 天成本」）。
  - `apps/server/src/modules/model-access/application/usage.ts` 已有 `AdminUsageService`，`http/model-access.controller.ts` 已挂路由——**请先核对实际完成度，只补缺口，不要重写已有部分**。
- **缺**：情景模式与预设提示词管理、排行榜数据、人设版本发布与回滚、管理后台的用量与费用**页面**（含 CSV 导出与导出审计）、平台花费页、默认识图模型设置（ADM-05 第 9 条）。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/13-admin.md`（ADM-01～ADM-08，本任务的主要需求来源）
- `docs/backend/billing.md` 第 3.2、8.2、10.1 节；`docs/architecture/billing.md` 第 3～7 节
- `docs/ai/eval-plan.md` 第 4 节（人设稳定检查方法与通过线）、第 5 节（排行榜「微伴自测分」）
- `docs/product/prd-v1/11-scenario-modes.md`（情景模式与预设提示词）
- `docs/backend/model-access.md`（模型目录、默认识图模型）
- `packages/contracts/src/http/model-access.ts`、`billing.ts`、`characters.ts`
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/model-access/**`、`apps/server/src/modules/billing/**`、`apps/server/src/modules/characters/**` 中**仅限管理后台版本发布与回滚的部分**、`apps/admin/**`、新增迁移 `apps/server/drizzle/0017_*`（**编号 0017 已为你保留**）。
- **不可以改**：`apps/server/src/modules/ai-runtime/**`（T-046）、`apps/server/src/modules/contacts/**`（T-047）、`apps/web/**`（T-048）、`docs/quality/**`（归 Codex）。
- **契约有冲突风险**：`packages/contracts/src/http/characters.ts` 同时被 T-047 修改。**本任务不改该契约文件**；如确需新增接口，先在交接说明里写契约变更申请，由总负责人在合并时统一处理。
- 迁移必须同时提供 `.up.sql` 与 `.down.sql`。

## 验收标准

逐条可检查，质量负责人照此验收：
- [ ] 管理后台「用量与费用」页：筛选、1～2 维汇总、趋势图、前 10 名、明细列表、CSV 导出，全部对接已定的三个接口（ADM-08）
- [ ] 导出走审计：导出行为写审计日志，记录操作者、筛选条件、行数与时间（测试）
- [ ] **ADM-08 口径核对**：用户扣费合计 = 余额明细扣费合计，用测试断言两个口径在夹具数据上相等
- [ ] 情景模式与预设提示词可在后台管理；修改预设提示词触发人设稳定检查要求
- [ ] 排行榜数据可配置（「微伴自测分」按 `eval-plan.md` 第 5 节）
- [ ] 人设版本发布与回滚：发布前必须通过人设稳定检查（`publishChecks`/`personaStabilityPassed` 为 false 时拒绝，返回 422），回滚可回到指定版本（测试覆盖拒绝与成功两条路径）
- [ ] 对账结果与上游账单录入页：能录入上游实际账单并展示每日对账结果（第 ③ 层对账）
- [ ] 平台花费页：今日成本、每日上限、平台账户、各上游近 30 天成本
- [ ] 默认识图模型可在后台设置（ADM-05 第 9 条）
- [ ] 迁移 0017 有 up 与 down，迁移与回滚都跑通
- [ ] 本机相关测试**跳过 0 条**
- [ ] 后台页面的真实浏览器测试通过
- [ ] 没有为让检查通过而放宽断言、跳过测试或改门禁

## 交付物

- 代码 / 文档路径：`apps/server/src/modules/model-access/**`、`billing/**`、`apps/admin/**`、`apps/server/drizzle/0017_*`、`docs/backend/billing.md`（更新）
- 交接说明：`docs/handoffs/2026-10-08-backend-lead-T-049.md`
- 分支：`T-049-l2-admin-usage`（已建好，worktree 在 `C:\wb-dev\wb-t049`）
