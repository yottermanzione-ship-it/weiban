# 交接说明：T-057 安卓时间线 / 你不在时 / 熟悉度 / 主动消息，T-061 经期日记安卓部分

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 日期 | 2026-10-09 ～ 2026-10-10 |
| 分支 | `T-057b-android-l3`（worktree `C:\wb-dev\wb2-android-l3`），已合 `local/trunk` 后并入主干 |
| 状态 | **未编译、未测试**（总经理要求：不用 GitHub、不跑 CI；本机不做安卓编译）。只做了人工语法自查；`pnpm android:generate:check` 通过（生成物与契约 3.0 一致） |

## 做了什么

- **「你不在时」卡片**：进入私聊时用本机记录的上次在该会话的时刻调 `timeline-summary`；只认服务器 `summary`，空/失败/2 秒超时都不显示；同一段缺席只自动展开一次（标记存在 Room），收起后留「TA 的近况」胶囊；返回键先收起；「问问 TA」预填输入框不自动发送；心情不显示。
- **TA 的近况（时间线）**：聊天信息页入口 → 独立页面，日常事件倒序、滚到底自动加载、失败可重试、到底显示「只保留最近 90 天」。
- **认识天数与熟悉度**：按总负责人裁定放在**角色资料页头部**「认识第 N 天 · L3 熟络 ›」（恋人显示「在一起第 N 天」），点开显示大号天数、熟悉度进度条（熟悉度令牌颜色）、距下一级点数、5 级说明、下一个纪念日；纪念日列表、新增（满 10 个禁用）、删除自定义纪念日（确认）。
- **主动消息设置**：聊天信息页「TA 主动找我」开关 + 少/适中/多三档（乐观更新、失败退回、提示「下一次主动消息开始生效」）、全局总开关关闭时禁用并提示；「TA 的日常」开关。服务页新增「主动消息与免打扰」：总开关 + 默认频率。
- **经期日记**（我 › 服务 › 互动玩法）：首次说明页（PLAY-01 原文，确认后记在本机）、状态卡（经期第 N 天 / 距下次预计 N 天 / 记录不足提示 + 服务器 `disclaimer` 常显）、月历（已记录粉色实心、预测粉色描边、有日记加点、今天加粗、未来不可点）、某天记录页（在经期中开关、流量/痛感单选、症状多选来自后台标签、备注 ≤200 字「只有你自己能看到」、删除这天的记录、未保存返回确认）、历史记录（周期长度、查看、删除整次经期）、让谁知道（打开先确认、关闭立即生效并提示）、周期设置（15–60 / 1–15）、一键清空。全部健康接口 `networkOnly`，不落本机缓存；409、204 已处理。
- 新增 `LocalFlagStore`（`SessionRepository.flags`）：按账号存在 Room `cache` 表的小标记。

## 改了哪些文件

- `apps/android/core/data/`：新增 `LocalFlagStore.kt`；改 `SessionRepository.kt`（加 `flags`）
- `apps/android/feature/chat/`：新增 `WhileAway.kt`、`CharacterTimeline.kt`、`Familiarity.kt`；改 `ChatScreen.kt`、`ChatInformation.kt`、`CharacterScreen.kt`
- `apps/android/feature/me/`：新增 `PeriodState.kt`、`PeriodDiary.kt`、`PeriodPages.kt`、`ProactiveDefaultsPage.kt`；改 `MeScreen.kt`、`NotificationSettingsPage.kt`
- `docs/android/l3-companion.md`（新增说明）、本交接

## 遗留问题

1. **未编译**：首次在有安卓环境的地方构建时可能有少量编译 / ktlint / detekt 问题（如 `ConversationView` 变长可能触发 LongMethod，`FlowRow` 需要的 OptIn 已加）。需安卓构建后修正。
2. 未写测试（按要求）。
3. 时间线用日常事件接口；契约 3.0 `listTimeline` 服务器未实现，实现后安卓需改接（网页有 404 自动退回，安卓未做）。
4. 时间线、事件类型的图标：安卓图标库里还没有 briefcase / moon 等 Phosphor 图标，暂用文字标签（工作 / 相处 / 休闲…）代替。
5. 资料页弹层用页内展开代替底部弹层；日历用箭头切月，未做左右滑动；历史记录用按钮删除，未做左滑。
6. 「你不在时」依赖本机记录的离开时刻：新装或换设备首次进入某会话不会出现卡片。
7. 设计与契约不一致处与网页同样按契约实现：一键清空会连授权一起删除（设计说授权保留）；纪念日没有「每年提醒」和编辑。
8. 主动来电开关按设计 L5 前不显示。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给项目总负责人：本批未编译，请在合并后安排一次安卓构建（CI 或有 SDK 的机器），我按报错修。
- 给 backend-lead / ai-lead：`TimelineEndpoints.listTimeline` 实现后通知安卓切换。
- 给 design-lead：事件类型图标需要加入 `apps/android/tools/generate-icons.mjs` 的图标清单后才能替换文字标签。
- 给 Codex（总经理转交）：重点看经期日记的日期边界（延长相邻经期、取消经期日、跨月）、健康数据不进本机缓存、首次说明只出现一次。
