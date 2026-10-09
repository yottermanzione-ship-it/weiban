# ADR-0025 语音通话的传输与计费

| 项 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-10-09 |
| 提出人 | 架构负责人（T-062） |
| 批准人 | 架构负责人 |

## 背景

MED-06 要求实时双向语音、可打断；AI 方案选「级联」（语音识别 → 角色聊天模型 → 语音合成，`runtime-overview.md` 第 11 节）。需要定：客户端怎么把声音送到服务器、谁负责会话、怎么按分钟计费（D-L5-07「长通话分段冻结」）。

## 方案对比

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. WebRTC（需要媒体服务器 / TURN） | 抗弱网、回声消除成熟 | 要多部署一套媒体服务；级联方案本来就要在服务器解码，收益有限 |
| B. 每通电话一条专用 WebSocket：二进制帧传 PCM16 音频，文本帧传控制（打断、静音、状态） | 复用现有 WebSocket 基础设施，单机部署即可；安卓、网页都容易实现 | 弱网体验不如 WebRTC；带宽略大（16 kHz PCM 约 256 kbps） |

## 结论

选 B。

- 信令走 HTTP（`/api/v1/calls*`），状态经每用户更新 `call.updated` 同步各设备；音频走 `CallStreamTicket.path` 指向的 WebSocket，协议见 `http/calls.ts` 的 `CallStream*`：上行 PCM16LE 单声道 16 kHz，下行采样率由 `call.ready` 帧给出。
- 打断：客户端做语音活动检测，发 `barge_in`；服务器停止合成（只结算已合成的字数）。
- 会话归 `calls` 模块；角色一侧由 ai-runtime 实现 `CallAgentPort`（依赖反转）。
- 计费：语音识别用网关 `openRealtimeAsr`（按 `asr_minute` 每分钟冻结、结算，分段进行），角色回复照常 `generateText`（`chat_reply`），语音合成用 `streamSpeech`（按字数）。不新增价目单位。通话中余额不够约 1 分钟时 ai-runtime 让角色自然道别，`CallAgentSession` 发出 `end`。
- 时长上限、响铃超时、断线重连等待见 `CALL_LIMITS`（P-31）。

## 代价

- 弱网下可能卡顿；若实测体验不可接受，再评估 WebRTC（需新 ADR）。
- 带宽用 PCM，未压缩；后续可在协议中协商 Opus（次版本变更）。
