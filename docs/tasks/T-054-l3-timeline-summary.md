# T-054 L3 时间线与「你不在时」摘要

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现时间线摘要接口（D-L3-05）：当用户重新打开 App 时，生成「你不在的这段时间，TA 过了怎样的一天」摘要卡片，数据来自推演引擎（T-051）的事件流。

## 背景

- T-051（推演引擎）在 `wb-t051`，**必须先读其交接说明**了解推演事件数据结构。
- 时间线摘要是 L3 用户感知最强的功能之一：用户离线一段时间后重新进入聊天，会看到一张「你不在的时候」卡片。
- PRD SIM-11 是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-10、SIM-11，时间线与摘要逻辑）
- `docs/ai/runtime-overview.md`
- `docs/handoffs/2026-10-09-ai-lead-T-051.md`（T-051 交接，推演事件结构）
- `packages/contracts/src/`（现有契约，`simulation.ts` 如存在）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/ai-runtime/application/timeline.ts`（新建）及同目录相关文件、`packages/contracts/src/http/simulation.ts`（追加接口，或新建 `timeline.ts`）、`packages/contracts/src/index.ts`、`packages/contracts/src/version.ts`。
- **不可以改**：`apps/server/src/modules/proactive/**`、`docs/quality/**`。
- 摘要生成走后台网关（`behavior_planning`，`countAsBackground: true`），受每日上限控制。
- 用户离线时长 < 1 小时时不生成摘要（避免频繁调用）。

## 验收标准

- [ ] `GET /conversations/:id/timeline-summary` 接口返回「你不在时」摘要文本与推演事件列表
- [ ] 离线 < 1 小时时返回空（有测试）
- [ ] 摘要生成走后台网关，产生计费记录（有测试断言）
- [ ] 后台每日上限耗尽时返回空，不报错（有测试）
- [ ] 契约升版本，Android codegen 同步
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/ai-runtime/application/timeline.ts`、契约更新
- 交接说明：`docs/handoffs/2026-10-09-ai-lead-T-054.md`（含给 web-lead T-056 的接口说明）
- 分支：从 main 新建 `T-054-l3-timeline-summary`，worktree 放 `C:\wb-dev\wb-t054`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
