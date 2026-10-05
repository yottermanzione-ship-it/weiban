# T-028 计费与账号的契约 1.3 配套

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-06 |
| 状态 | 进行中 |
| 分支 | `T-028-billing-identity-c13` |

## 目标

实现契约 1.3 中计费和账号两侧的新增内容，解除「没有计费查询端口就无法启用模型」的阻塞。

## 输入文档

- `docs/handoffs/2026-10-06-architect-T-026.md`（给后端：billing、identity 两部分）
- `docs/decisions/ADR-0017-billing-contract-requests-t026.md`、`docs/architecture/billing.md` 8.4 节
- `docs/handoffs/2026-10-06-backend-lead-T-027.md`（遗留问题第 1 条：接上端口只需改 `model-access.module.ts` 一行）
- `docs/backend/billing.md`、`identity.md`、`model-access.md`

## 工作内容

1. billing：实现 `BillingChargeQueryPort`；流水写入 `upstreamId`；订阅 `usage_reconciled` 并记入当日对账结果；平台花费达 80% 和对账异常时发出 `platform.admin_alert_raised`；管理端账户列表补上用户名
2. identity：实现 `IdentityDirectoryPort`（`getUsernames`、`listAdminUserIds`）
3. model-access：接上真实的 `BillingChargeQueryPort`，去掉测试替身，确认启用模型和每日对账正常工作

## 范围

- 可以改：`apps/server/` 中的 billing、identity，以及 model-access 的模块装配；`docs/backend/`
- 不可以改：`packages/contracts/`、`docs/quality/`、`.github/`
- 不要执行 `pnpm db:down`
- 并行任务 T-029（AI）在 model-access 模块内新增网关代码。你只改 model-access 的装配那一行，其余不动

## 验收标准

- [ ] 上述 3 项都有测试；「先发布价目表、再启用模型」能走通（集成测试）
- [ ] 节省额度：本机只完整跑一次 `pnpm check`，推送后以 CI 为准
- [ ] 提交格式 `T-028 类型: 说明`

## 交付物

- 分支 `T-028-billing-identity-c13`；交接说明 `docs/handoffs/2026-10-06-backend-lead-T-028.md`（提交在分支上）
