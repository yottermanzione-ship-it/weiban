# T-085 L6 安卓：卡册、成就、收藏、聊天记录搜索、分享图

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L6-09（第一部分） |
| 迁移号 | 无（Room 版本自行递增） |

## 目标

安卓原生端实现 T-083 的全部功能：卡册、成就、收藏、搜索、分享图（4 套模板、微伴标识），分享图用系统接口保存到相册。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/tasks/T-083-l6-web-cards-share.md`（功能与 PRD 参数，两端一致，不重复）
- `docs/architecture/contracts-3.0-map.md`
- `docs/product/prd-v1/12-share-export.md` EXP-01、EXP-02；`docs/product/prd-v1/09-relationship-growth.md` GRW-05、GRW-06；`docs/product/prd-v1/04-chat.md` CHAT-11、CHAT-12
- `docs/design/pages/cards-familiarity.md`、`docs/design/share-templates.md`；`docs/design/tokens-android.md`

## PRD 条目与参数（原文）

同 T-083「PRD 条目与参数」。重点：P-24「30 条」；含真人内容的分享图文案「微伴AI聊天非本人，请谨慎识别」不可关闭；「聊天原样」固定微伴粉主题；成人模式 / 健康消息不可选并提示原因；EXP-01 验收要求「图片能保存到手机相册（安卓原生客户端、iPhone 网页版都要验证）」。

## 范围

- 可以改：`apps/android/feature/**`、`apps/android/core/data/**`、`apps/android/core/designsystem/**`。
- 不可以改：`apps/android/core/contracts-generated/**`、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 卡册、成就页、获得提示。
2. 收藏与「我的收藏」、会话内与全局搜索。
3. 分享图：四个入口、选项、4 套模板离屏渲染、微伴标识、MediaStore 保存相册、系统分享。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

与 T-083 各条相同，在安卓上逐条核对；另：分享图能保存到系统相册。

## 交付

分支 `T-085-l6-android-cards-share`，worktree `C:\wb-dev\wb-t085`，交接 `docs/handoffs/2026-10-09-android-lead-T-085.md`。其余按 index 第 2 节。
