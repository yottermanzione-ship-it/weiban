# 决策模型与自主表情：只读核实及范围澄清

2026-10-22。只读核实人：本轮专项子代理。被核源码提交 `9f9b23b7d0949f5a20335d6f4677d1f9977054d0`，工作分支 `codex/web-feedback-20261022`。本次只新增本文，不改业务、契约、线上配置，不调用付费模型、不部署、不构建 APK。结论来自源码、已保存脱敏实测证据和交接记录；没有重跑测试或读取生产数据库，不能当作真机/端到端验收。

## 一、给用户的通俗结论

1. **之前确实做过真实请求，不只是写了调研或用假模型演示。** 有 4 次冒烟和 28 次完整样本，共 32 次供应商请求成功；但只证明这条调用线路能用，以及这几个合成场景的表现，不证明角色已经能稳定地自主作出正确决定。
2. **Jev 与预留的“做选择题”接口比较吻合；与“像角色一样想一想、写动作参数和碎碎念”的生态接口不是同一回事。** 不能因为传输和返回格式接通，就直接替代生态生成模型。
3. **“合适的时候自己发个表情、不频繁”已有发送链路，但只能判为部分符合。** 普通回复已有概率和窗口限制；生态自主表情另有入口，却没有看到与普通回复共用的表情比例硬闸。默认规则仍是抽签，选具体表情也只是字面匹配，不宜说已理解情境、已全面达标。
4. **没有证据证明生产已切到 Jev。** J 交接明确没有改线上 planner_config，10-22 发布记录也明确没有自动切 Jev。本次未查生产当前配置，因此既不能说“现在已经用 Jev”，也不能凭源码默认值断言“生产现在全是规则”。
5. **这轮用户要的是自主表情，不是泛泛找网图，更不是自动生图。** 图片理解、公开作品资料检索、角色分享图片、虚构生活照/自拍是不同场景；不能把其中一个的历史授权自动扩展到其它场景。

## 二、32 次实测与规则/模拟测试要分开

| 证据 | 确切含义 | 不能据此声称 |
| --- | --- | --- |
| [冒烟证据](eval-runs/2026-10-21-jev-smoke.jsonl#L1-L5) + [完整证据](eval-runs/2026-10-21-jev-full.jsonl#L1-L29) | 4 + 28 次供应商请求，每次有 Choice、Noul、Score 三题；是 32 请求，不是 96 请求 | 真实用户聊天、用户结算和完整生态链都经过验证 |
| [J 最终测试日志](C:/wb-dev/logs/j-tests-final.txt#L2-L8) | 当时 model-access rules 套件 27 条通过 | 另有 27 次真实供应商实测 |
| [发布专项日志](C:/wb-dev/logs/release-last-service-tests.txt#L2-L8)及[发布记录](../handoffs/2026-10-22-consolidated-release.md#L48-L58) | P3 服务及搜索等两文件 32 条测试通过，是另一组软件测试 | “32 条通过”就是 J 的 32 次付费调用，或 Jev 准确率 100% |

真实调用可复查依据：

- [评测执行代码](../../apps/server/src/modules/model-access/application/decision-evaluation.ts#L95-L173)只读取得两个指定条目的线路，在容器内解密既有凭据，直接调用 HTTP 适配器，逐条输出白名单结果，最后清零可变密钥缓冲；没有走用户网关结算。
- [报告](eval-runs/2026-10-21-planner-jev.md#L11-L19)登记实际执行源码 `96bec71e7a068ceaa85430c59ff920853c84ea89`，容器独立进程、只读数据库连接、合成输入、无用户积分扣费/应用用量记录。供应商可能计费，不能说“测试完全免费”。
- 本次重新核对两份 JSONL 的 SHA256，与报告一致：full `91dcfc78c3b67137c6f0af288a53f484ee39bebf43f4e5d2cd998923476b5954`；smoke `3bf0d13bd2c4282fa2a02cc3ff95afd7d2c55416ee3906be5b8a1e1301ec41f8`。
- 证据保存的是脱敏结果，不含原始 HTTP 正文、request ID 或传输头。因此可确认“仓库执行记录和结果支持真实调用”，不能把它提高为供应商账单独立审计。本轮没有索取或展示任何凭据。

### 实测究竟得出了什么

[统计与限制](eval-runs/2026-10-21-planner-jev.md#L19-L50)：完整样本两条目各 14/14 请求成功；Choice 标签分别 13/14、12/14 与预设答案一致。两条目实际都返回 `jev-1.13.0`，不是两代模型比较；各有 6/14 的 Choice confidence 小于现有 0.55 门槛。中位耗时 465/489ms、样本 P95 607/633ms，仅是小样本描述。

反例比“成功率”更重要：[公开资料中文题](eval-runs/2026-10-21-jev-full.jsonl#L6)选 act，概率 0.51、confidence 0.02；[latest 同题](eval-runs/2026-10-21-jev-full.jsonl#L20)反而选 defer、confidence 0.06。海报题中文多选 act，英文却选 defer，且置信度都低。**选中的概率不等于可靠程度；HTTP 成功不等于语义正确。**

32 次含冒烟共 14960 输入 / 2005 输出 token；官方输入参考价估算约 $0.00062832，不是供应商扣款对账。本批没有表情适配专门题，没有直接证明“表情此时合适”。60 道中文题、盲评、1000 次延迟、7 天稳定性、50 次出境金丝雀、数据保存/训练政策、真实资金/并发等正式闸门未完成；不能为提高触发率直接降低全局门槛。

## 三、与预留接口匹配到哪一层

| 层次 | 核实结果与证据 |
| --- | --- |
| HTTP 协议 | [适配器](../../apps/server/src/modules/model-access/infra/jev-adapter.ts#L34-L69)：既有 B.AI openai_compatible 账号的决定调用走 base + `/decisions`；原生 jev 走 `/v1/systemone`。旧推测 `/v1/judge` 不成立。32 次实测证明的是 B.AI 线路；原生 System One 路径的源码/模拟覆盖不等于原生供应商也真实测过。 |
| 请求 schema | question ID map；prompt → instructions；choice options → criteria；yes_no → Noul；scale → Score。不是让模型生成聊天文本，也不是 Chat Completions 的 tool_calls。 |
| 返回 schema | [解析器](../../apps/server/src/modules/model-access/infra/jev-adapter.ts#L80-L126)按 question ID 取答案，校验选项集合、概率总和、范围及非负 token。Choice/Score 用供应商 confidence；Noul 由 p 转 yes/no，并用 `abs(2p-1)` 作本地裕量。 |
| 原有端口兼容 | [契约](../../packages/contracts/src/ports/model-gateway.ts#L351-L377)已有 state、questions、choice、probabilities、confidence；[网关](../../apps/server/src/modules/model-access/application/media-gateway.ts#L432-L525)把 scaleSize 传成级数。旧端口没有连续 score，返回概率最高的等级索引，**不是无损保留连续评分**。 |
| Planner 选择题 | [callJev](../../apps/server/src/modules/ai-runtime/application/planner.ts#L490-L545)只问一个 choice 题，消费选项与 confidence；代码负责净化和执行。此层结构匹配。理由为代码拼出的标签/概率，不是 Jev 写的自然语言理由。 |
| 生态动作/工具 | [生态执行](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L331-L410)目前调用 generateText，要求 [action/brief/target/text/murmur](../../apps/server/src/modules/ai-runtime/domain/ecology.ts#L339-L358) JSON；然后校验是否为本轮 offered tools。**这不是 Jev DecideOutput**；“工具”在这里是给生成模型看的动作说明加执行白名单，不是已验证的 Jev 原生函数调用。 |
| 产品正确性 | 传输匹配、schema 匹配不等于中文准确、校准、人设、隐私政策、结算都达标。符合的下一步结构是[25号方案](../refactor/25-jev-ecology-decisions.md#L7-L15)的“生成模型提出意向→代码裁候选→Jev 窄判断”，不能把建议写成当前已实现。 |

[planner 默认值](../../apps/server/src/modules/ai-runtime/application/planner.ts#L586-L619)为 rules，但会读取数据库逐类型配置；[切换代码](../../apps/server/src/modules/ai-runtime/application/planner.ts#L641-L669)要求报告编号和模型。平台目录默认 planner、planner_config 逐类型配置、ecology_config.decisionModelKey 是不同选择入口。仅模型目录里存在 Jev 条目，不能说明这些入口实际选了它。

## 四、自主表情的现有链路

### A. 普通私聊回复附一个表情

1. [reply-engine](../../apps/server/src/modules/ai-runtime/application/reply-engine.ts#L290-L323)：仅普通日常消息，非关怀、非试用、非撤回/错字玩法时进入 planExtras；树洞传 quiet，禁止附表情。私密模式不走此回复附加入口。
2. [media-ai](../../apps/server/src/modules/ai-runtime/application/media-ai.ts#L514-L550)：先检查最近角色气泡窗口，再向 reply_form 提供 `no_sticker / keep_sticker`。低置信度的保守选项是 no_sticker。语音成功会提前返回，已附图片/作品链接的回复也不再附表情。
3. 名义频控是每 10 条角色气泡最多 2 个；[规则概率](../../apps/server/src/modules/ai-runtime/application/media-ai.ts#L63-L71)是每次符合条件回复 15% 稳定抽签，**不是每 10 条必发 2 个、不是每 10 分钟发 1 个，也不是基于情境的规则理解**。上下限检查在规划阶段，不是数据库发送事务内的统一原子配额；本次未验证并发/历史读取失败等情况下的硬上限。
4. [素材入口](../../apps/server/src/modules/media/application/assets.ts#L836-L863)：仅启用素材包，包角色名单为空（通用）或包含当前角色；表情未删除、媒体 ready。不是用户个人收藏、不是任意网络图片、不是自动生成新表情。
5. [选表情](../../apps/server/src/modules/ai-runtime/application/media-ai.ts#L662-L685)：比较描述字符与回复字符的重合量；无重合时稳定随机。无需额外识图/生图调用，但可能选到情境不合适的图，不能称已做表情语义校准。
6. [真正发出](../../apps/server/src/modules/ai-runtime/application/reply-engine.ts#L707-L740)：将 sticker 作为 MessageContent 写入既有发送链，带幂等键、scope 和当前上下文/记忆版本检查，不只是在日志里“决定了”。本次没有真机验证最终收到。

### B. 角色没有被问时，生态醒来选择发表情

1. [契约](../../packages/contracts/src/http/ecology.ts#L14-L22)的 sticker 与 photo 是两个独立动作；[设置契约](../../packages/contracts/src/http/ecology.ts#L85-L100)有总开关、角色开关、动作开关、PRO+ 资格及运行资格。
2. [生态调度](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L217-L253)按活跃档位安排唤醒，每次最多唤醒两个角色，去重 runKey；不等于每次唤醒都必须发表情。[工具裁剪](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L853-L906)在无库表情时不提供 sticker；动作关闭、用户忙聊或未回主动消息达到限制也裁掉。
3. 忙聊阈值 5 分钟、未回主动消息阈值 2，见[常量](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L96-L120)。这些是聊天类动作总体约束，不是表情专用最短间隔/每日表情硬上限。
4. [动作执行](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L458-L489)→ sendEcology → [pickStickerForEcology](../../apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts#L1289-L1296) → [事务发送](../../apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts#L1406-L1433)。仍是库内同一选图逻辑。
5. **缺口：生态 sticker 候选和执行没有调用普通回复的 10 气泡/2 表情检查。** [sendEcology](../../apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts#L394-L446)明确不进旧主动消息账本；不能把旧主动消息日上限或普通回复窗口套用给生态独立路径。因而不能保证两条路径合起来表情不频繁。

### 计费与失败时怎么办

- 普通回复的表情素材读取/选择/发送本身没有新供应商调用；rules 决策免费。选了 rules_model 或 Jev 则[规划调用](../../apps/server/src/modules/ai-runtime/application/planner.ts#L422-L442)、[Jev 调用](../../apps/server/src/modules/ai-runtime/application/planner.ts#L499-L510)归用户 `behavior_planning`；reply 不计后台预算，proactive 则计后台并标 ecologyTask。不能把“素材免费”说成所有自主表情过程都免费。
- 生态这次想一想的 [generateText](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L340-L361)是用户付费且计后台；[主动正文生成](../../apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts#L1170-L1179)也有用户费用，库表情不另收生图费。实际花费取运行/用量记录，不把 J 测试参考美元价当用户积分。
- Planner [低置信度](../../apps/server/src/modules/ai-runtime/application/planner.ts#L348-L375)不附表情；错误、超时、没钱、成本闸和熔断退规则。**退规则不是一律不发**：15% 抽签仍可能附表情，受当前可见窗口限制。素材缺失/异常时普通回复保留文字；生态表情找不到时该动作失败，不伪称发出。
- 生态不是同一个置信度机制：没有配置模型就跳过，模型失败/输出无效就停止，未提供的动作不执行；不能把 Planner 的 0.55 自动套到所有生态 action JSON。

### 是否满足用户意图

**有可复用基础，尚不宜报“完全满足”。** 用户不需要先指定表情，现有代码确实能自主选、取库素材、走消息发送。仍需单独登记的小范围缺口是：两入口统一频控与发送前复核、真正合适的情境/情绪选择、无匹配表情宁缺毋滥，以及可验证的低频体验。契约角色卡里虽预留 stickerPacks/stickerRate（[字段](../../packages/contracts/src/character-card.ts#L139-L140)），本次搜索 ai-runtime 没有发现消费，不能声称角色低/中/高表情偏好已执行。生态动作开关也不能据此推定控制普通回复附表情。**本次只报告，不改实现、不新增功能范围。**

## 五、图片场景哪些已存在，哪些仍要讨论

| 场景 | 本次范围判断 |
| --- | --- |
| 角色在合适时发已有表情 | 本轮核心。优先核清/补足上面的选择和频控，不依赖网上找图或生图。 |
| 用户发图，角色看懂并保存描述 | [H3 当前 render](../../apps/server/src/modules/ai-runtime/application/media-ai.ts#L208-L214)属于理解输入图片，与角色主动向用户发图不同。 |
| 输入图涉及公开作品，查资料帮助回答 | 25号文档保留 J 时“未启用”背景；[10-22发布记录](../handoffs/2026-10-22-consolidated-release.md#L15-L23)已登记 P3 另行确认并上线，属于后续进展，不应仍报“所有图片联网都未实施”。当前 [ImagePublicSearch](../../apps/server/src/modules/ai-runtime/application/image-public-search.ts#L20-L64)是受控公开线索检索，不是向用户泛泛发网图。 |
| 用户要求一张图 / 生态 photo 动作主动分享图 | 当前已存在 [PHOTO_REQUEST 路径](../../apps/server/src/modules/ai-runtime/application/media-ai.ts#L473-L503)及 [photo 动作](../../apps/server/src/modules/ai-runtime/domain/ecology.ts#L73-L87)。这说明已有实现，不说明它正好满足本轮“自主表情”要求或本次得到扩大授权。 |
| 随手发生活照、本人照片/自拍、作品海报、用户收藏图、宽泛“找图” | 意图、素材来源、人物身份真实性、隐私/版权、费用和主动触发边界不同，需要分别讨论；不能用一个“图片功能”囫囵代替。 |
| 真实生成新图 | [CharacterImageService](../../apps/server/src/modules/ai-runtime/application/character-image.ts#L70-L95)保留 generate 方法名，但当前此方法不调用生图；只在非真人、chat、显式 searchPublic 时对固定公开主题搜索，否则素材库回退。方法叫 generate、契约有 generateImage 端口，都不能证明当前发图是生图，更不构成本轮生图授权。 |

推荐交接措辞：**“之前模型确实测过，接通的是做选择题的接口；效果还不足以直接替代角色的全部决定。你说的自主表情已有基础，但低频与情境合适还没统一验证。我们先把这件事核清，图片的具体场景另外讨论，不擅自变成随便找网图或自动生图。”**

## 六、给主 agent 的边界

- DeepSeek、服务器配置与发布归主 agent；本文没有读取生产实时配置，不替其断言线上当前模型。
- 已保存真实请求与软件测试数量分别记账；后续新增模拟用例不能并入 32 次真实实测。
- 不把旧设计文档“默认规则+模型、占位保留、并行决策”的描述压过当前源码。当前 Planner 缺省 rules、planExtras 在文字确定后运行，生态生成 JSON 与 Jev 窄选择题分离。
- 后续若要补实现，另立窄任务和独立验证；本轮不改代码、不改阈值、不切模型、不扩大图片范围。
