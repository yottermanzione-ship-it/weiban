# 行为规划决策层（PRD 第 17 章）

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 任务 | T-022 |
| 版本 | 1.0 |
| 日期 | 2026-10-05 |
| 需求来源 | PRD v1.3 第 17 章 PLAN-01～PLAN-03、P-45、ADM-05 第 10 条；总经理第三轮意见第 3 节及 2026-10-05 答复第 2 条（允许把普通聊天摘要发给 Jev）；`docs/architecture/billing.md` 10.2 节（计费）；`docs/architecture/health-data.md` 第 4 节（经期摘要的 `planning` 场景） |
| 本文是唯一定义处 | 决策类型与选项、决策输入输出格式、默认实现、保守选项、置信度门槛默认值、故障退回、Jev 接入方式与出境数据规则、「不方便」识别规则、决策记录 |
| 不在本文 | 费用估算数字见 `cost-estimate.md` 5.1 节；盲评与对比评测的题量、通过线见 `eval-plan.md` 3.15、3.16 节；频率上限只引用 PRD 参数表 |
| 状态 | 设计完成；所有依赖 Jev 真实接口的内容标「**待配置后验证**」（总经理答复第 3 条：账号和密钥之后由总经理配置） |

## 0. 先看结论（给总经理）

1. **决策层只做选择题，不写一个字的聊天内容**。代码先算出「这一次允许选什么」（已经扣掉所有上限、开关、免打扰、安全关怀），决策层只能在这些选项里挑一个，并给出置信度（0～1，代表「有多确定」）和一句理由。挑出范围外的选项一律作废。
2. **默认实现 = 规则 + 便宜模型**：能用规则定的（比如用户刚说「在上课」）直接定，不花钱；规则拿不准、而且确实有两个以上选项时，才问一次便宜模型。一次约 0.001 元。
3. **费用很小**：典型用户每天约 0.03 元，约为聊天回复费用的 1%～6%，低于产品要求的 10%。代码还会自动看着：某天某用户的行为规划费用超过他聊天费用的 10%，当天剩余时间改用纯规则（`cost-estimate.md` 5.1 节）。
4. **不会变慢**：聊天路径上的决策和聊天模型**同时**跑，聊天模型写完后最多再等 1 秒，等不到就按规则版。
5. **不会失败**：决策层出错、超时、没钱、后台预算用完，一律自动退回现在的规则版，用户看不出任何变化，也没有横条。
6. **Jev 是候选实现**：它本来就是「输入情境 → 输出类型化决策 + 置信度」的模型，形态正好对得上。拿到账号后，只把它接到不涉及健康、不涉及成人模式的决策类型上，和默认实现做盲评对比，好了再切。发给 Jev 的只有**普通聊天的摘要和结构化特征**，没有原文、没有经期数据、没有成人模式内容、没有图片和语音。
7. **唯一新增的行为底线 P-45**（用户说不方便后 2 小时内不发语音、不来电）由代码强制，不靠决策层自觉；规则版和规划版都遵守。

## 1. 决策层在流程里的位置

```
 用户消息 / 推演完成 / 每日排程
          │
          ▼
 ① 代码算「允许选项」：上限（P-03/P-04/P-10/P-11～P-13/P-16、语音 ≤10%、表情包 ≤20%）、开关、免打扰、
    活跃时段、余额与服务是否开通、P-45 静默、安全关怀状态、情景模式与贴合度限制
          │  只剩 1 个选项 → 直接用，不调用决策层
          ▼
 ② 决策层（按决策类型选实现：rules / rules_model / jev）
          │  输出：选项 + 置信度 + 理由
          ▼
 ③ 代码校验：选项必须在①的集合内；置信度 < 门槛 → 用「保守选项」
          ▼
 ④ 执行：聊天模型照常生成内容；记录决策（第 7 节）
```

安全关怀状态中**根本不调用决策层**（第 3 节保守规则直接生效），所以「关怀状态下决策记录里没有小巧思」由代码结构保证（PLAN-01 验收第 2 条）。

## 2. 决策类型与输出格式

### 2.1 决策类型（`decisionType`）

| 取值 | 对应 PRD | 选项（`options` 的全集；每次实际可选的由代码按第 1 节①裁剪） | 保守选项 |
|---|---|---|---|
| `reply_form` | PLAN-01 表第 1 行、MED-01、MED-03 | `text`、`voice`、`keep_image`（保留模型写的图片占位）、`keep_sticker`、`keep_link` 的组合；表达为一组是非题 | 只发文字（删除图片 / 表情包 / 链接占位以外按原规则，见 2.3） |
| `reply_timing` | CHAT-04、P-01 | `fast`（按长度下限）、`normal`（按长度中值）、`slow`（按长度上限） | `normal`（与现规则一致） |
| `quirk` | CHAT-07、CHAT-08 | `none`、`read_no_reply`、`shy_typing`、`recall_resend`、`typo_fix`、`poke` | `none` |
| `proactive_slot` | SIM-05 第 10 条 | 当天允许的时段编号（由调度器算出的 2～4 个候选时段）+ `skip_today` | 规则版原本抽中的时段 |
| `call_slot` | MED-07 | 同上（只在当天满足 P-10 与熟悉度条件时出现） | `skip_today` |
| `moments_plan` | SOC-07、P-16 | `post_at:<时段>`、`skip_today`；`with_image` 是非题 | 规则版抽签结果 |
| `play_slot` | PLAY-01 第 6 条、PLAY-02 第 2/7 条、PLAY-04 提议 | 允许的时段 + `skip_today` | 规则版的时段（经期前提醒：规则版固定在预计开始日前 P-37 天的活跃时段中段） |

「理由」（主动消息的 `reason`，SIM-05 第 1 条）仍由调度器代码给出候选，决策层只决定「何时 / 是否」，**不能发明新理由**。

### 2.2 输入（`PlanningRequest`，ai-runtime 内部类型）

```
{
  decisionType,                // 2.1
  options: [...],              // 本次允许的选项（已裁剪）
  questions: [...],            // 同一时刻的多个决策可以合并成一次请求（见 4.2）
  features: {                  // 结构化特征，全部由代码算出
    localTime, weekday, isHoliday, minutesSinceLastUserMsg,
    userActiveLikelihood,      // 活跃时段学习（P-06）给出的 0～1
    inconvenientActive,        // P-45 静默是否生效（生效时 voice / call 已从 options 中删掉）
    userMsg: { length, isVoice, hasImage, emotionTag, seriousness, teasing },  // 输入检测器给出
    relationshipType, familiarityLevel, personaTags, personaFit, scenarioMode,
    characterMood, todayEventTags,
    quotaLeft: { voice, sticker, proactive, quirk }   // 剩余额度，只作参考
  },
  summary: string | null,      // 见 5.2：国内实现可给最近对话摘要；境外实现只给「普通聊天摘要」
  periodHint: object | null    // 只在国内实现、且决策类型为 play_slot 或 reply_form 时可能有，见 5.3
}
```

`emotionTag`、`seriousness`（用户是否在认真说事）、`teasing`（用户是否在逗角色）来自现有输入检测器（`runtime-overview.md` 第 3 节第 2 步）的规则结果，不额外花钱。

### 2.3 输出（`PlanningDecision`）

```
{
  decisionType,
  choice,                      // 必须属于 options
  confidence: 0..1,            // 「有多确定」；Jev 原生提供，便宜模型按 4.3 节换算
  reason: string,              // ≤ 40 字，如「用户说在上课 → 不发语音」
  implementation: 'rules' | 'rules_model' | 'jev',
  fallback: null | 'low_confidence' | 'timeout' | 'error' | 'budget' | 'cost_guard' | 'circuit_open' | 'invalid_choice',
  latencyMs, usageRecordId | null
}
```

**置信度门槛**：默认 0.55（每个决策类型可由管理员单独调整，范围 0.3～0.9）。低于门槛 → 执行保守选项，`fallback = low_confidence`（PLAN-01 第 4 条）。门槛的依据：Jev 资料中把 0.35～0.70 之间的置信度视为「需要复核」区间（来源见第 9 节），取中间偏下的 0.55，开发期用盲评数据再调（`eval-plan.md` 3.15）。

**图片、表情包、链接的处理**：聊天模型照旧自己决定写不写 `[图片:…]`、`[表情:…]`、`[分享:…]` 占位（`runtime-overview.md` 4.2）；决策层只决定「保留还是删掉」。这样决策可以和聊天模型并行跑（4.1），也不需要改提示词。语音是在文字生成后转语音，同样不影响聊天模型。

## 3. 默认实现：规则 + 便宜模型

### 3.1 规则层（不花钱，所有决策先过）

| 规则 | 结果 |
|---|---|
| 安全关怀状态 | 不进入决策层；`reply_form = text`、`quirk = none`、`reply_timing = fast`（SAFE-06 第 4 条） |
| P-45 静默生效 | `voice`、`call_slot` 已被删除（第 6 节）；`proactive_slot` 只能选静默结束之后的时段或 `skip_today` |
| `seriousness = 高`（用户在认真说事、求助、低落） | `quirk = none`（与 `runtime-overview.md` 10.1 不触发条件一致） |
| 用户发来语音、且语音额度有余 | `voice` 偏好加分（交给模型时作为特征；纯规则版按 30% 概率） |
| 只剩一个选项 | 直接采用，不调用模型 |
| 规则版本身 | 与现行 `runtime-overview.md` 6.2、10.1 完全一致（抽签概率、时段抽取）。它同时是「保守选项」的来源和所有故障的退路 |

### 3.2 模型层（只在需要时调用）

**什么时候调用模型**（全部满足）：决策类型配置为 `rules_model`；规则层后仍有 ≥ 2 个选项；并且属于下列「值得问」的情况之一：

- 回复路径：本轮 `voice` 或 `keep_image` 是可选项（额度有余、服务已开通），或 `quirk` 有非 `none` 的可选项；
- 主动路径：每个用户每天**一次**合并请求（4.2），决定当天所有主动消息、来电、朋友圈、玩法的时段。

其余情况用规则版，不花钱。按典型用户估算，回复路径约 40% 的轮次会调用一次模型（`cost-estimate.md` 5.1）。

**用哪个模型**：平台配置的「规划模型」（管理员在决策层配置里为每个决策类型指定，默认 `qwen/qwen3.8-flash`，备选 `deepseek/deepseek-flash`），**不使用用户选的后台模型**。理由：决策质量要可评测、费用要可预测；用户若把后台模型设为昂贵模型，行为规划费用会失控。费用仍按价目表从**用户余额**扣（用途 `behavior_planning`，PLAN-03 第 4 条）。这需要网关支持「为行为规划指定模型」，见第 8 节变更申请 CR-17。

**提示词**：固定前缀（约 500 token，可命中缓存：任务说明、各选项含义、角色人设标签的解释）+ 本次特征与摘要（约 300 token）；要求输出 JSON：`{"answers":[{"q":"voice","choice":"yes","p":0.8,"why":"…"}]}`。温度 0。输出约 60 token。

### 3.3 便宜模型的置信度

通用模型自报的数字不可靠，按下面的方法换算（Jev 不需要，它原生返回）：

1. 要求模型对每个问题给出各选项的概率 `p`（和为 1）；
2. `confidence = 最高概率 − 第二高概率`（分布越集中越确定，思路同 Jev 资料对置信度的说明）；
3. JSON 解析失败或概率不合法 → `fallback = error`，用保守选项。

开发期用盲评数据检查「置信度高的决策是否真的更常被评为合适」（校准），不成立就调高门槛或改为只用规则。

## 4. 时延、合并、成本保护

### 4.1 回复路径：与聊天模型并行

```
用户停下来（合并批次）→ 输入检测 → ┬→ 组装上下文 → 聊天模型（流式）→ 输出守卫 ┐
                                   └→ 决策层（reply_form / reply_timing / quirk）┴→ 应用决策 → 拆条发送
```

- 决策层输入只用用户消息的特征和最近摘要，**不需要等角色回复写完**，所以与聊天模型同时开始。
- 聊天模型和输出守卫完成后，若决策还没回来，**最多再等 1 秒**（秒回开启时；PLAN-02 第 1 条）；秒回关闭时本来就有 P-01 的人为延迟，最多等到延迟结束。超时 → 规则版，`fallback = timeout`。
- 已读不回（`read_no_reply`）是「晚点再发」，决定后把已生成的回复延后 P-11 规定的时长发出，不需要提前知道。

### 4.2 主动路径：每天一次合并请求

每天推演完成后（`runtime-overview.md` 6.1 第 ④ 步之后），调度器把当天所有候选（主动消息 0～N 条、朋友圈、来电、玩法时机）连同各自允许的时段一起交给决策层，**一次请求**得到全部答案。时效要求低（超时 10 秒）。白天发生的变化（用户说不方便、正在聊天）由代码按 P-45、P-09 直接延后，不重新问模型。为主动行为做的这次决策调用传 `countAsBackground: true`，计入后台预算（`billing.md` 10.2 第 2 条）；后台预算用完或余额低于 P-33 时直接用规则版，不产生「行为规划」费用（PLAN-03 验收第 1 条）。

### 4.3 成本保护（PLAN-03 第 4 条「不超过聊天费用的 10%」）

- **当日比例闸**：ai-runtime 每次调用前读本用户今天（用户时区）已结算的 `behavior_planning` 与 `chat_reply` 金额（自己的决策记录里有 `usageRecordId`，金额来自 `GenerateTextOutput.chargedMicros`，不需要新接口）。今天聊天回复已满 10 次、且规划费用 ≥ 聊天费用的 10% → 当天剩余时间回复路径全部用规则版（`fallback = cost_guard`）。主动路径每天只有一次，不受此闸影响。
- **月度复核**：月度成本报告（`cost-report-YYYY-MM.md`）列出全体用户的规划费用 / 聊天费用比例；任何用户月度比例超过 10% 时，按 PRD 要求上报总负责人，不默认接受。

## 5. 数据：给决策层什么、不给什么

### 5.1 一律不给（国内、境外实现都一样）

- 完整聊天记录（PLAN-03 第 5 条）；
- 用户的记忆条目原文、「关于我」、我的资料（名字、生日、城市）、专属称呼；
- 图片、语音原件（只给「用户发了一张图 / 一段语音」这个事实）；
- 带「健康」标记的消息、`scope = adult` 的消息（成人模式会话中，决策层只收到特征，不收到摘要）。

### 5.2 「摘要」是什么

- **国内实现**（`rules_model`）：`summary` = 本会话最近一条分段摘要（`runtime-overview.md` 5.2，本来就已生成）+ 当前这批用户消息截断到 100 字。经过隐私脱敏规则（`plaza-privacy-check.md` 第 2 节的规则层：手机号、证件号、银行卡、邮箱、地址替换为占位符）。
- **境外实现**（Jev）：`summary` 只用**已经生成好的分段摘要**（150～250 字，本身就是「普通聊天的摘要」），同样过脱敏规则，并且把人名替换为「用户」「角色」「朋友A」；**不发送任何一句原文**，当前消息只以 `features.userMsg` 的结构化特征出现。这是对总经理答复第 2 条「允许把普通聊天的摘要发给 Jev」的执行方式：只发摘要，不发原文。
- 分段摘要若来自含「健康」标记或 `scope = adult` 消息的片段，该摘要**不发往境外**（摘要记录上有来源消息范围，代码检查来源中是否含这两类消息；含则 `summary = null`）。

### 5.3 经期数据

- 只有**国内实现**可以经 `HealthReadPort.getPeriodContext(scene = 'planning')` 现取摘要（`health-data.md` 第 4 节），用于 `play_slot`（经期前提醒、经期中关心的时段）和 `reply_form`（经期中是否适合发语音）；只传「是否在经期 / 是否临近」两个布尔值，不传日期和症状。
- **境外实现永远不调用 `HealthReadPort`**。路由规则（代码强制）：任何决策请求只要带了 `periodHint`，或来自成人模式会话，或 `decisionType = play_slot` 且候选里有经期理由，**一律走国内实现或规则版**，即使管理员把该决策类型配置为 Jev。
- 决策记录中，涉及经期的决策 `reason` 不保存模型给出的文字，只保存固定代码 `health_timing`（防止理由里出现健康信息；`health-data.md` 第 4 节第 2 条「不写日志、用量记录」的延伸）。

### 5.4 出境数据的代码闸

所有发往境外实现的请求经过一个**出境净化器**（`OverseasPlanningSanitizer`）：

1. 只接受 2.2 节结构中的白名单字段（严格 schema，多一个字段即拒绝发送）；
2. `summary` 再过一遍脱敏规则和人名替换；
3. 检查 `periodHint == null`、会话 `contentScope != adult`、`summary` 来源不含「健康」/`adult` 消息；任一不满足 → 不发送，改用国内实现或规则版；
4. 测试：金丝雀短语（放在经期备注、成人模式消息、图片说明里）走完整流程后，在出境请求日志（测试环境开启）中出现次数必须为 0（PLAN-03 验收第 3 条，`eval-plan.md` 3.16）。

## 6. P-45「不方便」识别与静默

### 6.1 识别（输入检测器的规则层，毫秒级，不花钱）

| 类别 | 例句（词表维护在 AI 配置中，以下只是示例） |
|---|---|
| 上课 / 学习 | 在上课、老师在讲课、上晚自习、在图书馆、考试中、在考场 |
| 工作 | 在开会、开会中、在工位不方便、在加班、领导在旁边 |
| 睡觉 | 准备睡了、要睡了、躺下了别吵、睡觉了 |
| 公共场合 / 出行 | 在地铁上、在公交上、在开车、在外面不方便、旁边有人 |
| 直接表达 | 现在不方便、别打电话、别发语音、等会再说 |

- 结束信号（同批次中出现则不生效）：下课了、开完会了、到家了、醒了、方便了。
- 否定与假设句排除：「明天要上课」「我不想上课」「睡不着」。
- 规则拿不准（例如「在外面」）时，**按不方便处理**（宁可安静）。不另外调用模型。

### 6.2 静默

- 命中后写 `ai_runtime.user_quiet_state.inconvenientUntil = 现在 + P-45`（**对该用户的所有角色生效**：用户在跟 A 说「在上课」，B 也不该打来）。
- 生效期间，代码从所有决策的允许选项中删除 `voice` 和 `call_slot`；主动消息只能延后到静默结束之后。这条在第 1 节①执行，**规则版和规划版都遵守**。
- 提前结束：用户之后再发来一批消息、且这批消息本身不再表达不方便（PRD P-45「用户再次发来消息时提前结束」）；同一批合并消息中的后续句子不算「再次发来」。
- 用户明确要求「发语音给我」时（MED-03 第 2 条用户要求），照做并结束静默。

## 7. 决策记录、切换与故障

### 7.1 决策记录（PLAN-01 第 4 条）

存 `ai_runtime.planning_decisions`（AI 自己的表）：`decisionId`、`userId`、`characterId`、`conversationId`、`decisionType`、`options`、`choice`、`confidence`、`reason`、`implementation`、`fallback`、`latencyMs`、`usageRecordId`（调用了模型时）、`createdAt`。不存消息原文；保留 90 天；用户注销时随 ai-runtime 删除清单删除。质量负责人按 PLAN-01 验收抽查 50 条。

### 7.2 管理员切换（ADM-05 第 10 条、PLAN-03 第 2 条）

- 配置表 `ai_runtime.planner_config`：每个决策类型一行，`implementation`（`rules` / `rules_model` / `jev`）、`modelKey`（后两者）、`confidenceThreshold`、`updatedBy`、`updatedAt`。默认全部为 `rules_model`（规划模型 `qwen/qwen3.8-flash`）；**上线初期先设为 `rules`，盲评通过后再逐类切到 `rules_model`**（PLAN-01 验收「规划版不低于规则版才能设为默认」）。
- 切换前提：该决策类型、该实现有最近一次评测记录（`docs/ai/eval-runs/` 中的盲评报告编号 + PLAN-02 时延与故障测试结果），管理后台在切换时要求选择报告编号；没有则不能切。每次切换写审计日志。
- 管理端接口见第 8 节 CR-19。

### 7.3 故障退回（PLAN-02 第 2 条）

| 情况 | 处理 |
|---|---|
| 超时（回复路径 1 秒、主动路径 10 秒） | 规则版，`fallback = timeout` |
| 网关返回 `provider_unavailable`、`model_unavailable`、`bad_request` 等 | 规则版，`fallback = error` |
| `budget_exceeded`、`insufficient_balance`、余额低于 P-33（主动路径） | 规则版，`fallback = budget`，不产生费用 |
| 输出不是合法 JSON、选项不在集合内 | 规则版，`fallback = invalid_choice` |
| **熔断**：某实现 5 分钟内错误或超时率 > 20%（至少 20 次），或连续 5 次失败 | 该实现暂停 10 分钟，全部走规则版（`fallback = circuit_open`），给管理员发一条告警；10 分钟后放 1 次探测，成功则恢复 |

全部情况：**不显示系统横条**（决策层不是聊天模型），不影响回复和主动消息的发送。

## 8. 需要架构配合的变更申请（汇总在 `runtime-overview.md` 第 15 节，此处说明理由）

| # | 申请 | 理由 |
|---|---|---|
| CR-17 | `GenerateTextInput` 支持为 `behavior_planning` 指定模型：建议新增可选字段 `modelKeyOverride`，**只允许**与 `purpose = behavior_planning` 同时出现（其他用途带上即 `bad_request`），且该模型必须在模型目录中标记为「可作规划模型」（如 `AdminCatalogEntry.defaultFor` 增加 `planner`，或新增能力标签）；照常按用户余额扣费 | 3.2 节：规划模型由平台按决策类型指定，不随用户的后台模型 |
| CR-18 | Jev 接入：① `UpstreamKind` 新增 Jev 对应取值（它不是 OpenAI 兼容接口，请求是「state + 类型化问题」）；② `ModelGatewayPort` 新增 `decide(input)` 方法（输入：`userId`、`purpose = behavior_planning`、`countAsBackground`、`modelKey`、`state`、`questions[]`、`idempotencyKey`；输出：每题的选项、各选项概率、置信度，以及 `usageRecordId`、`chargedMicros`），同样走冻结 / 结算 / 用量记录；③ 计价：Jev 按输入 token 计价（官网 42 美元 / 十亿输入 token，**待配置后验证**），现有按 token 计价可用，不需要 `PriceUnit` 新增按次单位；若实际为按次计价再按 `billing.md` 10.2 第 3 条评估 | 第 9 节；`billing.md` 10.2 |
| CR-19 | 管理端接口（D-L7-01）：`GET/PUT /api/v1/admin/ai/planner-config`（按决策类型读取 / 切换实现、模型、门槛，切换时必须带评测报告编号，写审计）、`GET /api/v1/admin/ai/planning-decisions`（按用户、角色、决策类型、时间、`fallback` 筛选决策记录，供质量抽查，不含消息内容） | 7.1、7.2 |

## 9. Jev 接入方式（候选实现，全部「待配置后验证」）

**已知情况**（来自公开资料，未经实测）：Jev 是 TypeSafe AI 的「System One」模型，用于软件内部的自动化判断，不生成文字。请求由一段待评估的 **state**（文本、JSON 对象或数组）和一组**类型化问题**组成；问题有三类：是非题、选择题（返回所选项、每个选项的概率和置信度，最多 255 个选项）、打分题（2～10 级的有序量表）。官网称延迟约 0.1 秒级、输入价格 42 美元 / 十亿 token，目前为早期体验。中文能力、数据保存政策、服务器所在地**资料中均未说明**。

**对应关系**：

| 微伴 | Jev |
|---|---|
| `PlanningRequest.features` + `summary`（经出境净化器） | `state`（JSON 对象） |
| 每个决策 / 是非题 | 一个 choice 或 yes/no 问题；选项标签用英文代码 + 中文说明 |
| `confidence` | Jev 返回的 confidence（直接使用，不换算） |
| `reason` | Jev 不生成文字；理由由代码按「最高概率选项 + 起作用的特征」拼成固定格式（如「voice:yes p=0.81；userMsg.isVoice」） |

**接入步骤**（总经理申请到账号、管理员录入密钥之后）：

1. 架构完成 CR-18；管理员把 Jev 登记为上游、在模型目录登记为模型（`billing.md` 10.2 第 3 条），价目表录入售价。
2. 只开放给**不涉及健康和成人模式**的决策类型：`reply_form`（非成人会话）、`reply_timing`、`quirk`、`proactive_slot`、`call_slot`、`moments_plan`；`play_slot` 不接 Jev（经期时机必须留在国内）。
3. 按 `eval-plan.md` 3.16 做对比评测：中文情境理解、盲评合理性、延迟、费用、稳定性；结果写 `docs/ai/eval-runs/`，总负责人据此决定是否切换（PLAN-03 第 3 条）。
4. 切换前跑一遍人设稳定检查（PLAN-02 第 3 条、CHAT-14 第 2 条「平台层改动」）。

**需要拿到账号后确认的事**（待配置后验证）：中文 state 的理解效果；接口地址、鉴权方式、请求 / 响应字段的正式名称；计价方式（按输入 token 还是按次）；数据是否用于训练、保存多久、服务器在哪个地区；早期体验的调用频率限制。若数据政策不能接受（例如默认用请求数据训练且无法关闭），按 PLAN-03 第 5 条上报总负责人，不接入。

## 10. 参考来源

- TypeSafe AI 官网（Jev 定位、延迟与价格自述、早期体验）：https://typesafe.ai/ （2026-10-05 访问，数据未核实）
- Spring 博客「Spring AI and TypeSafe Jev: Fast, Cheap, Structured Decisions」（state + 类型化问题、三类问题、置信度 0.35～0.70 视为需复核、无流式）：https://spring.io/blog/2026/09/21/spring-ai-typesafe-structured-judgment
- 搜索结果摘要（选择题最多 255 个选项、置信度由概率分布形状得出、约 300 毫秒）：https://www.requesty.ai/blog/typesafe-jev-explained 、https://benchlm.ai/blog/posts/what-is-jev （第三方文章，未核实）

## 11. 修订记录

| 版本 | 日期 | 修改 | 修改人 |
|---|---|---|---|
| 1.0 | 2026-10-05 | 首版（T-022） | ai-lead |
