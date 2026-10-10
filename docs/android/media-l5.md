# 安卓 L5：图片、语音、表情包、链接卡片、TA 的声音

> 负责人：android-lead · 2026-10-10 · 任务卡 T-074 · 设计 `docs/design/pages/media-l5.md` · 契约见 `docs/architecture/contracts-3.0-map.md` T-069 一栏。
> 状态：**未编译**（本机没有安卓 SDK），首次构建可能有少量报错需要修。

## 1. 代码在哪

| 功能 | 文件（`apps/android/feature/chat/.../chat/`） |
|---|---|
| 多媒体操作（发图 / 发语音 / 发表情、转文字、添加到表情、收藏、保存） | `ChatMediaUi.kt` |
| 消息样式（图片、表情、语音条、链接卡片、通话记录、文字里的链接、上传中气泡） | `ChatMediaViews.kt` |
| 图片压缩、内存缓存、保存到相册 | `ChatImages.kt` |
| 全屏查看（左右滑动、保存 / 收藏 / 添加到表情 / 删除） | `ImageViewer.kt` |
| 语音播放（同时一条、自动连播、未播放红点、听筒切换）、试听 | `VoicePlayback.kt` |
| 按住说话（上滑取消、太短、60 秒自动发、麦克风权限） | `VoiceRecorder.kt` |
| 表情面板、「+」面板（相册、拍摄） | `ComposerPanels.kt` |
| 「我 › 表情」 | `MyStickers.kt`（宿主 `MainActivity` 用 `mePage = "stickers"` 打开） |
| 「TA 的声音」 | `VoiceTone.kt`（聊天信息页「模型选择」下一行） |
| 链接唤起 App | `LinkLauncher.kt` |

数据层：`core/data/.../ChatMediaTransfer.kt`（带进度的上传、`durationMs` 表单字段、缩略图 / 语音下载）；`ChatRuntime.sendContent`（非文字消息进同一发送队列）；`core/network/ApiClient.download` 增加 `audio` 参数（原来只接受 `image/webp`）。

## 2. 主要规则（与网页 T-073 一致）

- 发图：系统照片选择器多选（≤9）或拍照；长边 > 2048 压成 JPEG（GIF 小图原样上传）；按选择顺序逐张上传，气泡先显示本地图并叠百分比；失败红色「!」→「重新发送 / 删除」；格式不支持 Toast「这张图片无法发送」。
- 收图：按宽高占位，缩略图淡入；失败「图片损坏 / 点击重试」；点开查看原图。
- 语音：AAC（MP4 容器）16 kHz 单声道；不到 1 秒「说话时间太短」；50 秒起倒计时；满 60 秒自动发。拒绝麦克风后再按弹「需要麦克风权限才能发语音」+「去设置」。
- 播放：点另一条前一条停；播完只连播紧挨着的角色未播放语音；离开聊天页、切到后台、收到 `call.updated` 都停；贴近耳朵切听筒并熄屏（`PROXIMITY_SCREEN_OFF_WAKE_LOCK`）。已播放记在本机 Room 标记。
- 转文字：角色语音直接显示原文；用户语音查 `GET /media/:id/transcript` 并随 `media.transcript_ready` 更新；本会话第一次遇到 `unavailable` 提示一次「当前无法识别语音」。
- 表情：面板「我的表情」+ 用户可见的内置包，点一下发出；添加到表情 409「已经添加过了」、422「表情已满，先在 我 › 表情 里删除一些」。
- 用户在文字里发的链接：识别成可点，点开走同样的唤起逻辑，不转卡片。
- TA 的声音：音色列表为空（平台未开通语音合成）时不显示入口；第一行「默认」= `voiceId: null`；点行即保存（失败退回）；试听用 `sampleMediaId` 下载播放。

## 3. 权限

`feature/chat/src/main/AndroidManifest.xml`：`RECORD_AUDIO`（录音）、`WAKE_LOCK`（贴耳熄屏）、`WRITE_EXTERNAL_STORAGE`（仅安卓 8～9 保存图片，`maxSdkVersion=28`）。安卓 10 起保存图片走系统媒体库，不要权限。拍照复用头像拍照的 FileProvider 目录 `avatar-camera/`。

## 4. 链接唤起 App 支持清单（MED-05 验收）

点击链接卡片时，按域名识别平台，用带包名的系统意图交给该 App；没装或该 App 不接这个链接时，用系统浏览器打开（不内置浏览器）。

| 平台 | 识别的域名（含子域名） | 安卓包名 |
|---|---|---|
| 网易云音乐 | music.163.com、163cn.tv | com.netease.cloudmusic |
| QQ 音乐 | y.qq.com | com.tencent.qqmusic |
| 酷狗音乐 | kugou.com | com.kugou.android |
| 酷我音乐 | kuwo.cn | cn.kuwo.player |
| 汽水音乐 | qishui.douyin.com | com.luna.music |
| 哔哩哔哩 | bilibili.com、b23.tv | tv.danmaku.bili |
| 抖音 | douyin.com、iesdouyin.com | com.ss.android.ugc.aweme |
| 快手 | kuaishou.com、gifshow.com | com.smile.gifmaker |
| 腾讯视频 | v.qq.com | com.tencent.qqlive |
| 爱奇艺 | iqiyi.com | com.qiyi.video |
| 优酷 | youku.com | com.youku.phone |
| 芒果 TV | mgtv.com | com.hunantv.imgo.activity |
| 小红书 | xiaohongshu.com、xhslink.com | com.xingin.xhs |
| 微博 | weibo.com、weibo.cn | com.sina.weibo |

能否直接跳到对应歌曲 / 视频，取决于该 App 是否声明接收这类 https 链接；不接时 App 会打开首页或退回浏览器。**需真机逐个验证**（待配置后验证）。

## 5. 已知限制

- 动图表情（动画 WebP）只显示第一帧（没有引入图片库；`BitmapFactory` 只解第一帧）。
- 「添加到表情」设计要求只对小于 1 MB 的图开放；消息里没有图片大小，交给服务器判断（同网页）。
- 默认音色不显示具体名字（契约没有给出预设角色的默认音色名，同网页）。
- 上传在聊天页的协程里进行，离开聊天页会中断（失败气泡也随之消失，消息不会发出）。
- 长按消息里的「保存图片」在安卓 8～9 上没有先申请权限（会提示保存失败）；全屏查看器里的「保存图片」会先申请。
