# T-027 模型接入模块（后端部分，D-L0-08）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-06 |
| 状态 | 进行中 |
| 分支 | `T-027-model-access` |

## 目标

建立 `model-access` 模块的后端部分：上游登记、模型目录、用户模型选择、用量记录、模型状态。AI 部分（D-L0-09：适配器、统一生成接口、接入计费）在本任务之后由 AI 负责人完成。

## 输入文档（必读）

- `docs/architecture/dev-plan.md` D-L0-08 行
- `docs/architecture/billing.md` 第 3、9 节；`docs/decisions/ADR-0012`、`ADR-0007`（含修订：无审查模型闸门）
- `packages/contracts/src/http/model-access.ts`、`src/ports/model-gateway.ts`
- `docs/backend/kernel.md`、`docs/backend/billing.md`
- `docs/ai/model-catalog.md`（首批模型目录数据，作为种子数据参考）
- `docs/handoffs/2026-10-05-architect-T-020.md`（用量记录表要一次建好扣费金额副本等字段）

## 工作内容

按 dev-plan D-L0-08：
- 上游登记：平台密钥信封加密、掩码、连通测试、更换、删除、审计。**总经理暂不配置真实密钥**，连通测试用假上游验证
- 模型目录：模型键 → 上游、能力、默认标记、启用 / 停用
- 用户模型选择：全局与按角色，**无审查模型闸门**
- 用量记录表；模型状态接口与事件
- 登记删除清单

## 范围

- 可以改：`apps/server/`（新增 `src/modules/model-access/` 及迁移）、`docs/backend/`
- 不可以改：`packages/contracts/`（架构 T-026 正在改；需要的变更写进交接说明）、`docs/quality/`、`.github/`
- 不要执行 `pnpm db:down`
- 在任务分支上提交，不合并 main

## 验收标准

- [ ] 契约中 model-access 的后端接口全部实现，每个接口都有测试
- [ ] 平台密钥：数据库里只有加密后的值，接口只返回掩码，日志中搜不到（测试）
- [ ] 无审查模型闸门：没有成人资格的角色选不了无审查模型，接口绕不过去（测试）
- [ ] **节省额度**：交付前在本机只运行一次 `pnpm check`（带数据库）确认通过，推送后以 CI 为准，不反复运行
- [ ] 提交格式 `T-027 类型: 说明`

## 交付物

- 分支 `T-027-model-access`
- 交接说明：`docs/handoffs/2026-10-06-backend-lead-T-027.md`（提交在分支上）
