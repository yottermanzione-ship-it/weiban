# T-024 契约变更申请评审（来自 T-018）

| 项 | 内容 |
|---|---|
| 负责人 | architect |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |

## 目标

评审后端在 T-018 提出的契约变更申请，批准的直接改进契约。

## 输入文档

- `docs/handoffs/2026-10-05-backend-lead-T-018.md`（「给其他负责人的交接 → 架构」）
- `docs/backend/identity.md`
- `docs/architecture/security-and-privacy.md`（注销未完成账号的管理要求）、`billing.md`
- PRD `docs/product/prd-v1/13-admin.md`（ADM-01 第 6 条：注册赠送余额）
- `packages/contracts/`

## 工作内容

1. 邀请码接口 `createInvite` 的请求和返回加 `bonusMicros`（注册赠送余额）；设计由计费模块提供端口给 identity 调用
2. 新增管理接口：「注销未完成账号列表」和「重新触发删除」
3. 确认注销时密码错误的返回：后端用的是 403 `invalid_credentials`（避免客户端误以为登录失效），或改为新增错误码，二选一并写清楚
4. 契约升次版本，更新 README 变更记录；同步 `dev-plan.md` 中相关任务

## 范围

- 可以改：`packages/contracts/`、`docs/architecture/`、`docs/decisions/`
- 不可以改：`apps/server/`（后端 T-023 在独立工作副本里改）、`docs/quality/`；不执行 git 命令
- 改完在主目录运行 `pnpm check` 确认通过（集成测试需要数据库时，先 `pnpm db:up`；不要执行 `pnpm db:down`）

## 验收标准

- [ ] 4 项都有结论；契约改动有测试，`pnpm check` 通过

## 交付物

- 交接说明：`docs/handoffs/2026-10-05-architect-T-024.md`
