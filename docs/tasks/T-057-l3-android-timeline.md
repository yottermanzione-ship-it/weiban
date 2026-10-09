# T-057 L3 安卓：时间线、「你不在时」卡片、熟悉度展示与主动消息设置

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现 L3 安卓原生端（D-L3-09）：与 T-056（网页端）功能对称——「你不在时」摘要卡片、时间线事件列表、聊天信息页熟悉度展示、主动消息频率设置。

## 背景

- T-056（网页端 L3）与本任务并行，先读其交接说明了解 UI 逻辑决策，保持两端一致。
- T-050（growth 模块）提供熟悉度与认识天数接口，T-054 提供时间线摘要接口。
- PRD SIM-10、SIM-11、GRW-03、GRW-04 是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-10、SIM-11）
- `docs/product/prd-v1/09-relationship-growth.md`（GRW-03、GRW-04）
- `docs/handoffs/2026-10-09-backend-lead-T-050.md`（T-050 交接，growth 接口）
- `docs/handoffs/2026-10-09-ai-lead-T-054.md`（T-054 交接，时间线接口）
- `docs/handoffs/2026-10-09-web-lead-T-056.md`（T-056 交接，两端对齐）
- `packages/contracts/src/http/growth.ts`、`packages/contracts/src/http/simulation.ts`
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/android/src/`（相关 Compose 组件与 ViewModel）。
- **不可以改**：`apps/server/**`、`packages/contracts/**`（只读）、`docs/quality/**`。

## 必须实现的界面（Jetpack Compose）

1. **「你不在时」卡片**：进入私聊 Screen 时，若摘要存在则显示可折叠卡片，关闭后持久记录已读状态（Room）。
2. **时间线列表**：聊天信息页新增「TA 的近况」LazyColumn 区域。
3. **熟悉度展示**：聊天信息页「和 TA 的相处」展示等级进度条与认识天数。
4. **主动消息设置**：聊天信息页频率选择器，调用对应接口保存，重建后保持。

## 验收标准

- [ ] 「你不在时」卡片折叠状态用 Room 持久化，重启 App 后不再重复显示
- [ ] 熟悉度等级进度条与认识天数正确展示（来自 T-050 接口）
- [ ] 主动消息频率设置持久保存
- [ ] 使用现有设计令牌，与网页端视觉一致
- [ ] Android CI 构建通过（ktlint、detekt、JUnit 零跳过）
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/android/src/`（L3 相关 Compose 组件）
- 交接说明：`docs/handoffs/2026-10-09-android-lead-T-057.md`
- 分支：从 main 新建 `T-057-l3-android-timeline`，worktree 放 `C:\wb-dev\wb-t057`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
