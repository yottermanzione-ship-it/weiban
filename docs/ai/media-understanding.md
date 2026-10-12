# 多媒体 AI：表情包、语音、识图认人、分享链接（T-071）

> 负责人：AI 系统负责人 · 2026-10-10 · 依据：任务卡 T-071、PRD MED-01/03/04/05、ADR-0025。
> 参数原文以 PRD 为准，这里只说明代码怎么实现。

## 1. 一句话结论

所有多媒体能力都经模型网关（`ModelGatewayMediaPort`，model-access 实现）调用并计费；ai-runtime 的
`MediaAiService` 负责「什么时候用、用多少、哪些不能说」。平台没在模型目录里把某个模型设为对应默认
（`speech_synthesis` / `speech_recognition` / `image_generation` / `web_search` / `vision`）就等于「未开通」，相关功能安静消失。

## 2. 模型网关多媒体扩展（model-access）

| 方法 | 计价单位 | 说明 |
|---|---|---|
| `synthesizeSpeech` | `ttsChars`（tts_10k_chars） | 音色取自音色库（非克隆）；优先用音色登记的模型，否则用默认语音合成模型；结果存为 `generated_voice` |
| `transcribeSpeech` | `asrSeconds`（asr_minute） | 只识别本人的 `chat_voice`；时长取媒体记录 |
| `generateImage` | `images`（image） | 结果存为 `generated_image`（T-072 用） |
| `webSearch` | `searchCalls`（search_call） | 默认搜索模型应挂在博查（`bocha_search`）上游 |
| `openRealtimeAsr` | `asrSeconds` 每分钟一段 | 通话用（T-072）。每分钟冻结、结算；冻结不到下一分钟时结束结果流；能量断句后逐句识别 |
| `streamSpeech` | `ttsChars` | 通话用。`abort()` 打断后按已收到的音频折算字数结算 |
| `isServiceEnabled` | — | 对应默认模型存在、启用、上游正常 |
| `decide` | — | T-090 实现前一律 `not_configured` |

- 非流式调用 24 小时幂等（复用文本网关结果缓存，键前缀 `media:`）。
- 用量记录新增 `media_units`（迁移 0047），记下字数 / 秒数 / 张数 / 次数；金额、耗时、模型照常记。
- `generateText` 支持 `messages[].images`：网关读取图片转成多模态消息；所选模型没有识图能力时改用平台默认识图模型。
- 假上游：非生产环境下，目录模型的 `upstreamModelId` 以 `fake-` 开头时不发网络请求（静音 WAV、固定识别文字、空搜索结果、固定识图 JSON），**计费照常**。
- 装配入口把 calls 的 `CALL_SERVICE_STATUS` 绑定为「语音识别与语音合成都开通」。

## 3. ai-runtime 行为

### 3.1 理解用户发来的内容（回复上下文）
- 本轮新消息（上一条角色消息之后，最多 6 条）：语音先转文字并写回 media（`MediaTranscriptPort`）；图片走识图；表情包用库内含义，没有含义时识图概括，再不行按「发了一个表情」；链接读标题与摘要（摘要缺失时用 `LinkPreviewPort` 再读，读不到只按标题）。
- 旧消息只写占位文字（「[对方之前发过一张图片]」），不重复花钱。
- 另有任务 `ai.transcribe_voice`：用户语音（私聊和群聊）一到就转文字，供「转文字」按钮使用。
- 语音服务未开通：转写状态标为 `unavailable`（客户端显示「当前无法识别语音」），角色按「没听清」回应。

### 3.2 识图认人（MED-04）
1. 名单 = 角色本人（含别名）+ 关系网中有公开依据的关系（预设之间要求 `evidence`；用户自己为自定义角色设的关系也算）。
2. 识图模型按封闭名单输出 JSON（描述、名单内的人、图片类型、图中文字）；名单外的名字被丢弃。
3. 认出自己、真人角色、像杂志 / 新闻时联网搜索；有结果则只允许引用结果中的信息，没有结果则明确禁止说具体杂志名和日期；不得以本人身份确认未经官方公开的新闻。
4. 回复里出现已录入的真人姓名且不在名单、用户也没提到 → 重写一次，仍不行改发安全说法。

### 3.3 回复附加（只在日常范围、非安全关怀的普通回复）
- **语音**：用户要求（「发条语音」「想听你的声音」等）或规则版概率 6%，且该角色最近 100 条消息中语音占比加上这条不超过 10%；P-45 静默中、语音服务未开通、没有可用音色（陪伴设置 → 预设默认音色）、文字超过 120 字时不发。整段回复合成一条语音，`transcript` = 回复原文。发出后发 `ai_runtime.milestone`（voice_message_sent）。
- **表情包**：只用 `listStickersForCharacter` 返回的子集；最近 10 条气泡（含本次）里不超过 2 个；概率 15%；含义与回复字面重合最多的优先。
- **作品链接**：用户想听 / 想看时，从作品链接库挑（标题出现在回复里的优先），发出前再做一次可访问性检查，打不开的回写检查结果并跳过。
- 行为规划决策层（T-090）就绪后，上述概率改由决策层选择，上限规则不变。

### 3.4 主动分享（MED-05）
主动消息调度新增理由 `share_work`：每角色每周最多一次候选，计入 P-03 / P-04（走原有发送账本）；文字由模型写，链接卡片单独发出；链接临发前不可访问则整条放弃。

## 4. 陪伴设置音色
`CompanionSettings.voiceId` 落在 `ai_runtime.companion_settings.voice_id`（迁移 0046）；保存时校验音色库里存在且启用。

## 5. 待配置后验证
真实语音合成 / 识别（OpenAI 兼容 `/audio/speech`、`/audio/transcriptions`）、图片生成（`/images/generations`）、博查搜索（`/web-search`）、真实识图模型的认人效果（eval-plan 2.2 节）。
