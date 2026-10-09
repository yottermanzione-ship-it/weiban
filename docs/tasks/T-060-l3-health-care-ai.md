# T-060 L3 AI 经期关怀：每日检查、提醒与私聊自然体现

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现经期关怀能力（D-L3-12）：每天检查已授权角色的摘要、经期前提醒与经期中关心（P-36），私聊中自然体现（每天最多主动提 1 次），发送时带「健康」标记，不写记忆、不进推演与群聊。

## 背景

- T-059（health 后端）实现了 `HealthReadPort`，本任务通过该端口读取授权与经期状态，**必须先读其交接说明**。
- T-053（主动消息调度）已实现主动消息的发送机制，经期关怀消息复用该机制发送，**但不计入 P-03/P-04 频率上限**（按 PLAY-01 规则）。
- 经期关怀只由**一个**授权角色发出，用户有多个授权角色时按熟悉度最高的来（T-050 提供熟悉度查询）。
- PRD `docs/product/prd-v1/07-health.md`（PLAY-01 第 6、7 条）是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/07-health.md`（PLAY-01 第 6、7 条，经期关怀规则）
- `docs/handoffs/2026-10-09-backend-lead-T-059.md`（T-059 交接，`HealthReadPort` 说明）
- `docs/handoffs/2026-10-09-ai-lead-T-053.md`（T-053 交接，主动消息发送机制）
- `docs/ai/runtime-overview.md`
- `packages/contracts/src/ports/health.ts`（`HealthReadPort` 定义）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/ai-runtime/application/health-care.ts`（新建）及同目录相关文件。
- **不可以改**：`apps/server/src/modules/health/**`（只通过端口调用）、`packages/contracts/**`（只读）、`docs/quality/**`。
- 经期关怀消息：
  - 发送时携带 `labels: ['health']`
  - 不写入角色记忆
  - 不进入推演事件流
  - 不在群聊中发送
  - 每天最多主动提 1 次（即使用户主动问也不超过每日关怀次数）

## 验收标准

- [ ] 每日定时任务检查授权用户，在经期前 N 天发送提醒（有拨时钟测试）
- [ ] 经期中每天发送关怀消息（有测试）
- [ ] 多角色授权时只有熟悉度最高的角色发送（有测试）
- [ ] 消息携带 `labels: ['health']`（有断言）
- [ ] 不写记忆、不进推演流、不在群聊触发（各有测试）
- [ ] 每天最多触发 1 次，重复检查不重复发送（有测试）
- [ ] 走后台网关（`countAsBackground: true`），产生计费记录
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/ai-runtime/application/health-care.ts`
- 交接说明：`docs/handoffs/2026-10-09-ai-lead-T-060.md`（含给 T-061 的接口说明）
- 分支：从 main 新建 `T-060-l3-health-care-ai`，worktree 放 `C:\wb-dev\wb-t060`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
