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
- T-053（主动消息调度）已实现主动消息的发送机制，经期关怀消息复用该机制发送，**并且计入 P-03（每角色每天 3 次）和 P-04（所有角色合计每天 8 次）**，遵守活跃时段、免打扰、主动消息开关；理由记为「经期日记」（PLAY-01 第 6 条原文：「都计入 P-03、P-04」）。
- 经期关怀只由**一个**授权角色发出：授权角色中熟悉度最高的，相同时取最近聊过的（T-050 提供熟悉度查询）。
- 次数（P-36 原文）：「每个经期周期最多 2 次（经期前提醒 1 次 + 经期中关心 1 次），所有授权角色合计，每次只由一个角色发出」。时点（P-37）：经期前提醒在预计开始日前 2 天；经期中关心只在用户当天记录痛感为「中」或「重」时发。
- PRD `docs/product/prd-v1/16-interactive-play.md`（PLAY-01 第 6、7 条）是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/16-interactive-play.md`（PLAY-01 第 6、7 条，经期关怀规则）
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
  - 私聊中自然体现：经期中、用户没提起时每天最多主动提起 1 次；用户自己提起不舒服时正常关心，不受此限（PLAY-01 第 6 条）

## 验收标准

- [ ] 每日定时任务检查授权用户，在预计开始日前 2 天发送经期前提醒（P-37，拨时钟可验证）
- [ ] 经期中仅在当天痛感记录为「中」「重」时发一次关心；每个周期主动关心合计不超过 2 次（P-36）
- [ ] 多角色授权时只由一个角色发送（熟悉度最高，相同取最近聊过）
- [ ] 关怀消息占用 P-03 / P-04 额度（构造当天额度已满时不发）
- [ ] 消息携带 `labels: ['health']`（有断言）
- [ ] 不写记忆、不进推演流、不在群聊触发（各有测试）
- [ ] 重复检查不重复发送；私聊中未被提起时每天最多主动提 1 次
- [ ] 走后台网关（`countAsBackground: true`），产生计费记录
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/ai-runtime/application/health-care.ts`
- 交接说明：`docs/handoffs/2026-10-09-ai-lead-T-060.md`（含给 T-061 的接口说明）
- 分支：从 main 新建 `T-060-l3-health-care-ai`，worktree 放 `C:\wb-dev\wb-t060`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**

> 修订记录：2026-10-09 产品负责人更正——原卡写「不计入 P-03/P-04」「经期中每天发送」，与 PLAY-01 第 6 条、P-36 不符；已按 PRD 原文改正；PRD 路径改为 `16-interactive-play.md`。
