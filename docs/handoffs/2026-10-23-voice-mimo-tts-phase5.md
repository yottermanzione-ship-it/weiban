# 语音协议适配第一批：MiMo 原生语音合成（2026-10-23）

> 按总经理 2026-10-23 的决定：**旧凭据一个都不迁**，先只做语音协议与计费适配。本批只补协议层，没有连接任何真实供应商、没有真实音频验收、没有开通任何音色。

## 为什么需要这条

新平台原来只有 OpenAI 兼容的多媒体协议（`/audio/speech`、`/audio/transcriptions`、`/images/generations`）。旧项目核实过的 MiMo 语音合成并不走 `/audio/speech`，而是：

- `POST {baseUrl}/chat/completions`
- 同时带 `api-key: <key>` 和 `Authorization: Bearer <key>` 两个头
- 请求体是 `{ model, messages: [风格指令, 待朗读文本], audio: { format: 'wav', voice } }`
- 返回的音频在 `choices[0].message.audio.data`（也可能是顶层 `audio.data`），**base64 编码**，可能带 `duration_seconds`

不补这条，MiMo 的 TTS 模型在新平台会直接 404/协议不符。

## 本批实际改动

- 新增 MiMo 语音合成适配路径，按**模型名**分流（`mimo-*-tts`），OpenAI 兼容实现原样保留：识别、生图、搜索、决策四项仍走原适配器，没有被改动。
- 音频解码有上限（12 MB），响应过大、缺 `audio.data`、非 JSON 一律按 `provider_error` 处理，不把上游原文或密钥写进错误。
- WAV 容器解析是显式的：只接受 **24 kHz、单声道、16 位**；取样率不符**直接拒绝**，不做隐式重采样，避免把 48 kHz 当成 24 kHz 送去播放。
- **OGG 封装明确不支持**：`ogg_opus` 直接按 `bad_request` 拒绝，而不是拿 WAV 冒充 Opus。语音消息要用的 OGG 封装仍需真实编码器/实测。
- 流式合成对 MiMo 用「先取完整音频再按 4 KB 分块」的方式提供 PCM，并在 `abort` 后停止；这不是真正的低延迟流式，级联通话的时延指标仍需实测。
- 计费没有新增口径：合成仍按 `tts_10k_chars`（按字符）、识别按 `asr_minute`（按秒）结算，沿用现有冻结/结算与用量记录流程；本批不改价格、不改默认模型。

## 检查与边界

- server 类型检查通过；只跑本批 7 条合成测试，一次通过后停止：请求路径/双鉴权头/请求体形状、base64 解码与时长、24 kHz PCM 去容器、`ogg_opus` 拒绝且不发请求、48 kHz 拒绝、401→`invalid_key` 且错误里不含密钥、缺音频→`provider_error`、流式分块、非 MiMo 模型仍走 `/audio/speech`。
- 测试使用本地合成 HTTP 服务与合成密钥，**不是真实 MiMo 账号**；真实音色、真实时延、真实计费对账均未验证，也没有构建 APK。
- 未做：DashScope 原生 TTS/复刻协议、实时通话的厂商 WebSocket 协议、Omni 级联、OGG 封装、系统音色白名单；这些仍需真实凭据与实测，且克隆/真人声音在授权缺失前继续排除。

## 下一步

1. 有真实 Key 时，用最短文本做一次真实合成，核对返回格式、时长与 `tts_10k_chars` 用量是否对得上。
2. 需要语音消息（OGG/Opus）时，先确定封装方案再开放该格式，不用 WAV 冒充。
3. 之后再接 DashScope 原生语音与实时通话协议；计费口径先按已定的三个语音单位，不为未验证协议臆造价格。
