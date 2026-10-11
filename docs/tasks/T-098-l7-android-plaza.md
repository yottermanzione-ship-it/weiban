# T-098 L7 安卓：人设广场

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L7-06 |
| 迁移号 | 无 |

## 目标

安卓原生端实现 T-097 的全部用户端功能（人设广场浏览、发布、点赞评论、举报、复制与应用、新版本提示）；管理后台部分不涉及。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/tasks/T-097-l7-web-plaza-admin.md`（功能与 PRD 参数，两端一致，不重复）
- `docs/architecture/contracts-3.0-map.md`
- `docs/product/prd-v1/15-persona-plaza.md` PLZ-01～PLZ-07
- `docs/design/pages/persona-plaza.md`、`character-profile.md`；`docs/design/tokens-android.md`

## PRD 条目与参数（原文）

同 T-097 用户端部分。重点：P-35「200 字」评论上限；广场昵称最多 12 字；一句话介绍 30 字、发布说明 300 字、更新说明 100 字、举报说明 200 字；疑似私人信息「▢」遮盖与「这不是我的私人信息」；「基于身边真人」不可发布及原因文案；收到点赞评论只有红点、**不发推送**；没有私信、关注入口。

## 范围

- 可以改：`apps/android/feature/**`（新建 plaza feature）、`apps/android/core/data/**`。
- 不可以改：`apps/android/core/contracts-generated/**`、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 广场分页、作品页、作者页、搜索排序筛选。
2. 发布 / 新版本流程、「我发布的」。
3. 点赞评论、举报、复制与应用、来源标注、新版本提示。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

与 T-097 用户端各条相同，在安卓上逐条核对；另：广场相关事件不产生系统推送。

## 交付

分支 `T-098-l7-android-plaza`，worktree `C:\wb-dev\wb-t098`，交接 `docs/handoffs/2026-10-09-android-lead-T-098.md`。其余按 index 第 2 节。
