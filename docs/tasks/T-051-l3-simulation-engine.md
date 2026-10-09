# T-051 L3 推演引擎：角色日常事件、心情与花费控制

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现推演引擎第一版（D-L3-01）：让每个角色有自己的「日常」——每天生成若干日常事件、维护心情状态、受后台每日上限与余额耗尽保护，为主动消息调度（T-052）和时间线（T-053）提供数据源。

## 背景

- L2 已完成记忆（T-046）、人设（T-043）、情景模式（T-049），推演引擎在此基础上运行。
- 推演引擎是 L3 后续所有主动能力的基础：主动消息（T-052）、公开动态（T-053）、时间线摘要（T-054）都依赖它产生的事件流。
- PRD SIM-01/SIM-02/SIM-12/SIM-13 是本任务的主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-01、SIM-02、SIM-12、SIM-13，含规模与花费控制）
- `docs/ai/runtime-overview.md`、`docs/ai/eval-plan.md` 第 4 节（推演评测）
- `docs/backend/billing.md`（后台每日上限、`countAsBackground`、`planning` 用途分组）
- `docs/backend/model-access.md`（后台网关用途）
- `packages/contracts/src/ports/model-gateway.ts`（生成接口）
- `packages/contracts/src/http/simulation.ts`（如已存在）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/ai-runtime/application/simulation.ts`（新建）及同目录相关文件、新增迁移 `apps/server/drizzle/0019_*`（**编号 0019 已为你保留**）、`packages/ai-evals/cases/l3.ts`（新增评测用例）、`docs/ai/` 中你负责的实现说明。
- **不可以改**：其他模块（只读通过端口调用）、`packages/contracts/**`（需改接口先在交接里写变更申请）、`docs/quality/**`。
- 推演必须走后台网关（用途 `behavior_planning`，`countAsBackground: true`），计入预算，不允许绕过计费。
- 后台每日上限耗尽时推演暂停，不抛错，下次余额恢复后自动继续。
- 长期不活跃（PRD SIM-13 定义）时推演暂停。

## 必须处理的设计问题

1. **规模控制**：每个角色每天推演的事件数量和调用次数必须有上限（按 SIM-12 规则），避免单个活跃角色耗尽全局预算。
2. **降级路径**：模型不可用或余额不足时，推演静默跳过当天，不影响聊天功能。
3. **隔离性**：推演生成的内容（心情、日常事件）不直接注入用户聊天的上下文，只作为主动消息的决策依据。

## 验收标准

逐条可检查，质量负责人照此验收：
- [ ] 推演任务每天为每个活跃角色生成日常事件（测试用拨时钟验证）
- [ ] 心情状态更新并可查询（有接口或内部状态）
- [ ] 推演调用走后台网关，产生用量记录与计费（测试断言）
- [ ] 后台每日上限耗尽时推演暂停，不影响聊天（有专门测试）
- [ ] 长期不活跃时推演暂停（有测试）
- [ ] 每角色每天事件数受 SIM-12 上限控制（有测试）
- [ ] 迁移 0019 有 up 与 down，迁移与回滚都跑通
- [ ] 本机相关测试**跳过 0 条**
- [ ] 新增评测用例覆盖 SIM-01/SIM-02；`docs/ai/` 实现说明更新
- [ ] 没有为让检查通过而放宽断言、跳过测试或改门禁

## 交付物

- 代码路径：`apps/server/src/modules/ai-runtime/application/simulation.ts`、`apps/server/drizzle/0019_*`、`packages/ai-evals/cases/l3.ts`
- 交接说明：`docs/handoffs/2026-10-09-ai-lead-T-051.md`（含给主动消息调度的接口说明）
- 分支：从 main 新建 `T-051-l3-simulation-engine`，worktree 放 `C:\wb-dev\wb-t051`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
