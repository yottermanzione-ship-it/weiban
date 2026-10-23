# V05：Qwen 文件 ASR 原生协议交接（2026-10-24）

## 交付与验证边界

- 目标分支 `codex/voice-v02-v06-20261024`，开工基线 `7734cdc5d9f2409e33ed3ba3718cf7200f4ecc6e`。
- 仅交付 `apps/server/src/modules/model-access/infra/native-asr.ts`、`native-asr.test.ts` 与本说明；`media-adapter.ts`、`media-gateway.ts`、`call-agent.ts` 由主代理集成，本子代理未修改。
- 子代理对新工作目录的实际写入被固定旧 workspace 沙箱拒绝；没有提权、没有绕过拒绝。按主代理要求将草稿放入允许的 TEMP，由主代理批准落盘。
- **没有运行测试、没有读/迁旧密钥、没有连接真实供应商、没有供应商账单/区域账号可用性验收。** 新增测试完全 mock fetch、只用合成密钥/音频容器，不等于真实识别或完整音频解码通过。

## 当前实现选择

只启用官方明确列出的、按输入音频秒计费的同步 Qwen3-ASR-Flash：

| 型号 | 本次处理 | 原因 |
|---|---|---|
| `qwen3-asr-flash` | 允许 | 官方列稳定版；本次索引标注当前等同 `2025-09-08` |
| `qwen3-asr-flash-2025-09-08` | 允许 | 明确快照，按音频秒计费 |
| `qwen3-asr-flash-2026-02-10` | 允许 | 官方列最新快照，按音频秒计费 |
| `qwen-audio-3.1-asr-flash` / `-message` / `-filetrans` | 调用前拒绝 | 官方列输入/输出 token 计费；当前 `asrSeconds` 无法表达，不能冒充按秒 |
| `qwen-audio-3.0-asr-flash` | 调用前拒绝 | 虽有官方按秒条目，当前新协议分支未完整核实，不能猜与 Qwen3 同构 |
| Qwen `filetrans` / `realtime` / `streaming` / 未知快照 | 调用前拒绝 | 异步任务、WS 或未核型号不在本次同步字节输入范围 |
| `mimo-v2.5-asr` 及 MiMo ASR 家族 | 拦截后调用前拒绝 | 官方已证实走 Chat Completions+音频，不是 multipart；完整请求/usage 未核全，不猜协议或价格 |

**这不是所有模型都不能按秒；是此次只启用经核的 Qwen3 同步协议。** 未来新型号不能仅改模型字符串绕过 allowlist。

## 原生报文与真实用量

`POST {baseUrl}/services/aigc/multimodal-generation/generation`，仅 `Authorization: Bearer ...` 携带密钥，JSON：

```json
{
  "model": "qwen3-asr-flash",
  "input": {
    "messages": [{ "role": "user", "content": [{ "audio": "data:audio/wav;base64,..." }] }]
  },
  "parameters": { "asr_options": { "enable_itn": false } }
}
```

- 只读取 `output.choices[0].message.content[0].text`，不接受 OpenAI 顶层 `choices` 或 `text` 作为隐式兼容回落。
- 可选返回 `asrSeconds`，仅来自 `usage.seconds`，必须是有限非负数且不超过该同步模型 300 秒上限；不会从字节数、转写字数或 token 估算。
- 缺少/非法/越界 seconds 时返回文字但不附秒数；本批网关沿现有机制用服务端可信 WAV 时长按粒度结算并标 `estimated`，不冒充供应商实际用量，也不自动免费。输入时长先过路由 maxSeconds；上报秒数如超过冻结上限交原有结算/越界机制处理，不截断真实用量掩盖费用。
- 原生供应商音频 token/text token 字段不被误当作现有 generic 价格单位；该模型官方成本按音频秒，输出不计费。没有写入或猜测售价、折扣、免费额度实际抵扣。

## 区域与安全限制

- 当前允许北京公共 `https://dashscope.aliyuncs.com/api/v1`、新加坡公共 `https://dashscope-intl.aliyuncs.com/api/v1`，以及官方北京 workspace 域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`。
- key/模型/区域须配套，代码允许 URL 不等于账号已经获准调用；未核的美国、其他 workspace 区域与自定义中转拒绝。主代理接线进一步收紧：Qwen/MiMo ASR 家族在非 dashscope 配置下也本地拒绝，不把“Chat Completions 兼容”错误等同于 multipart `/audio/transcriptions`；普通 Whisper/SiliconFlow 等非该家族保留既有兼容路径。
- HTTPS、默认端口、无用户名密码、无 query/hash，固定原生路径；`redirect: manual`，不跟随 3xx，不下载任何返回 URL。
- 输入只接收 bytes+mimeType，不接受音频 URL、旧文件路径、业务提示词或用户声称的 duration。白名单收窄为 WAV/MP3/Ogg/FLAC，并做对应容器签名最低检查；并非完整解码器，不声称已验证损坏文件、所有编码或所有采样率。
- 输入最多 7,000,000 原始字节，Base64 与 data URI 小于官方 10 MB 上限；响应最多 64 KiB；转写文字最多 4000 字符；全请求含读响应体 30 秒；每进程最多 2 个本适配并发，超额本地返回 `rate_limited+localRateLimit+zeroCost`。
- 官方 Qwen3 短文件最长 5 分钟。适配器不为压缩容器自行猜时长，**调用前 maxSeconds 授权和可信媒体时长检查仍由网关负责**；超长/坏编码的供应商拒绝不能写成零成本。
- 本地拒绝才可 `zeroCost: true`。POST 后错误/超时/取消一律不声明零成本，不返回供应商原文、错误正文、URL、密钥，不重试、不自动回落。
- 原始 PCM/L16（缺少采样率/声道元信息）、视频/模糊二进制 MIME 不启用；没有隐式重采样/转码，也没有克隆、Omni、WS 逻辑。

## 主代理实际接线

```ts
// 家族判别不是支持型号清单；nativeAsr 再核 kind/白名单/原生 Base URL。
// Chat-Completions 兼容不等于 multipart transcription 兼容。
return isNativeAsrModel(t.model) ? nativeAsr(t, input) : inner.transcribe(t, input);
```

- `MediaAdapter` 的转写成功值由主代理增加可选 `asrSeconds`；其余现有兼容/SiliconFlow 等返回值不变。
- 网关对未上报秒数的成功转写，用可信 WAV 时长按路由粒度计量并标 estimated，原生/既有兼容均不冒充供应商实报，也不改成免费；已发送后失败不凭缺 usage 谎报零成本。
- 建议汇总一次跑新 `native-asr.test.ts` 和主代理本轮直接相关检查；本子代理遵守要求没有自行执行测试，也没有提交。

## 官方 URL 与证据等级

**证据等级：官方域名搜索索引多查询交叉核对。** 本轮 `web_fetch` 对 `help.aliyun.com`、`www.alibabacloud.com`、`mimo.mi.com` 均被工具以域名解析为 non-public IP 拦截；未绕过策略，未拿到完整正文。不能把下述内容写成完整正文/控制台/真实付费验证通过。

1. [非实时语音识别](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide)：Qwen3-ASR-Flash 支持同步 DashScope 和 OpenAI-compatible 模式；列稳定版、2025-09-08、2026-02-10；原生 curl 路径为 `aigc/multimodal-generation/generation`；仅 Qwen3 支持其所示兼容模式，不能据此宣称所有 Qwen ASR 都兼容。
2. [Qwen-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)、[英文 API](https://help.aliyun.com/en/model-studio/qwen-asr-api-reference)：`asr_options`、音频 data URI、Base64 编码后 10 MB 限制，`usage.seconds` 是 Qwen3 音频时长，`audio_tokens/text_tokens` 与秒数不是同一单位。
3. [录音文件识别（Qwen）](https://help.aliyun.com/zh/model-studio/recording-file-recognition-qwen)：Qwen3-ASR-Flash 最长 5 分钟，示例原生 `output.choices[0].message.content[0].text`、`content[].audio`、`enable_itn:false`。
4. [ASR 选型与输入矩阵](https://help.aliyun.com/zh/model-studio/asr-model)：同步短文件与异步 filetrans/实时 streaming 不同；不能把 Filetrans 的 12 小时/2 GB 能力套到本适配。
5. [Qwen3-ASR-Flash 模型信息](https://help.aliyun.com/zh/model-studio/qwen3-asr-flash)：型号/快照与新加坡地域条目；[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url) 列北京/新加坡公共域名，原生 API 路径为 `/api/v1`。
6. [百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)：Qwen3-ASR-Flash 按输入音频秒计费、输出不收费；3.1 Flash/Filetrans 为 token 成本项，不能复用秒价。具体区域单价、免费额度到期、折扣与账单未验证，不硬编码。
7. [MiMo ASR 官方 API](https://mimo.mi.com/docs/zh-CN/api/audio/Speech-Recognition)、[英文 API](https://mimo.mi.com/docs/en-US/api/audio/Speech-Recognition)：明确型号 `mimo-v2.5-asr`、OpenAI API 兼容（非证明 multipart）、`api-key` 和 duration(seconds) 描述；本轮没有完整正文，故不凭旧实现猜测 `asr_options`/usage 的精确结构。
