# T-068 L4 安卓：群聊、群设置、朋友圈、新的朋友与名片

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L4-09 |
| 迁移号 | 无（Room 本地库版本自行递增） |

## 目标

安卓原生端实现与 T-067 相同的用户端功能：群聊、群设置、朋友圈、新的朋友与名片、自定义角色之间设关系（不含管理后台）。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/tasks/T-067-l4-web-social.md`（功能清单与 PRD 参数，两端行为必须一致）
- `docs/architecture/contracts-3.0-map.md`
- `docs/product/prd-v1/07-social.md` SOC-03～SOC-09；`docs/product/prd-v1/03-characters.md` CHR-04、CHR-05
- `docs/design/pages/group-chat.md`、`moments.md`、`contacts-add.md`；`docs/design/tokens-android.md`
- `docs/android/chat.md`、`docs/android/foundation.md`、`docs/android/notifications.md`

## PRD 条目与参数（原文）

同 T-067「PRD 条目与参数」一节，不重复。重点：P-21「9 个角色 + 用户」；群聊不显示已读；朋友圈新动态不推送、入口红点；用户动态最多 9 张图。另：角色在朋友圈评论中 @ 用户会推送（SOC-08 第 4 条），通知点击进入对应动态。

## 范围

- 可以改：`apps/android/feature/**`（新建 group、moments 等 feature 模块）、`apps/android/core/data/**`（Room 表与同步）。
- 不可以改：`apps/android/core/contracts-generated/**`（由契约生成）、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 发起群聊、群聊页、群设置页、通讯录「群聊」入口；群消息接入现有同步引擎（seq、补拉、发件队列）。
2. 朋友圈三个入口、动态流、点赞评论、发动态（相册多选最多 9 张）、可见范围、红点。
3. 「新的朋友」、名片消息、「不感兴趣」、群成员点头像添加。
4. 朋友圈 @ 通知的点击跳转。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

与 T-067 验收标准中用户端各条相同，在安卓上逐条核对。

## 交付

分支 `T-068-l4-android-social`，worktree `C:\wb-dev\wb-t068`，交接 `docs/handoffs/2026-10-09-android-lead-T-068.md`。其余按 index 第 2 节。
