# T-100 L7 安卓：五个玩法页面

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L7-08（安卓） |
| 迁移号 | 无 |

## 目标

安卓原生端实现 T-099 的全部用户端功能：每日一问、心愿清单、慢信（信箱）、陪你专注、TA 的提醒，以及服务页宫格、私聊入口和聊天中的玩法卡片；管理后台题库不涉及。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/tasks/T-099-l7-web-plays.md`（功能与 PRD 参数，两端一致，不重复）
- `docs/architecture/contracts-3.0-map.md`
- `docs/product/prd-v1/16-interactive-play.md` PLAY-03～PLAY-07；`docs/product/prd-v1/14-services.md` SVC-01
- `docs/design/pages/play.md`、`me-and-services.md`；`docs/design/tokens-android.md`；`docs/android/notifications.md`

## PRD 条目与参数（原文）

同 T-099 用户端部分。重点：P-40「每天 1 题」、回答 200 字；P-41「每个角色的清单最多 50 项」；信件 2,000 字、送达前「信件在路上」、送达推送「XX 给你寄来了一封信」点击进入信件；P-43「单次 5–120 分钟」、无累计时长 / 排行 / 失败；P-44「每个用户最多 10 条提醒」、内容 20 字；「健康」类提醒推送不显示内容（沿用 L3 已有的「健康」标记通知处理）。

## 范围

- 可以改：`apps/android/feature/**`（新建 play 相关 feature）、`apps/android/core/data/**`。
- 不可以改：`apps/android/core/contracts-generated/**`、`packages/contracts/**`、`docs/quality/**`。

## 交付物

与 T-099 第 1～6 项相同（安卓实现）；信件送达通知点击跳转。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

与 T-099 用户端各条相同，在安卓上逐条核对；另：「健康」类提醒的通知不显示内容。

## 交付

分支 `T-100-l7-android-plays`，worktree `C:\wb-dev\wb-t100`，交接 `docs/handoffs/2026-10-09-android-lead-T-100.md`。其余按 index 第 2 节。
