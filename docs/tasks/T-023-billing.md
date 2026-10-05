# T-023 计费模块 billing（D-L0-16）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |
| 分支 | `T-023-billing` |

## 目标

实现平台中转计费：用户钱包、只增不改流水、冻结 / 结算 / 解冻、价目表、后台与平台每日上限、余额事件、安全透支，以及用户端与管理端接口。模型网关接入之前，这块必须先就绪。

## 输入文档（必读）

- `docs/architecture/dev-plan.md` D-L0-16 行
- `docs/architecture/billing.md` 全文，**重点：第 5.2、6.6（安全透支，上限 2 元）、7（平台每日上限原子预留，Q-007）、6.3/6.4（余额恢复事件，Q-008）节**
- `docs/decisions/ADR-0012-relay-billing-and-wallet.md`、`ADR-0016-v13-safety-overdraft-health-plaza.md`、`ADR-0015`（含文末补充要求）
- `packages/contracts/src/http/billing.ts`、`src/ports/billing.ts`、`src/events.ts`
- `docs/backend/kernel.md`、`docs/backend/identity.md`（删除清单的登记方式）
- `docs/architecture/engineering-standards.md` 第 3 节（R9：冻结 / 结算端口只能由 model-access 引用）
- `docs/handoffs/2026-10-05-architect-T-020.md`（给后端的部分）

## 工作内容

按 dev-plan D-L0-16 与 `billing.md` 实现。金额一律用整数（微元）。流水表在数据库层面撤销修改和删除权限。billing 的 `index.ts` 导出两个 Symbol 令牌。登记删除清单。

## 范围

- 可以改：`apps/server/`（新增 `src/modules/billing/` 及其迁移）、`docs/backend/`
- 不可以改：`packages/contracts/`（需要的契约变更写进交接说明；对账用的只读接口按 T-020 交接提出申请）、`docs/quality/`、`.github/`
- 不要执行 `pnpm db:down`：本机数据库由多个任务共用，由总负责人统一关闭
- 在任务分支上提交，不合并 main

## 验收标准

- [ ] `pnpm check` 带数据库全部通过，0 跳过；分支 CI success
- [ ] 冻结 → 结算多退少补；调用失败全额解冻；重复结算只扣一次（幂等）
- [ ] **并发测试**：多个请求同时冻结，余额不会被扣成超额负数；平台每日上限不会被同时突破（Q-007）
- [ ] 余额被拒后加余额，发出「余额恢复」事件（Q-008），且不要求余额从零回正
- [ ] 安全透支：只有安全关怀用途能透支，上限 2 元；超出上限时拒绝；下次加余额先抵扣（按 `billing.md` 6.6 第 8 条的测试清单）
- [ ] 流水只能追加：直接尝试 UPDATE / DELETE 会被数据库拒绝（有测试）
- [ ] 期初 + 收入 − 支出 = 期末，每日对账任务能发现人为制造的不一致（有测试）
- [ ] 管理员加 / 扣余额必须填原因，并写审计记录
- [ ] 提交格式 `T-023 类型: 说明`

## 交付物

- 分支 `T-023-billing`
- 交接说明：`docs/handoffs/2026-10-05-backend-lead-T-023.md`（提交在分支上）
