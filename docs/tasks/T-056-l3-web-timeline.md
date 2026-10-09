# T-056 L3 网页：时间线、「你不在时」卡片、熟悉度展示与主动消息设置

| 项 | 内容 |
|---|---|
| 负责人 | web-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现 L3 网页用户端（D-L3-07）：聊天页进入时展示「你不在时」摘要卡片、时间线事件列表、在聊天信息页展示熟悉度等级与认识天数（来自 T-050），并提供主动消息频率设置入口。

## 背景

- T-050（growth 模块）在 `wb-t050`，提供熟悉度与认识天数接口。
- T-051/T-053（推演引擎与调度）提供主动消息，本任务只负责 UI 展示，不实现调度逻辑。
- T-054（时间线摘要）提供 `GET /conversations/:id/timeline-summary` 接口。
- PRD SIM-10、SIM-11、GRW-03、GRW-04 是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-10、SIM-11，卡片展示逻辑）
- `docs/product/prd-v1/09-relationship-growth.md`（GRW-03、GRW-04，熟悉度展示）
- `docs/handoffs/2026-10-09-backend-lead-T-050.md`（T-050 交接，growth 接口）
- `docs/handoffs/2026-10-09-ai-lead-T-054.md`（T-054 交接，时间线接口）
- `packages/contracts/src/http/growth.ts`（T-050 定义的契约）
- `packages/contracts/src/http/simulation.ts`（T-054 扩展的契约）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/web/src/`（相关页面与组件）。
- **不可以改**：`apps/server/**`、`packages/contracts/**`（只读，需改先提变更申请）、`docs/quality/**`。

## 必须实现的界面

1. **「你不在时」卡片**：进入私聊页时，若有未读摘要则在消息列表顶部展示一张可折叠卡片。
2. **时间线列表**：聊天信息页新增「TA 的近况」区域，展示最近 N 天的推演事件摘要。
3. **熟悉度展示**：聊天信息页「和 TA 的相处」区域展示熟悉度等级（进度条）和认识天数。
4. **主动消息设置**：聊天信息页提供频率选择器（关闭/低/中/高），调用 `PATCH /me/notification-settings` 或对应接口保存。

## 验收标准

- [ ] 有未读时间线摘要时，进入聊天显示「你不在时」卡片，关闭后不重复显示
- [ ] 聊天信息页正确展示熟悉度等级与认识天数（来自 T-050 接口）
- [ ] 主动消息频率设置可保存，刷新后保持
- [ ] 新增组件使用现有设计令牌，无硬编码颜色
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/web/src/`（L3 相关页面与组件）
- 交接说明：`docs/handoffs/2026-10-09-web-lead-T-056.md`
- 分支：从 main 新建 `T-056-l3-web-timeline`，worktree 放 `C:\wb-dev\wb-t056`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
