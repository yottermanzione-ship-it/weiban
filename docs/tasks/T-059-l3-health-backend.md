# T-059 L3 health 后端模块：经期记录、预测、授权与消息健康标记

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现 `health` 模块（D-L3-11）：经期记录增删改、预测算法、授权角色管理、整行 DEK 加密存储、`HealthReadPort` 实现，以及 chat 消息 `labels` 字段的存储与下发。

## 背景

- T-058（health 契约，architect）是本任务的前置依赖，**必须先读其交接说明**再开工。
- 经期数据整行用用户 DEK 加密——不能明文存入数据库，`security-and-privacy.md` 5.1 节有详细要求。
- `HealthReadPort` 只允许 `ai-runtime` 模块 import，本任务还须通知运维在 `architecture.js` 中登记边界规则。
- PRD `docs/product/prd-v1/07-health.md`（PLAY-01）是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/07-health.md`（PLAY-01 全文）
- `docs/architecture/security-and-privacy.md`（5.1 节，DEK 加密）
- `docs/handoffs/2026-10-09-architect-T-058.md`（T-058 交接，接口定义）
- `packages/contracts/src/http/health.ts`、`packages/contracts/src/ports/health.ts`（T-058 定义）
- `docs/backend/billing.md`（push 对健康标记的特殊处理）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/health/**`（新建）、新增迁移 `apps/server/drizzle/0020_*`（**编号 0020 预留**）、`apps/server/src/modules/chat/`（追加 `labels` 存储与下发逻辑）、`apps/server/src/modules/push/`（追加健康标记不显示内容逻辑）。
- **不可以改**：`apps/server/src/modules/ai-runtime/**`（只通过端口调用）、`packages/contracts/**`（只读）、`docs/quality/**`。

## 验收标准

- [ ] 经期记录 CRUD 均正常，数据整行 DEK 加密存入数据库（有测试验证密文）
- [ ] 预测接口返回下次经期日期（算法按 PLAY-01 P-37）
- [ ] 授权角色管理：查询与更新均正常
- [ ] `HealthReadPort` 实现并注册，ai-runtime 可通过端口读取
- [ ] chat 的 `labels` 字段正确存储与下发（仅服务端可设置，客户端发送被忽略）
- [ ] push 对含 `labels: ['health']` 的消息不显示内容（有测试）
- [ ] 注销/角色删除时订阅删除清单并清除健康数据（有测试）
- [ ] 迁移 0020 有 up 与 down
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/health/**`、`apps/server/drizzle/0020_*`
- 交接说明：`docs/handoffs/2026-10-09-backend-lead-T-059.md`（含给 T-060 的端口使用说明）
- 分支：从 main 新建 `T-059-l3-health-backend`，worktree 放 `C:\wb-dev\wb-t059`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
