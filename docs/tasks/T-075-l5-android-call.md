# T-075 L5 安卓：语音通话、全屏来电

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L5-08 |
| 迁移号 | 无 |

## 目标

做完后：安卓上能给角色打实时语音电话（可打断、样式与微信语音一致）；角色来电时全屏响铃，锁屏也能弹出，可接听 / 拒绝。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/architecture/contracts-3.0-map.md`（通话信令与音频通道）
- `docs/tasks/T-070-l5-voice-call-backend.md`
- `docs/product/prd-v1/08-media-call.md` MED-06、MED-07；`docs/product/prd-v1/02-model-billing.md` MDL-10 第 5 条
- `docs/design/pages/call.md`；`docs/android/notifications.md`

## PRD 条目与参数（原文）

- MED-06 第 1 条：入口为私聊输入框「+」→ 语音通话、角色资料页「语音通话」；第 4 条：拨出后响铃 2–5 秒角色接听，接通后角色先开口；第 10 条：拨打前、通话中、设置页都不出现费用提示；第 11 条：平台未开通语音服务时入口不显示。
- 验收：「安卓上发起通话，5 秒内角色接通并先开口」。
- P-31：「60 分钟；到 55 分钟时角色自然提醒」。
- MDL-10 第 5 条：余额不足时不拨出并提示「余额不足，暂时无法通话」；通话中余额用完，挂断后私聊显示「余额不足，通话已结束」。
- MED-07 第 4 条：全屏来电（角色头像、名字、接听 / 拒绝，锁屏时也能弹出，样式与微信语音来电一致）；响铃 30 秒无人接听视为未接。

## 范围

- 可以改：`apps/android/feature/**`（新建 call feature）、`apps/android/platform/**`（前台服务、全屏通知、音频）、`apps/android/app/**`（Manifest 权限）。
- 不可以改：`apps/android/core/contracts-generated/**`、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 通话页：拨出、响铃、接通、静音、免提、挂断、通话中可打断（音频双向流）；前台服务保活通话。
2. 全屏来电：高优先级通知 + 全屏 Intent、锁屏弹出、30 秒超时、接听 / 拒绝回传服务器。
3. 权限申请与引导（麦克风、通知、全屏意图）；真机厂商差异列「待配置后验证」。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

- [ ] 发起通话 5 秒内角色接通并先开口；可打断；挂断后私聊出现通话记录。
- [ ] 全程无费用提示；余额不足时有对应系统提示。
- [ ] 锁屏状态下角色来电能全屏弹出；30 秒不接视为未接。

## 交付

分支 `T-075-l5-android-call`，worktree `C:\wb-dev\wb-t075`，交接 `docs/handoffs/2026-10-09-android-lead-T-075.md`。其余按 index 第 2 节。
