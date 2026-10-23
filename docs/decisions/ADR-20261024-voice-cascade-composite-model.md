# ADR：把「识别→文本→合成」三级链路作为一个通话模型展示

- 状态：已接受（2026-10-24），待实现
- 关联：MED-06 语音通话、MDL 模型目录与计费、会员展示倍率

## 背景

当前新站把通话拆成三个用户可见选择：`speech_recognition`（识别）、`voice_call`（通话文本模型）、`voice_message`（合成）。用户要选三次，且通话文本模型看起来像语音模型，容易误解。

总经理要求：用户端只看到一个「语音通话模型」，后台仍按 ASR 分钟、文本 token、TTS 字符三项按量扣积分，前端只展示一个合成倍率。

## 决策

1. 在模型目录新增**组合模型（composite model）**：`modelKey = voice/cascade-call`，显示名 `Voice Call Cascade`，场景 `voice_call`，`enabled = true`。
2. 组合关系不写进上游字段，改为目录条目的 `tags` 标记 `pipeline:call`（13 字符，在后台契约 `AdminCatalogEntry.tags` 的 16 字符上限内），并在 `model_access.settings` 新增 `voice_call_pipeline`：
   ```json
   { "asrModelKey": "...", "textModelKey": "deepseek/deepseek-v4.1-flash", "ttsModelKey": "...", "ttsVoiceMode": "system|clone" }
   ```
   组合模型本身**不调用任何上游**，因此不要求它自己配 token 单价。
3. 运行时：`voice_call` 场景解析到组合模型时，按 `voice_call_pipeline` 取三个组件；识别仍走 ASR 网关（与 `speech_recognition` 同一实现），文本走文本网关，合成走 TTS 网关。计费仍是三次真实调用，不做合并收费。
4. 展示倍率：按旧版实测「每分钟约 3 积分」（ASR 1.08 + TTS 约 68 字≈1.24 + 文本约 6 轮 token）折算，公式与基准模型一致；价格变化后自动重算。倍率只影响显示，不参与扣费。
5. 组件模型若被停用或下架，组合模型立即不可用并给出原因，不静默换模型。

## 备选（未采纳）

- **给文本模型加 voice_call 场景**：用户仍看到文字模型，且识别/合成还是要单独选，达不到「一个模型」。
- **伪造一个假上游**：会让计费、账单和失败重试都指向不存在的供应商，不可取。
- **把三项合成一次扣费**：会掩盖真实成本、无法与供应商账单对账，且退款/失败规则复杂。

## 后果

- 用户端通话只出现 `Voice Call Cascade` 一个条目，倍率由三项价格自动折算。
- 后台用量与账单仍按三条真实记录，可分别对账。
- 需要新增：目录组合标记与设置项、运行时解析分支、倍率计算、后台展示；不新增 HTTP 契约、不改价目单位。
- 旧版音色绑定（753 条千问 voice_id）作为 TTS 组件的音色来源，仍按用户/角色归属解析。
