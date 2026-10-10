# 网页多媒体与语音通话（L5，T-073）

> 负责人：web-lead · 2026-10-10 · 对应设计 `docs/design/pages/media-l5.md`、`call.md`；接口以 `packages/contracts/src/http/{media,assets,calls}.ts` 为准。

## 1. iPhone 网页版能不能打语音电话（MED-06 第 8 条结论）

**结论：iOS 16.4 及以上、在 Safari 或「添加到主屏幕」的微伴里，前台可以打；更老的系统、微信等 App 内置浏览器不行，入口照常显示，点了弹「iPhone 网页版暂不支持语音通话」。来电不能响铃，只走推送替代。**

理由：

| 需要的能力 | iPhone 情况 |
|---|---|
| 麦克风（getUserMedia） | Safari 14.3 起支持；主屏幕模式早期版本有缺陷，16.4 起稳定 |
| 实时播放 / 采集音频（Web Audio） | 支持；必须在用户点击时创建（代码已在点击同一调用栈里创建） |
| WebSocket 音频流 | 支持 |
| 锁屏 / 切到别的 App 后继续通话 | **不支持**：系统会暂停网页音频。短暂切走 10 秒内回来可自动重连（`CALL_LIMITS.reconnectGraceSec`），超过则通话结束，通话记录照常写 |
| 来电响铃 | **不支持**：网页无法在后台响铃。服务器发推送「XX 想和你通话」（MED-07 第 6 条），点开后若仍在响铃且能通话就进来电页，否则进私聊看「XX 给你打过电话」，点该记录可回拨 |

判断写在 `apps/web/src/features/call.tsx` 的 `callSupport()`：iPhone / iPad 读系统版本，低于 16.4 或缺少接口 → `iphone`；其他浏览器缺接口 → `browser`（「当前浏览器暂不支持语音通话」）。

**待真机验证**：本机没有 iPhone，以上依据公开的浏览器支持情况，需在真机上确认声音回声、蓝牙耳机、静音键对网页音频的影响。

## 2. 音频流实现（ADR-0025 方案 B）

- 拨打 `POST /calls` → 用返回的 `stream.path` + `?token=` 连 WebSocket（同源 ws/wss），先发 `hello`，收到 `call.ready` 后开始上行。
- 上行：麦克风 → `ScriptProcessorNode`（2048 帧）→ 抽样到 16 kHz → PCM16 小端 → 二进制帧（约 40 ms 一帧）。没用 AudioWorklet：内容安全策略只允许同源脚本，`apps/web/src/**` 之外不加文件；ScriptProcessor 在主线程的开销很小，以后可迁移（技术债）。
- 下行：按 `call.ready.outputSampleRate` 把 PCM16 转成 AudioBuffer 顺序排队播放。
- 打断：角色说话（`call.agent_speaking`）期间，连续约 120 ms 音量明显 → 发 `barge_in` 并清空本地待播音频。
- 静音：停止上行并发 `mute`。网页没有听筒 / 扬声器切换（设计稿平台差异表），所以通话中第三个按钮改为「聊天」（缩小到胶囊并进私聊）。
- 断线：自动用 `POST /calls/{id}/stream-ticket` 重连，10 秒内恢复不了就挂断并显示「网络中断，通话已结束」。
- 刷新页面后：`GET /calls/active` 发现进行中的通话 → 显示胶囊；浏览器要求手势才能出声，所以点胶囊后「继续」才重新接上。
- 多设备：`call.updated` 里别的设备接听 → 本机来电页消失；结束 → 退出通话页。
- 界面上没有任何费用、余额数字。余额不足只在拨打前弹「余额不足，暂时无法通话」。

## 3. 其他多媒体要点

- 图片：选完立即发，长边 > 2048 先压成 JPEG；上传进度用 XMLHttpRequest（`data/upload.ts`），失败可重发 / 删除；接收按宽高占位、原生懒加载、淡入。
- 语音：`MediaRecorder`（Chrome 为 webm/opus，Safari 为 mp4/aac，都在 `MEDIA_LIMITS.voiceMimeTypes` 内）；上传带 `durationMs` 表单字段；同时只播一条，播完自动连播紧接着的角色未播放语音；未播放红点记在本机。
- 转文字：角色语音直接显示 `transcript`；用户语音调 `GET /media/{id}/transcript`，随 `media.transcript_ready` 更新；识别服务没开通时本会话提示一次「当前无法识别语音」。
- 链接：角色发的 `link` 显示卡片，新标签页打开；用户在文字里发链接自动变可点。
- 表情：面板「我的表情」+ 用户可见的内置包；长按（•••）「添加到表情」处理 409 / 422；「我 › 表情」页可从相册添加、移到最前、删除。

## 4. 性能检查（本次交付）

| 项 | 结果 |
|---|---|
| 聊天列表虚拟滚动 | 沿用 `VirtualList`，新消息类型都在虚拟列表内渲染，图片按接口宽高先占位，不引起行高跳动 |
| 动画 | 声波（opacity）、来电光圈（transform + opacity）、图片淡入（opacity）、通话页淡出（opacity）；`prefers-reduced-motion` 时关闭 |
| 强制重排 | 没有在循环里读布局；音频处理不碰 DOM |
| 大图 | 聊天里用缩略图（`thumbnailUrl`），点开才加载原图；`loading="lazy"` |
| 构建体积 | 主包 841 KB（gzip 242 KB），CSS 60 KB（gzip 9.5 KB）；超过 500 KB 提示已存在，建议后续按页面拆包（技术债） |
| 帧率 / 首屏实测 | **本轮按总经理要求未在浏览器实测**，留给整体验收 |
