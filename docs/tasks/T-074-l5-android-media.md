# T-074 L5 安卓：图片、语音、表情、链接卡片消息界面

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L5-12、D-L5-02/03/06（安卓） |
| 迁移号 | 无（Room 版本自行递增） |

## 目标

安卓原生端实现 T-073 中的消息类功能：图片、语音（按住说话、转文字、连播）、表情包（内置 + 自定义、「我 → 表情」）、链接卡片（唤起音乐 / 视频 App）。通话与来电在 T-075。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/tasks/T-073-l5-web-media-call.md`（功能与参数，两端一致）
- `docs/architecture/contracts-3.0-map.md`
- `docs/product/prd-v1/08-media-call.md` MED-01、MED-03、MED-05
- `docs/design/pages/private-chat.md`、`me-and-services.md`；`docs/design/tokens-android.md`
- `docs/android/chat.md`、`docs/android/foundation.md`

## PRD 条目与参数（原文）

- MED-03 第 3、4、5 条（同 T-073）。录音需麦克风权限，拒绝时给出说明。
- MED-05 第 1 条：识别音乐 / 视频平台链接时尝试唤起对应 App，否则浏览器打开。验收要求「安卓上点击音乐平台链接能唤起已安装的对应 App（Android 负责人记录支持的平台）」——支持清单写进 `docs/android/` 和交接说明。
- MED-02 第 8 条：长按保存图片到相册（系统接口）、收藏。

## 范围

- 可以改：`apps/android/feature/**`、`apps/android/core/data/**`、`apps/android/core/designsystem/**`（新增消息组件）。
- 不可以改：`apps/android/core/contracts-generated/**`、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 图片消息（发送：相册 / 拍照，压缩上传；接收：缩略图、大图、保存、收藏）。
2. 语音消息（按住说话、上滑取消、播放、转文字、连播）。
3. 表情包面板、「添加到表情」、「我 → 表情」管理页。
4. 链接卡片与唤起 App；支持平台清单。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

- [ ] 与 T-073 消息类各条相同，在安卓上逐条核对。
- [ ] 点击音乐平台链接能唤起已安装的对应 App。

## 交付

分支 `T-074-l5-android-media`，worktree `C:\wb-dev\wb-t074`，交接 `docs/handoffs/2026-10-09-android-lead-T-074.md`。其余按 index 第 2 节。
