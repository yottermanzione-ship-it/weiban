# T-058 L3 经期日记契约：health 接口、HealthReadPort、消息健康标记

| 项 | 内容 |
|---|---|
| 负责人 | architect |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

定义经期日记相关契约（D-L3-10）：`health` 模块的 HTTP 接口、`HealthReadPort`（供 ai-runtime 读取授权与经期预测）、聊天消息的 `labels` 字段（「健康」标记）。这是 T-059（health 后端）和 T-060（AI 经期关怀）的前置输入。

## 背景

- 经期数据属于高度敏感隐私数据，整行用 DEK 加密（`docs/architecture/security-and-privacy.md` 5.1 节）。
- `HealthReadPort` 只允许 `ai-runtime` 模块 import，模块边界规则须在此契约任务中一并提出（由运维在 T-059 中登记到 `architecture.js`）。
- PRD `docs/product/prd-v1/07-health.md` 是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/07-health.md`（PLAY-01，经期日记全文）
- `docs/architecture/security-and-privacy.md`（5.1 节，DEK 加密）
- `packages/contracts/src/`（现有契约结构）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`packages/contracts/src/http/health.ts`（新建）、`packages/contracts/src/ports/health.ts`（新建，`HealthReadPort`）、`packages/contracts/src/index.ts`（导出）、`packages/contracts/src/version.ts`（升版本）、`packages/contracts/src/chat.ts`（追加 `labels` 字段到消息类型）。
- **不可以改**：`apps/**`、`docs/quality/**`。
- 改契约必须同步运行 Android Kotlin codegen：`node apps/android/tools/generate-contracts.mjs`。

## 必须定义的接口

1. `POST /me/health/cycles` — 记录经期开始日期
2. `PATCH /me/health/cycles/:id` — 更新/结束
3. `DELETE /me/health/cycles/:id`
4. `GET /me/health/cycles` — 查询历史
5. `GET /me/health/prediction` — 预测下次经期（含「仅供参考」标注）
6. `GET /me/health/authorization` — 查询授权的角色列表
7. `PUT /me/health/authorization` — 更新授权角色
8. `HealthReadPort`：`getAuthorizedCharacters(userId)`、`getCurrentCycleStatus(userId)`
9. 消息类型追加 `labels?: ('health' | string)[]` 字段（只有服务器端发送方可设置）

## 验收标准

- [ ] 所有接口有完整 TypeScript 类型定义，无 `any`
- [ ] `HealthReadPort` 端口定义清晰，注释说明仅供 ai-runtime import
- [ ] `labels` 字段加入消息类型，有 JSDoc 说明服务器端限制
- [ ] 契约升版本，Android codegen 同步，CI 中生成代码无差异检查通过
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`packages/contracts/src/http/health.ts`、`packages/contracts/src/ports/health.ts`、契约 index 与 version 更新
- 交接说明：`docs/handoffs/2026-10-09-architect-T-058.md`（含给 T-059/T-060 的端口说明）
- 分支：从 main 新建 `T-058-l3-health-contracts`，worktree 放 `C:\wb-dev\wb-t058`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
