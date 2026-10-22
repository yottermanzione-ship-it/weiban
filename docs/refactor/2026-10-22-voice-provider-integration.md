# 旧版语音实况与新版供应商接入研究（2026-10-22）

> 本轮仅调研。旧服务器、数据库、源码、服务均未改动；未调用任何付费模型、未构建 APK、未部署、未提交。只新增本报告，不改既有方案或业务代码。

## 1. 先说结论

1. 用户记忆的 **3 个 ASR 完全对上**：小米 MiMo、硅基流动上的 SenseVoice、硅基流动上的 TeleSpeech；但旧库中小米 ASR 当前禁用，另外两个启用。旧版还有独立的千问流式 ASR 通话路径，不能把“语音消息端点有三个”等同于“全系统只有三个识别模型”。
2. 新版先接 **语音消息 ASR/TTS → 流式 ASR+角色 LLM+TTS 级联通话 → 千问真 realtime → Omni**。后三者是不同链路，不把“流式 ASR/TTS”宣传成“端到端语音模型”。
3. 官方已列出 `qwen-audio-3.1-asr-flash-streaming`、`qwen-audio-3.1-tts-flash`、`qwen-audio-3.1-realtime-plus`。**未核实到 `qwen-audio-3.1-tts-plus`，不得发明这个型号**；官方 TTS Plus 仍列 `qwen-audio-3.0-tts-plus`。
4. **最重要的新缺口是计费，不只是加模型名**：千问 3.1 ASR Streaming 和 3.1 TTS Flash 都按输入/输出 token 计费，不能继续用旧版按秒/按字的价格结算；真 realtime/Omni 还要分文字、音频等模态。新版媒体适配器目前不返回这些实际用量。
5. Omni 新实验应评估官方现行 `qwen3.8-omni-flash-realtime`，不能只照搬旧库已禁用的 3.5。官方指出 3.8 的语音输出及对应文字分别收费，而 3.5 语音输出对应文字不收费，版本间不能共用假定规则。
6. 旧方案的“只用系统音色、不迁移真人克隆”仍是当前产品边界。研究克隆不等于授权迁移旧明星音色；若要开放本人/授权原创角色克隆，需先走产品、合规和契约审批。

## 2. 证据范围与限制

### 2.1 已实读

- 文档：[文档地图](../README.md)、[既有通话方案](./04-voice-call-plan.md)、[旧版语音调研](./01-old-weiban-review.md#37-语音语音消息与实时通话)、[ADR-0025](../decisions/ADR-0025-voice-call-transport.md)、[calls 模块](../backend/calls.md)、[AI 通话管线](../ai/call-and-image.md)。旧文档中的未核实价格不是本报告的采购依据。
- 旧源码：本机 `C:/wb-ref/old-weiban` 参考副本，只读；关键文件见第 4 节。**本机源码证据不代表远端文件逐字一致**。
- 旧线上：`152.136.111.51`，SQLite `/opt/weiban-server/weiban.db`；使用本机既有身份、文档已知 `ubuntu` 用户和 `sqlite3 -readonly`。未读取私钥内容、环境变量、API key/token/密码。仅查询表结构、供应商名称/协议/模型/安全 URL、启用及排序元数据、绑定聚合；未 `SELECT *` 供应商表。
- 服务只执行 `systemctl is-active`：`weiban-voice-bridge`、`weiban-voice-agent`、`weiban-livekit` 均为 `active`。这不证明真实通话成功、费用正确或当前公网延迟达标。

### 2.2 官方网络核验的证据等级

本轮官方页面的 `web_fetch` 均因工具报告域名解析为 non-public IP 而失败，未绕过该边界。下列型号、协议、价格来自 **官方域名搜索索引摘要，多查询交叉核实**；并非完整正文、控制台报价或账单核验。正式开通前必须人工打开引用页，确认账号区域、模型版本、币种、计费粒度、免费额度到期与实际 usage 字段。未能核准的价格明确留空，不用猜测补齐。

## 3. 旧服务器配置实况

### 3.1 端点（数据库实查）

| 场景 | 端点名称 | 厂商协议 | 模型 | 启用 | 场景内顺序 |
|---|---|---|---|---|---:|
| ASR | 硅基流动 SenseVoice | siliconflow | `FunAudioLLM/SenseVoiceSmall` | 是 | 0 |
| ASR | 硅基流动 TeleSpeech | siliconflow | `TeleAI/TeleSpeechASR` | 是 | 1 |
| ASR | MiMo（小米） | mimo | `mimo-v2.5-asr` | 否 | 2 |
| TTS | MiMo（小米） | mimo | `mimo-v2.5-tts` | 是 | 0 |
| 克隆 | Qwen TTS Plus（复刻） | dashscope | `qwen-audio-3.0-tts-plus` | 是 | 0 |
| 克隆 | MiMo（小米） | mimo | `mimo-v2.5-tts-voiceclone` | 是 | 1 |
| 克隆 | 通义千问语音（百炼） | dashscope | `qwen-audio-3.0-tts-flash` | 否 | 2 |
| 真 realtime | 156语音 | dashscope | `qwen-audio-3.0-realtime-plus` | 是 | 0 |
| 真 realtime | Qwen Audio Realtime Plus (WebRTC/WS) | dashscope | `qwen-audio-3.0-realtime-plus` | 否 | 1 |
| 真 realtime | Qwen Omni Realtime Plus (legacy disabled) | dashscope | `qwen3.5-omni-plus-realtime` | 否 | 2 |
| 真 realtime | Qwen Realtime Flash（暂不启用） | dashscope | `qwen3-omni-flash-realtime` | 否 | 3 |

安全基础 URL：硅基流动 `https://api.siliconflow.cn/v1`；小米 `https://api.xiaomimimo.com/v1`；百炼公共地址 `https://dashscope.aliyuncs.com/api/v1`。两个 Audio Realtime Plus 端点使用百炼北京 workspace 专属 `*.cn-beijing.maas.aliyuncs.com` 地址；不复制租户 workspace 标识到报告。**“156语音”是后台自定义标签，不是厂商名，也不是模型名。**

`ai_scene_routes` 中名称含 voice/call 的路由查询无行；上表是端点启用/排序事实，不声称读取了全部运行时 env 回落配置。数据库没有在这些端点行定义单价，本轮未读通用配置值，避免误读混存秘密。

### 3.2 音色绑定聚合

| provider | model | status | 数量 |
|---|---|---|---:|
| qwen | `qwen-audio-3.0-tts-plus` | ready | 351 |
| qwen_audio_realtime | `qwen-audio-3.0-realtime-plus` | ready | 228 |
| qwen_realtime | `qwen3.5-omni-plus-realtime` | ready | 174 |

共 753 条，和旧文档历史数量吻合。`ready` 是旧库状态，不证明供应商音色现在有效、跨账号/跨区域/跨模型可用，也不证明素材权利已授权。未导出 voice_id、音频或角色个人数据。

### 3.3 用户简称与真实供应方

- **小米**＝小米 MiMo 开放平台，不是小爱同学设备接口；使用小米自己的 API 域名。
- **硅基流动**＝SiliconFlow 托管平台；`FunAudioLLM/SenseVoiceSmall` 与 `TeleAI/TeleSpeechASR` 是两个不同模型系列，不把模型作者与托管计费平台混为一谈。
- **千问 / 通义 / 百炼**：Qwen 是模型系列，阿里云百炼 Model Studio/DashScope 是本次服务与计费平台；不是腾讯、火山、或独立“156”厂商。
- **Omni**＝全模态能力系列；普通 Chat Completions/Responses 的音视频理解，不自动等于 realtime 双向通话。

## 4. 旧实现可复用的思路，及不可直接照搬部分

| 能力 | 旧源码实读 | 结论 |
|---|---|---|
| 文件 ASR | [voice_transcription.js](<C:/wb-ref/old-weiban/server/lib/voice_transcription.js>) | SiliconFlow 是 multipart `/audio/transcriptions`；MiMo 是 `/chat/completions` + `input_audio` + `asr_options`。同叫 OpenAI 兼容，不代表路径和请求体一致。 |
| MiMo TTS | [voice_synthesis.js](<C:/wb-ref/old-weiban/server/lib/voice_synthesis.js>) | `/chat/completions`，assistant 文本 + `audio.voice`，返回 JSON 内 base64 音频，不是新版 `/audio/speech` 原始音频。 |
| MiMo 克隆 | [mimo_voiceclone_adapter.js](<C:/wb-ref/old-weiban/server/lib/voice/mimo_voiceclone_adapter.js>) | 每次合成附参考音频 data URL；不是先创建持久 voice_id。应单独管理授权样本及其访问，不强套云端音色注册接口。 |
| Qwen TTS/克隆 | [qwen_tts_adapter.js](<C:/wb-ref/old-weiban/server/lib/voice/qwen_tts_adapter.js>) | 旧 Plus 使用独立 voice-enrollment、目标模型、返回音色标识；HTTP 合成结果再受控下载。模型与音色不可随意互换。 |
| 流式 ASR/TTS | [cascade_qwen_socket.js](<C:/wb-ref/old-weiban/server/lib/voice/cascade_qwen_socket.js>) | `/api-ws/v1/inference`，`run-task/continue-task/finish-task`，二进制音频；ASR 硬编码 3.0 Streaming，不能只在后台换端点就自动升级。 |
| 真 realtime/Omni | [qwen_realtime_gateway.js](<C:/wb-ref/old-weiban/server/lib/voice/qwen_realtime_gateway.js>) | `/api-ws/v1/realtime`，`session.update` 类会话事件；3.0 Audio 与 3.5 Omni 的音频参数结构已有差异，不能假设所有新版本事件完全相同。 |
| LiveKit 级联工人 | [agent.py](<C:/wb-ref/old-weiban/server/voice_agent/agent.py>) | 流式听写、按小句合成、预生成、0.5 秒确认打断、误打断恢复、按实际播出截断对话。学这些能力，不迁移闭源 AOQ SDK 或旧版身份冒充提示词。 |

旧级联通话不是 `voice_asr` 三条文件端点的简单串联：桥接流式 ASR 的模型在源码单独指定，TTS 可解析克隆场景。后台“克隆”页挂着千问 TTS，不代表千问只能克隆、不能普通合成。

## 5. 官方现行模型与协议核验

| 用途 | 现行核实到的型号 | 协议/接入判断 | 官方证据 |
|---|---|---|---|
| 小米文件 ASR | `mimo-v2.5-asr` | HTTP Chat Completions，多模态音频输入；不是 multipart transcription | [MiMo ASR API](https://mimo.mi.com/docs/zh-CN/api/audio/Speech-Recognition) |
| 小米 TTS/克隆/设计 | `mimo-v2.5-tts`、`mimo-v2.5-tts-voiceclone`、`mimo-v2.5-tts-voicedesign` | 专用语音生成请求；按具体子模型区分系统音色、参考音频克隆、描述设计；不将设计等同克隆 | [MiMo TTS 指南](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5) |
| 硅基流动文件 ASR | `FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR` | `/v1/audio/transcriptions`，multipart；这不构成持久在线流式 ASR | [API 模型枚举](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post) |
| 千问文件/消息 ASR | `qwen-audio-3.1-asr-flash`、`qwen-audio-3.1-asr-flash-message` | 前者官方矩阵列非实时 HTTP；Message 有针对语音消息的识别与文本处理参数，不默认用同一适配器 | [ASR 矩阵](https://help.aliyun.com/zh/model-studio/asr-model)、[Message 型号](https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-asr-flash-message) |
| 千问流式 ASR | `qwen-audio-3.1-asr-flash-streaming` | DashScope Inference WebSocket；需中间/最终结果、断句、任务失败及真实 token usage 解析 | [实时识别指南](https://help.aliyun.com/en/model-studio/real-time-speech-recognition-user-guide)、[改善识别准确率](https://help.aliyun.com/en/model-studio/improve-asr-accuracy) |
| 千问 TTS | `qwen-audio-3.1-tts-flash`；Plus 仍为 `qwen-audio-3.0-tts-plus` | 官方矩阵均列 WebSocket/HTTP；3.1 Flash 流式 Inference 与原有 Qwen3-TTS-Realtime 的命名/协议不能混用 | [TTS 矩阵](https://help.aliyun.com/zh/model-studio/tts-model)、[3.1 Flash 型号](https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-tts-flash) |
| 千问声音复刻 | `voice-enrollment`，绑定受支持的 target_model；另有 realtime/Omni 复刻接口 | 创建音色与合成是两种操作；不同系列并非一个万能 voice_id | [复刻指南](https://help.aliyun.com/en/model-studio/voice-cloning-user-guide)、[SDK 参数支持](https://help.aliyun.com/zh/model-studio/voice-clone-java-sdk)、[Omni 复刻 API](https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning) |
| 千问真 realtime | `qwen-audio-3.1-realtime-plus` | 官方列 WebSocket/WebRTC/AOQ；新版首期推荐服务器中转 WS，不能把长期供应商密钥发给手机 | [真实型号](https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-realtime-plus)、[接入方式](https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-model-access)、[WS 概览](https://help.aliyun.com/zh/model-studio/realtime-websocket-overview) |
| Omni 普通多模态 | `qwen3.8-omni-flash` | Chat Completions/Responses，用于音视频理解；需独立确认是否及怎样返回语音，不能当低延迟双工接口 | [全模态选型](https://help.aliyun.com/en/model-studio/omni/) |
| Omni 真 realtime | `qwen3.8-omni-flash-realtime`；旧 `qwen3.5-omni-plus-realtime` 仅作兼容研究 | 3.8 于官方更新页 2026-09-21 发布，支持 WS/WebRTC/AOQ；支持多通道等不等于新版首批要开启 | [官方更新](https://help.aliyun.com/zh/model-studio/newly-released-models)、[Realtime 指南](https://help.aliyun.com/zh/model-studio/realtime) |

**命名规则**：不能把 `qwen-audio-3.1-*`、`qwen3-tts-*`、`qwen3.8-omni-*` 的数字当成可统一替换的版本前缀；`realtime` 出现在 TTS 名字里也可能只是实时合成，不表示听懂用户并自主回答。

## 6. 计费矩阵（供应商成本与平台售价必须分开）

下表金额为人民币官方索引所示公开按量成本，**不是新版用户售价**；未核实合同折扣/区域差价。价格来源：[MiMo 按量价格](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go)、[硅基流动价格](https://siliconflow.cn/pricing)、[百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[声音复刻及设计](https://help.aliyun.com/zh/model-studio/voice-cloning-and-voice-design)。

| 能力/模型 | 官方成本单位 | 本轮核到的参考价 | 新版建议计量 |
|---|---|---|---|
| MiMo v2.5 ASR | 音频时长（小时展示） | 0.5 元/小时；等价约 0.008333 元/分钟，最终粒度需按量规则复核 | 保存实际音频秒数及供应商计费粒度，不按通话墙钟时长冒充文件音频时长 |
| SiliconFlow 两个文件 ASR | 免费模型，具体可用性/限额需复核 | 官方用例称两者免费；不是永久 SLA 或长期零售价承诺 | 仍记调用、音频秒数、零成本价格版本；别绕开额度与失败处理 |
| MiMo TTS/VoiceClone/VoiceDesign | 当前促销状态；未来单位需再核 | 官方当前写“限时免费”，不能外推永久免费 | 用量留痕；促销生效/失效和未来付费价分开，不编造按字价格 |
| 旧 Qwen 3.0 ASR Streaming | 输入秒 | 0.00033 元/秒（约 0.0198 元/分钟），输出不收费 | 可按官方粒度保存 asrSeconds，核对送达供应商的静音是否计入 |
| 新 Qwen 3.1 ASR Streaming | 输入/输出 token | 输入 6、输出 4.5 元/百万 token | 新增媒体真实 token 用量；不得沿用 3.0 的秒价 |
| Qwen 3.1 ASR Message | 输入/输出 token | 输入 6、输出 4.5 元/百万 token | 语音消息也可能需 token 计费，不能仅按上传时长结算 |
| Qwen 3.1 ASR Flash 非实时 | 官方型号页列 token 计费项 | 本轮未可靠核准与地域匹配的单价，留待完整正文复核 | 不把 Message/Streaming 的单价自动复制过来 |
| Qwen 3.0 TTS Plus | 输入字符 | 1.4 元/万字符，输出不收费 | 按官方字符规则计数，不能把 UTF-8 字节数当中文字符 |
| Qwen 3.1 TTS Flash | 输入/输出 token | 输入 1.5、输出 12 元/百万 token | 需文本输入与语音输出 usage，不能直接按合成文字字数结算 |
| Qwen 创建复刻音色 | 成功创建音色“个数” | 0.01 元/个，失败不收费；CosyVoice 创建音色免费 | 成功注册次数/个数单独幂等记账；后续 TTS 另收合成费用 |
| Qwen 3.1 Audio Realtime Plus | 分模态 token | 每百万 token：文字输入 5、音频输入 40、文字输出 40、音频输出 150 | 按供应商事件的各模态数量计算；同轮语音与转写文字是否同时收费需依该模型正文核准 |
| 旧 Qwen 3.0 Audio Realtime Plus | 分模态 token | 官方价格表同列 5 / 40 / 40 / 150 | 不能按“每通电话一次请求”只计一次，也不能套 asr+tts 再重复收费 |
| 旧 Omni 3.5 Realtime（包括索引所列 2026-03-15 版本） | 分模态 token | 每百万 token：文字/图像/视频输入 10、音频输入 80、文字输出 60、音频输出 300；最终需核具体版本行 | 旧规则中语音输出对应文字不收费；不能一律双计 |
| 新 Omni 3.8 Flash Realtime | 分模态 token | 型号已核实，完整单价行本轮未可靠拿到，**不套旧价** | 官方明确语音输出和对应文字分别计费；多通道音频输入 token 为普通音频两倍，首期禁用未核规格 |
| 新 Omni 3.8 Flash 普通调用 | 分模态/版本的 token 档位 | 完整价格矩阵未核准 | 与 Realtime 独立 modelKey/价格版本，不混在一个“Omni价”里 |
| ASR+LLM+TTS 级联通话 | 三项相加 | ASR成本 + 角色模型token成本 + TTS成本 | 每通/每轮下关联明细；已经计这三项就不再加一条“真realtime成本” |

### 6.1 按次、字、秒、token 的落地边界

- **按次/个**：克隆音色创建是供应商实际按次能力；用户若想“每段语音固定若干积分”或“每通电话固定收费”，那是**平台零售规则**，必须与供应商真实成本分账，并先定文本长度、音频长度、会话上限、重试/失败/退款规则。当前 `search_call` 是搜索专用，不应借作声音克隆通用按次单位。
- **按字**：只对厂家明确按字符收费的 TTS 使用。供应商的“字符”定义、标点、英文、计费步长必须写入 billingBounds；不按“看起来差不多”的字节折算。
- **按秒/分钟**：区分录音实际时长、传给 ASR 的时长、供应商向上取整和整通电话墙钟时长；冻结可以按时间分段，最终真实结算口径不必等于冻结周期。
- **按 token**：保存文字输入、缓存命中、音频输入、文字输出、音频输出，Omni 还需图像/视频相关计量与模型计价规则。不能用一组 generic input/output 合并后乘统一单价。
- 不凭 PCM 字节数估算 token 后称“实际用量”；不把“用户未听到”当成供应商未生成；打断、超时、断流有费用但 usage 未知时，继续走现有未知成本处理，不能断言免费。
- 免费额度、套餐抵扣与实际标价分开。不能因为旧账号免费，就把新账号/新地区长期价格登记为零。

## 7. 新版代码/契约缺口（本轮只读，不修改）

1. [媒体适配器](../../apps/server/src/modules/model-access/infra/media-adapter.ts) 目前主实现只有 `/audio/transcriptions`、`/audio/speech` 等 OpenAI 媒体协议。ASR 结果只有 `text`，TTS 是字节或字节流，**不带供应商 token/分模态 usage**。所以硅基文件 ASR 协议最接近，但小米和百炼都不能只填 baseUrl 就打通。
2. [媒体网关](../../apps/server/src/modules/model-access/application/media-gateway.ts) 的 `RealtimeAsr` 仍是 RMS 能量断句、静音 700ms、拼 WAV 后整段转写，只产出 `final:true`；**它不是真上游流式 ASR**。当前实际计量按提交片段秒数，不宜拿旧文档“按整通含静音时长”替代现代码事实。
3. [媒体契约](../../packages/contracts/src/ports/model-gateway.ts) 已有 `RealtimeAsrSession.results()` 的 final 标志和流式 TTS，可保留基本调用体验；但没有通用声音克隆注册、真 realtime 会话、工具调用与分模态计量合同，需先申请扩展。
4. [价目单位](../../packages/contracts/src/http/billing.ts) 有 input/cache/output token、tts_10k_chars、asr_minute、realtime_minute 等；**有 realtime_minute 枚举不代表已有真 realtime 协议实现，更不代表厂家按分钟计费**。现有 generic token 单位也不能自动表达同一请求内不同模态不同费率。
5. 流式 TTS 当前结束/打断结算已把未完成的实际量视为未知，不能恢复旧的“按播出音频比例猜字数当真实账单”。增加厂家 usage 后再解决部分生成对账。
6. [音色读取契约](../../packages/contracts/src/ports/media.ts) 只有 voiceId/providerVoiceKey/modelKey 等；克隆需要补 provider/account/region/targetModel、授权记录、样本私有媒体、创建状态、删除/撤销、有效性、幂等键。旧库 voice_id 不能直接塞进新账号当迁移完成。
7. 角色、安全与记忆：级联继续复用 ai-runtime；真 realtime/Omni 需把同一角色上下文与记忆注入会话，落实转写落库、已播截断、余额分段冻结、结束摘要、硬性边界、安全关怀和外部工具审计。**音频已输出后才审核文字不能等价于现有合成前 outputAllowed**；这是上线门禁，不是填几个参数就解决。
8. [ADR-0025](../decisions/ADR-0025-voice-call-transport.md) 已采纳级联与字/分钟计价。3.1 token 媒体与端到端 realtime 属于需补充决策/契约的变更，不能以本研究报告静默覆盖旧 ADR。

## 8. 推荐分批计划与验收门禁

### A. 先补底座与语音消息

- 配置按供应商协议区分：`siliconflow_audio`、`mimo_audio_chat`、`dashscope_inference`、`dashscope_realtime`；不要把这些建议标识误写成已实现的 kind。
- 首批恢复两个硅基文件 ASR + 小米 ASR 备用、小米普通 TTS；再接千问 Plus/3.1 Flash。保持各路由独立开关、已核 billingBounds、管理员价格来源与核价时间。
- 扩展媒体 adapter 返回可信 usage/计费粒度/供应商请求引用；优先解决新模型单位，不等做完通话再补账。
- 录音格式、解码/重采样、时长边界、超长/损坏/静音、错误回退、取消/未知成本先做本地假上游测试；真实付费验证需要另获授权，本轮不做。

### B. 稳定级联通话，再决定是否切 3.1

- 保留现有每通一条平台 WebSocket 和 calls 会话管理；新建百炼真流式 ASR、按小句 TTS、流式非思考角色 LLM，依既有方案改进两段式打断与已播记录。
- 明确两种备选：短期兼容 3.0 ASR 秒计费 + Plus 字计费；或在新 usage/价格合同完成后采用 3.1 token 方案。3.0 只是过渡选项，仍须确认供应商未下线，不承诺旧型号长期可用。
- 记录每轮端点、ASR最终字、LLM首字、TTS首包、客户端实际开播时间、实际 usage、幂等结算和取消原因。旧 161 秒约 0.103 元是历史估计，不是新版预算验收值。
- 断线/重连不双扣；重复挂断不双结算；供应商已生成但未播放的成本正确归属；余额耗尽按服务器兜底结束；供应商故障不能拖垮聊天。

### C. 千问真 realtime（实验开关）

- 独立 `qwen-audio-3.1-realtime-plus` 会话 adapter 与模型目录项；服务器持长期密钥，中转 WS，保留客户端 PCM/控制协议，确需直连再审批临时凭证与 WebRTC。
- 不再调用角色 LLM+TTS 生成同一回复，避免重复声音、重复成本。把角色记忆/工具与安全策略接入真 realtime，不允许因低延迟跳过审核和余额控制。
- 对比级联的首声、可打断、音色、幻觉、角色一致性、成本；产品明确此模式的声音和安全边界后才能开放。无法做到输出前安全控制时不得按“与原方案等价”发布。

### D. Omni（单独实验，不默认开启视频）

- 普通音视频理解与 realtime 通话分两个功能；现行优先研究 `qwen3.8-omni-flash` / `qwen3.8-omni-flash-realtime`，旧 3.5 只做兼容，不自动启用旧音色。
- 首期仅单通道音频；图像/视频、空间音频、联网搜索/MCP 默认关闭，避免隐藏成本、隐私和工具越权。必须逐模态实施可执行的上限和分段预留。
- 先补完整 3.8 官方价格行与 usage 事件样本，确认“语音与对应文字双计”等规则，再做离线协议测试；未核价不得配成可收费路由。

## 9. 交接与未完成事项

- 已完成：旧库端点/启用状态、753 条绑定聚合、三个语音服务 active、本机旧/新源码与契约差距、官方当前 3.1 与 3.8 型号索引证据和计费变化研究。
- 未完成且不得宣称通过：官方完整正文/控制台区域报价、3.8 Omni 全模态具体单价、供应商实际 usage 报文、现有账号权限/额度、供应商模型实际可用、样本授权、真实流式音频、真机回声/打断/延迟/通话余额与账单对账。
- 需要主负责人处理：独立任务卡/契约申请，优先统一媒体用量与分模态成本；研究报告不改动当前 DeepSeek 按次收费工作，不与本轮 Web 发布混做语音上线。
- 本轮无访问缺口：初始 root 登录失败，已依据文档改用既有 ubuntu 身份完成只读查询；不需要用户提供密钥或密码。
