# T-053 L3 主动消息调度：频率控制、延迟发送与用户设置

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现主动消息调度器（D-L3-03）：基于推演引擎（T-051）产生的事件流，按 P-03/P-04 频率规则将主动消息安排发出，支持用户调节频率、延迟发送与未读优先级。

## 背景

- T-051（推演引擎）在 `wb-t051`，**必须先读其交接说明**了解推演事件的数据结构。
- T-052（公开动态后端）提供 `ProactiveMessagePort` 查询当日已发条数与允许配额。
- PRD SIM-03～SIM-06 是频率控制与调度逻辑的主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-03、SIM-04、SIM-05、SIM-06，含 P-03、P-04 频率规则）
- `docs/ai/runtime-overview.md`
- `docs/backend/billing.md`（主动消息计费，`countAsBackground`）
- `docs/handoffs/2026-10-09-ai-lead-T-051.md`（T-051 交接，推演事件结构）
- `docs/handoffs/2026-10-09-backend-lead-T-052.md`（T-052 交接，`ProactiveMessagePort`）
- `packages/contracts/src/`（现有契约）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts`（新建）及同目录相关文件、`packages/ai-evals/cases/l3.ts`（追加调度评测用例）。
- **不可以改**：`apps/server/src/modules/proactive/**`（只读端口，不改实现）、`docs/quality/**`。
- 所有主动消息必须经过 `ProactiveMessagePort` 配额检查，超配额的当天静默跳过。
- 延迟发送：推演产生事件后，随机偏移 0～N 分钟再实际发送（PRD P-18）。

## 必须处理的设计问题

1. **频率上限**：P-03（每日最多条数）与 P-04（间隔小时数）两个维度同时约束。
2. **未读优先级**：用户未读消息 > N 条时，不再新增主动消息，等用户回复后恢复。
3. **用户设置**：用户可设置「主动消息频率」（关闭 / 低 / 中 / 高），调度器必须读取并遵守。

## 验收标准

- [ ] 调度器接收推演事件后，按频率规则决定是否发送（有单元测试覆盖 P-03/P-04）
- [ ] 超日配额时静默跳过，不报错
- [ ] 用户关闭主动消息时不发送（有测试）
- [ ] 延迟发送逻辑实现（拨时钟可验证）
- [ ] 未读消息过多时暂停（有测试）
- [ ] 主动消息走后台网关，`countAsBackground: true`，产生计费记录
- [ ] 新增评测用例覆盖 SIM-03/SIM-04；`docs/ai/` 实现说明更新
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts`、`packages/ai-evals/cases/l3.ts`（追加）
- 交接说明：`docs/handoffs/2026-10-09-ai-lead-T-053.md`（含给 web-lead T-056/T-057 的接口说明）
- 分支：从 main 新建 `T-053-l3-proactive-scheduler`，worktree 放 `C:\wb-dev\wb-t053`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
