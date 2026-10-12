# T-053 L3 主动消息调度：频率上限、发送时段与用户设置

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09（产品负责人 2026-10-09 修订参数释义） |
| 状态 | 待开始 |

## 目标

实现主动消息调度器（D-L3-03）：基于推演引擎（T-051）产生的事件流，按 SIM-05 的规则把主动消息安排发出——P-03（每角色每天上限）、P-04（全部角色合计每天上限）、P-05/P-06（发送时段）、P-07（话题去重）、P-08（久未联系）、P-09（用户正在聊天时延后），并遵守用户的开关与频率档位。

## 背景

- T-051（推演引擎）在 `wb-t051`，**必须先读其交接说明**了解推演事件的数据结构。
- T-052（公开动态后端）提供 `ProactiveMessagePort` 查询当日已发条数与允许配额。
- PRD SIM-05～SIM-10 是频率控制与调度逻辑的主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/06-simulation-proactive.md`（SIM-05～SIM-10，含 P-03～P-09 主动消息规则；参数原文见 `docs/product/prd-v1.md` 5.1 节）
- `docs/product/prd-v1/04-chat.md` CHAT-13 第 2 条（频率三档）
- `docs/ai/runtime-overview.md`
- `docs/backend/billing.md`（主动消息计费，`countAsBackground`）
- `docs/handoffs/2026-10-09-ai-lead-T-051.md`（T-051 交接，推演事件结构）
- `docs/handoffs/2026-10-09-backend-lead-T-052.md`（T-052 交接，`ProactiveMessagePort`）
- `packages/contracts/src/`（现有契约）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts`（新建）及同目录相关文件、`packages/ai-evals/cases/l3.ts`（追加调度评测用例）。
- **不可以改**：`apps/server/src/modules/proactive/**`（只读端口，不改实现）、`docs/quality/**`。
- 所有主动消息必须经过 `ProactiveMessagePort` 配额检查，超配额的当天直接放弃，不排队到第二天（SIM-05 第 4 条）。
- 正在聊天时延后（P-09 原文）：「用户 5 分钟内在任一会话发过消息则延后；最长延后 60 分钟，超时放弃」。
- 注意：**P-18 与本卡无关**。P-18 是「你不在时」摘要的条件（「距上次进入该私聊 ≥ 12 小时且期间有日常事件；最多 5 条」），属于 T-054。

## 必须处理的设计问题

1. **频率上限**（参数原文）：P-03「每个角色每天主动消息上限：3 次（一次可含多条气泡）」；P-04「所有角色合计每天主动消息上限：8 次」。两者同时约束。**P-04 不是发送间隔**。
2. **未回复不再发**（SIM-05 第 6 条）：用户还没回复上一条主动消息时，同一角色不再发新的主动消息（节日纪念日祝福除外）。
3. **用户设置**：全局开关（ACC-03）、单角色开关（SIM-10）、单角色频率三档（CHAT-13 第 2 条：少 = 每天最多 1 次；适中 = P-03，默认；多 = P-03 再加 2 次）。任何一档都受 P-04 和全局开关约束。
4. **发送时段**：活跃时段按最近 14 天学习、至少 5 天有聊天记录才启用（P-06），数据不足时用 09:00–23:00 用户时区（P-05）；免打扰优先。

## 验收标准

- [ ] 调度器接收推演事件后按规则决定是否发送：任一角色每天不超过 3 次（P-03），所有角色合计每天不超过 8 次（P-04）
- [ ] 超日配额时直接放弃，不报错、不排到第二天
- [ ] 用户关闭主动消息（全局或单角色）时不发送；三档频率生效
- [ ] 用户 5 分钟内发过消息时其他角色的主动消息延后，最长 60 分钟，超时放弃（P-09，拨时钟可验证）
- [ ] 用户未回复上一条主动消息时同一角色不发第二条，节日纪念日除外（SIM-05 第 6 条）
- [ ] 主动消息走后台网关，`countAsBackground: true`，产生计费记录
- [ ] 每条主动消息记录理由（SIM-05 第 10 条）；`docs/ai/` 实现说明更新
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts`、`packages/ai-evals/cases/l3.ts`（追加）
- 交接说明：`docs/handoffs/2026-10-09-ai-lead-T-053.md`（含给 web-lead T-056/T-057 的接口说明）
- 分支：从 main 新建 `T-053-l3-proactive-scheduler`，worktree 放 `C:\wb-dev\wb-t053`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**

> 修订记录：2026-10-09 产品负责人更正——P-04 原卡误写为「间隔小时数」，PRD 原文为「所有角色合计每天主动消息上限 8 次」；原卡把 P-18 当作「延迟发送」，P-18 实为「你不在时」摘要条件，正在聊天延后应为 P-09；「未读优先级」「关闭/低/中/高」改为 PRD 原规则（SIM-05 第 6 条、CHAT-13 第 2 条）；输入文档路径改为 `06-simulation-proactive.md`。
