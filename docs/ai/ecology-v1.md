# 角色生态 v1：实现说明

> 依据：`docs/refactor/17-ecology-settings.md`（用户可见设置与动作清单的唯一定义处）、`docs/refactor/16-membership-v5.md` §4（收费）、`docs/product/input/2026-10-18-gm-ecology-vision.md`（目标形态）、`docs/backend/model-routing-ecology-plan.md` 块 B/C。
> 本文只说明「代码怎么做的」，不重复上面文档里的产品规则。批次：v5 批 C（2026-10-20），契约 3.19，迁移 0109–0111。

## 1. 一句话

角色每天按「活跃程度」醒来几次；每次醒来，服务器把这个角色和你的近况拼成一份**快照**交给后台配置的**决策模型**，模型从「此刻合适且开着的动作」里挑一个（或不动），服务器调用现有模块**真的执行**，同时把模型写的一两句**碎碎念**加密存下来给你看。

## 2. 开关与闸门（`application/ecology-settings.ts`）

| 层 | 存哪里 | 默认 |
|---|---|---|
| 总开关、活跃程度、关掉的动作、首次说明已读、积分不足暂停 | `ai_runtime.ecology_settings` | 关 / 时常出现 / 全开 |
| 每个角色一个开关 | `ai_runtime.ecology_character_settings`（没有行 = 开） | 开 |
| 平台参数：决策模型、四档次数、平台关掉的动作、唤醒时段、决策最大输出 | `ai_runtime.ecology_config`（一行 `default`，后台改） | 决策模型 **未配置**；四档 1–2 / 3–5 / 6–9 / 10–15 |

`isActive(userId, characterId?, action?)` = 账号正常 + **PRO+（统一用 `IdentityMembershipReadPort.isProPlus`）** + 总开关开 + 没有因积分不足暂停 + 角色开关开 + 动作开关开且平台能执行。

所有「角色自己做、扣用户积分」的旧流程都先过这道闸门：

| 旧流程 | v1 处理 |
|---|---|
| 主动消息规则排期（节日、纪念日、约定跟进、久未联系、日常分享、作品分享、提议领养） | **停用**（`LEGACY_RULE_CANDIDATES = false`），这些信息改为进快照由决策模型挑；推演事件发布到时间线保留 |
| 角色主动来电（PRD P-10 / MED-07 主动部分）与 L3「能不能给你打电话」 | **停用**（`calls.consider` 不再调用；`PROACTIVE_CALLS_ENABLED = false`）。用户主动打给角色不受影响 |
| 经期关怀（health-care） | 保留原流程（隐私规则更严），开关 = 动作 `care_period`；旧「主动消息」开关与免打扰不再适用 |
| 心愿提议 / 纪念日寄信等经调度器登记的计划 | 按动作开关放行（`play_wish` / `play_letter`）；安全关怀跟进平台承担，不受影响 |
| 推演（日常事件）、共同事件、「你不在时」摘要、每周名场面、卡片一句话 | 只给生态开着的用户 + 参与的角色做 |
| 朋友圈：私人发圈 | 规则排期停用，改为生态动作 `moment_post` |
| 朋友圈：角色给你的动态点赞评论 / 角色之间互评 / 角色之间接话 | 分别按 `moment_interact` / `moment_peer` / `moment_reply` 放行 |
| 朋友圈：你评论角色动态 → 角色必回 | 不变（用户发起） |
| 群里自己聊（规则排期） | 停用（`LEGACY_SELF_CHAT_SCHEDULE = false`），改为生态动作 `group_talk`；节日拉群只给 `group_talk` 开着的用户 |
| 官方角色公共朋友圈 | **保留且改为平台承担**：每角色每天生成一份文字（`ai_runtime.public_moment_drafts`），所有用户共用；素材只用角色层面的（公开动态 / 节日 / 人设小感受）。自定义角色没有公共朋友圈 |

## 3. 循环（`application/ecology.ts`）

1. `ai.ecology_tick` 每 10 分钟（3、13、23… 分）给开着生态的用户入队 `ai.ecology_user`。
2. 每个参与的角色按「用户 + 角色 + 日期」稳定算出当天唤醒时刻（唤醒时段等分、段内随机）。只跑**最近一个已到点、还没跑过**的时刻（`ecology_runs.run_key = slot:{日期}:{序号}` 去重），错过的不补；每个用户每次最多唤醒 2 个角色，避免一起冒出来。
3. 快照（约 3k token）：当前时间与星期、人设、关系与熟悉度、最近 12 条聊天与「你发了还没回几条」、对方上次来聊、记忆（日常范围、不含健康隐私、约定带时间）、今天的日子（节日 / 生日 / 纪念日 / 认识第几天）、TA 今天的生活（推演）、朋友圈（自己的动态与没回的评论、你没互动过的动态、朋友的动态，带编号）、所在的群、自己的状态签名、今天已经做过的事、积分是否偏少、**这次可以做的动作**。
4. 「这次可以做的」按此刻过滤：你 5 分钟内在聊 / 已有 2 条没回 → 不给聊天类；早晚安只在早晚；催睡只在深夜且你还活跃；久未联系 ≥ 72 小时；日子提醒只在有特别日子；跟进只在有约定；表情 / 链接要角色有素材；签名 3 天内改过不再给。熟悉度 < L3 时提示不要「在干嘛 / 想你了」这类空话（总负责人 10-20 补充：保留 SIM-05 第 7 条的熟悉度门槛，频率按活跃程度走）。
5. 决策：`behavior_planning` 用途 + `modelKeyOverride = 后台决策模型`，`ecologyTask` + `countAsBackground`，JSON 输出 `{action, brief, target, text, murmur}`。**未配置决策模型时不运行**，不回退任何用户模型。
6. 执行器（复用现有模块）：

| 动作 | 执行 |
|---|---|
| message / greeting / care_anniversary / care_absence / care_late_night / care_follow_up | `ProactiveSchedulerService.sendEcology`：沿用主动消息的生成、守卫、发送事务（聊天模型按人设写），不进旧的主动消息账本 |
| voice / photo / sticker / share_link | 同上，附加语音合成（`MediaAiService.synthesizeForEcology`）/ 图片（`CharacterImageService`）/ 库内表情 / 作品链接 |
| nudge | 发拍一拍（不调模型、不扣费） |
| play_wish | 交给已登记的心愿提议处理器（每周最多一次） |
| moment_post | `MomentsAiService.postForEcology`（私人朋友圈） |
| moment_interact / moment_peer / moment_reply | `MomentsAiService.reactForEcology` |
| status / signature | 决策输出里直接带文字，存 `ai_runtime.ecology_profiles`（只对该用户可见） |
| group_talk | `GroupChatService.startTopicForEcology`（同自发话题链路与上限，不推送） |
| care_period | 走 health-care 自己的流程（不进决策工具） |
| care_weather、play_letter、play_focus、play_daily_question、play_pet、play_reminder | **留口子**（界面置灰「即将上线 / 暂无天气数据」） |

7. 记录：`ai_runtime.ecology_runs` 一行（状态、动作、结果、模型、本次合计扣费、耗时），碎碎念按用户密钥加密（ADR-0027 信封加密），管理端看不到。

## 4. 说到做到

- 动作执行失败时，碎碎念换成中性一句「想了想，还是算了。」，灰字写「想做点什么，没做成」，不保留可能声称已做的原文。
- 私聊回复的动态结尾加一段（`EcologySettingsService.replyHint`，reply-context 调用）：不许声称发了朋友圈 / 改了签名 / 拍了拍、不说「一会儿打给你」；识别到你让角色「发朋友圈 / 拍一拍 / 改状态 / 改签名」时告诉模型系统会不会真的做。语音、照片、链接本来就由回复流程执行（media-ai），不在此列。
- 用户要求的动作：`chat.message_created` 识别 → PRO+ 且积分不缺且平台能执行 → 90 秒后（回复发出后）执行，**不受生态开关限制**，按次扣积分，记为 `user_request`。

## 5. 计费

- 每次唤醒（决策）和每个动作都经网关冻结 / 结算（`ecologyTask = true`），不透支；扣费先扣赠送积分（批 A）。
- 网关返回积分不足 → 该用户生态静默暂停（`paused_reason = insufficient_balance`），billing 已有的「下次打开 App 提示一次」照常；`billing.balance_restored` 自动恢复。
- 碎碎念下的积分 = 决策 + 文字 / 语音 / 图片 / 评论 / 朋友圈的实际扣费合计。**拿不到的两项**：群里说话（各条消息自己记费）、心愿提议（登记方自己发送），这两项碎碎念只显示决策那部分。
- 设置页「约每天 X 积分 / 角色」= 平均唤醒次数 × 每次唤醒花费；每次唤醒花费 = 最近 7 天全平台生态唤醒平均实扣（样本 ≥ 20），否则按决策模型报价 × 2.5 估。

### 成本粗估（以后台配置的便宜决策模型为例）

| 项 | 量 | 说明 |
|---|---|---|
| 一次决策 | 输入约 3,000–3,500 token、输出约 150–300 token | 快照随聊天和朋友圈多少浮动 |
| 发一条消息 | 再加一次聊天模型调用（约 2k 输入 / 100 输出） | 同旧主动消息 |
| 发朋友圈 / 评论 | 再加一次后台模型调用（约 1–2k 输入） | |
| 公共朋友圈 | 每个官方角色每天 1 次，平台承担 | 与用户数无关 |

16 号 §4 的粗估（每次想一想约 1 积分、真发朋友圈 2–5 积分、每角色每天 10–20 积分）以实际决策模型价格为准，上线后看后台「最近 24 小时」与运行记录核对。

## 6. 接口

契约 3.19 `packages/contracts/src/http/ecology.ts`：用户端 `GET/PATCH /me/ecology`、`PUT /me/ecology/characters/:id`、`GET /characters/:id/murmurs`、`GET /characters/:id/ecology-profile`；管理端 `GET/PUT /admin/ai/ecology`、`GET /admin/ai/ecology/runs`。平台网关端口增 `moments` 用途（公共朋友圈）。

## 7. 已知限制

- 没有在真实数据库和真实模型上跑过（本机无数据库），决策提示词没有进评测集对比（新提示词，无改前基线）。
- 天气、慢信、专注、每日一问、宠物、记约定、其他角色发圈后的「角色之间」生态未接（工具口子已留）。
- 快照里不放经期内容（隐私），经期关心仍由 health-care 专门流程负责。
- 公共朋友圈按北京日期出一份，素材不含推演事件（推演是按用户的）。
