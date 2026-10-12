# 安卓 L5：语音通话与全屏来电

> 负责人：android-lead · 2026-10-10 · 任务卡 T-075 · 设计 `docs/design/pages/call.md`、`media-l5.md` 第 7 节 · 协议见契约 `http/calls.ts`、ADR-0025。
> 状态：**未编译**（本机没有安卓 SDK），首次构建可能有少量报错需要修。唤起音乐 / 视频 App 已在 T-074 完成（`media-l5.md` 第 4 节）。

## 1. 结构

| 部分 | 位置 | 作用 |
|---|---|---|
| 通话引擎 | `feature/chat/.../CallController.kt` | 应用级单例（`WeibanApplication.calls`）：拨打 / 接听 / 拒接 / 挂断（HTTP），音频 WebSocket（`stream.path?token=`，先发 `hello`，收到 `call.ready` 开始双向音频），断线 10 秒内换凭证重连，`call.updated` 多设备同步，30 秒来电超时，前台时系统铃声 |
| 音频 | `feature/chat/.../CallAudio.kt` | 上行 PCM16 / 16 kHz / 单声道 40 ms 一帧（通话音源 + 回声消除 + 降噪）；下行按 `outputSampleRate` 播放；角色说话时检测到用户开口发 `barge_in` 并清掉待播音频；默认听筒，扬声器切换，贴耳熄屏；音频焦点被系统电话抢走时挂断 |
| 界面 | `feature/chat/.../CallScreen.kt` | 通话页（拨出中 / 来电中 / 通话中 / 结束 1 秒）、光圈、角色说话声波、静音 / 挂断 / 扬声器、缩小成顶部胶囊；麦克风权限门；入口可见性；开启来电时的通知与全屏通知权限 |
| 入口 | `ComposerPanels.kt`（「+」› 语音通话）、`CharacterScreen.kt`（资料页「语音通话」）、`MessageRow.kt`（点通话记录回拨） | 平台未开通（`availability.reason = service_disabled`）或查询失败时不显示 |
| 来电开关 | `ChatInformation.kt`「TA 给我打电话」、`feature/me/ProactiveDefaultsPage.kt`「角色给我打电话」；来电询问卡片点「可以」 | 打开时检查通知权限与全屏通知权限 |
| 系统层 | `platform/.../CallNotices.kt` | 来电通知（系统通话样式 + 全屏 Intent，30 秒自动消失，铃声持续）、未接来电通知（31 秒后核对 `missed`）、通话前台服务（类型 microphone，「与 XX 通话中」计时 +「挂断」）、通知栏「拒绝」「挂断」广播 |
| 推送 | `platform/.../NativePushRuntime.kt`、`NotificationPolicy.kt` | kind = call、deepLink `/calls/{id}`：核对仍在响铃才发来电通知 |
| 宿主 | `app/.../MainActivity.kt`、`WeibanApplication.kt` | 通话覆盖层盖在所有页面上；来电 Intent 先核对账号；来电时锁屏上显示并点亮屏幕，通话结束后恢复 |

## 2. 三种来电呈现（media-l5.md 7.2）

| 手机状态 | 实现 |
|---|---|
| 锁屏 / 熄屏 | 来电通知的全屏 Intent 打开 `MainActivity`（`setShowWhenLocked` + `setTurnScreenOn`），显示来电页；挂断后恢复，回到锁屏 |
| 用别的 App | 系统把全屏 Intent 降级为顶部横幅（通话样式，带「拒绝」「接听」），点横幅打开来电页 |
| 正在用微伴 | 同步通道收到 `call.updated`（ringing）直接推入来电页，撤掉系统通知，用系统铃声响铃 |

铃声：品牌铃声素材未到，暂用系统默认来电铃声（设计允许开发期占位）。

## 3. 权限

`platform` 清单：`USE_FULL_SCREEN_INTENT`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MICROPHONE`、`RECORD_AUDIO`、`WAKE_LOCK`。
拨打 / 接听前申请麦克风，拒绝弹「需要麦克风权限才能通话」+「去设置」（来电页拒绝麦克风 = 拒接）。
安卓 14 起全屏通知要单独授权：开启来电时提示「需要允许全屏通知…」+「去设置」「以后再说」；没授权时开关下方显示「未允许全屏通知，锁屏时只会收到通知」。

## 4. 已知限制 / 待配置后验证

- 国内厂商（小米、华为、OPPO、vivo 等）对全屏通知、锁屏显示、后台弹出界面有各自的开关，可能需要用户在系统设置里额外允许；推送通道目前只有 FCM，国内无 Google 服务的手机收不到来电推送（应用在前台时仍能通过同步通道来电）。**需真机逐个验证。**
- 进程被系统回收后，正在进行的通话无法续上音频：重新打开时直接挂断这通电话（私聊照常出现通话记录）。
- 打断用简单的音量阈值判断，嘈杂环境可能误打断；回声消除依赖机型。
- 通知栏「拒绝」若在进程刚被拉起时点按，依赖应用级协程完成请求；请求丢失时服务器 30 秒后按未接处理。
- 没有接入系统 `ConnectionService`（电话应用集成），系统电话打进来靠音频焦点判断挂断。
