# T-026 契约变更申请评审（来自 T-023 计费）

| 项 | 内容 |
|---|---|
| 负责人 | architect |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-06 |
| 状态 | 已完成（总负责人复核） |

## 目标

评审后端在 T-023 提出的 6 条申请，批准的直接改进契约，为模型接入（D-L0-08 / D-L0-09）扫清接口障碍。

## 输入文档

- `docs/handoffs/2026-10-05-backend-lead-T-023.md`（「给架构」6 条）
- `docs/backend/billing.md`、`docs/architecture/billing.md`
- `packages/contracts/`

## 工作内容

1. identity 增加「按用户 ID 批量取用户名」
2. billing 只读端口增加「按用量记录 ID 查扣费」「按日期列出扣费」
3. 结算和解冻的输入增加可选的上游 ID
4. 确认两处偏差：流水禁止修改用触发器实现，而非撤销权限；价目表不支持预约生效
5. 确定「发布价目表时检查缺价」由谁做
6. 统一设计「通知管理员」事件
7. 契约升次版本，更新 README 变更记录与 `dev-plan.md`

## 范围

- 可以改：`packages/contracts/`、`docs/architecture/`、`docs/decisions/`；不改 `apps/`、`docs/quality/`；不执行 git 命令
- 节省额度：改完在主目录**只运行一次** `pnpm check`（需要数据库就先 `pnpm db:up`，不要 `pnpm db:down`）

## 交付物

- 交接说明：`docs/handoffs/2026-10-06-architect-T-026.md`
