# 生态心跳：整理现状、提出候选、判断后才执行

2026-10-23。只读核查基线提交 `d4ea97ee4393803b22e94ca6a0458e5270b2a23e`。本轮只新增本文，不改 admin/model、model-access、contracts 或其它业务源码，不改数据库/配置、不切生产决策、不降低门槛、不调用供应商模型。开发分析，不是独立质量验收。

## 1. 先说结论：用户理解对，能实现

**角色每次活跃心跳先看看现状，想出可能做的事，再让决策模型判断现在做不做、选哪件；主动消息和朋友圈都走这个过程，允许什么也不做或延后。这是合理且可实现的需求。** Jev 现有证据的局限不等于这件事不能做，只说明不能把未验收线路当成已经上线的完整决策脑。

通俗比喻：心跳是“闹钟”；状态整理是“秘书做简报”；生成模型是“角色写几张提案卡”；代码是“保安先检查资格和预算”；决策模型是“主管从合法提案里选一项或不批”；执行器才是“真正发消息/发朋友圈的人”。闹钟响不等于必须发消息，随机安排醒来时间也不等于抽签强发。代码负责确定事实、权限、精确配额，模型负责情境上的合适与否，不能相互替代。

## 2. 当前已经有的基础，以及尚未接上的一段

- [生态调度:189–259](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L189-L259)：十分钟扫描，按角色活跃档位的到点时刻唤醒，每次最多两个角色，`runKey` 去重，错过旧时刻不补。不是十分钟给每个角色强发一条。
- [活跃档位及醒来时间:285–330](../../apps/server/src/modules/ai-runtime/domain/ecology.ts#L285-L330)：默认四档每天 1–2 / 3–5 / 6–9 / 10–15 次，时刻稳定打散；这是唤醒分布，不是动作执行概率。
- [快照与工具裁剪:700–924](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L700-L924)：整理日常记忆、日期、推演、最近朋友圈及待回复评论、群、今天做过什么、余额提示；裁掉关闭、忙聊、未回消息过多、素材/目标不足等动作。朋友圈不是主动作决定后的附属抽签，`moment_post` 本身就是候选动作。
- [现有模型调用:331–410](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L331-L410)仍然是一次 `generateText`，生成 `action/brief/target/text/murmur` JSON 后直接进入执行；允许 `none`，无效输出或未提供工具不执行。[当前系统提示:1165–1172](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L1165-L1172)明确只能选一个动作或 none、克制、不假装已做。这不是纯概率强发，但**还没有“提案后再由 DecideChoice 审批”的独立一层**。
- [执行器:458–523](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L458-L523)把主动消息送到 `sendEcology`，朋友圈送到 `postForEcology`。模型写“发了”不等于成功，仍必须拿执行回执。

“延后”目前可表现为本次 none/idle、下次醒来重看；没有证据证明已有模型指定延期时刻的持久任务。要实现 defer，也应由代码决定下次允许评估的时间，不能让模型任意制造高频闹钟。

## 3. 两个实际测过的条目，不是两代模型

优先核对了[脱敏完整记录](eval-runs/2026-10-21-jev-full.jsonl#L1-L29)和[实测报告](eval-runs/2026-10-21-planner-jev.md#L19-L50)。随后仅为确认名称/上游 ID，通过既有 SSH 身份查询生产非密元数据：`BEGIN READ ONLY`，仅明示 `model_catalog` 列及 `upstreams.kind/status`，限定两个 model_key；未取凭据、私聊、调用原文或 `SELECT *`，未读 `secret_ciphertext` 本体。

| 项目 | 固定条目 | latest 条目 |
| --- | --- | --- |
| 生产显示名称 / vendor_name | Jev / Jev | Jev / Jev |
| model_key | `jev/jev-1.13.0` | `jev/jev-latest` |
| 生产 upstream_model_id | `jev-1.13.0` | `jev-latest` |
| upstream.kind / status | `openai_compatible` / `active` | `openai_compatible` / `active` |
| 本地历史实测 resolvedModel | `jev-1.13.0` | `jev-1.13.0` |
| 本次查到 enabled / system_message_mode | true / multi | true / multi |
| capabilities / tags / default_for / scenarios | 均空数组 | 均空数组 |

所以“两个配置条目”是事实，**“两代能力比较”不是事实**。固定版本与 latest 是两个 ID；10-21 实测时解析为同一个版本。现在没有重新付费调用，不能保证 latest 今天仍解析到相同版本；本次查询也不是历史显示名称的快照审计。

### Prompt 预设到底差在哪

[评测源码:55–91](../../apps/server/src/modules/model-access/application/decision-evaluation.ts#L55-L91)对两个条目使用完全相同的场景、问题和预设，没有分别给“新版/旧版”不同人设。每请求并行三个独立问题：

1. Choice：`act/defer`。中文题为“现在是否适合执行 state.action？act 表示适合，defer 表示不适合、缺少条件或不确定。严格遵守用户意愿、隐私与不重复搜索约束。”英文是对应译文。
2. Noul：现在执行这个动作是否适合（yes/no）。
3. Score：按上下文评估合适程度，三级“不适合/不确定/适合”。

state 只有合成标识、动作名、该语言场景。完整样本每条目六场景中英各一题，再重复两题；场景覆盖语音忙闲、公开资料新旧、公开海报/私人自拍。[调用源码:127–150](../../apps/server/src/modules/model-access/application/decision-evaluation.ts#L127-L150)只随条目更换线路和上游模型 ID；未读取模型专属 prompt 预设。对比的主要差异是 model ID 别名、运行时返回的概率与延迟，不是预设差异，也不能把少量差异归因于“换代”。生产系统消息模式两者相同，但评测走 Decisions 协议，不是聊天 system 消息拼接。

协议里 [prompt → instructions、options → criteria](../../apps/server/src/modules/model-access/infra/jev-adapter.ts#L42-L69)；B.AI 是 `/decisions`，原生 Jev 是 `/v1/systemone`，不是 `/v1/judge`。这不能产生自然语言提案或 murmur。

## 4. generateText → DecideChoice 的具体桥接（建议，尚未实现）

仓库实际契约名称是 [DecideQuestion/DecideInput/DecideOutput:351–377](../../packages/contracts/src/ports/model-gateway.ts#L351-L377)，choice 是 `kind: 'choice'`，不是另一个已经接好的 `DecideChoice` 方法。建议不改共享契约，先在 ai-runtime 内做受控桥接：

1. **心跳 → 单一快照。** 记录 runId、上下文版本和当时资格；先做最低成本硬过滤。没有任何合法主动动作就直接 idle，不付费“想一想”。
2. **生成意向。** 仍由角色的生成模型理解人设/关系，输出少量提案（建议最多三张），每张含动作、目标、简短意图/必要参数、关联事实；也允许零提案。先不发送、不宣称已执行。现有 JSON 只支持一张意向，不能假装多候选已实现。
3. **代码二次裁剪。** 把提案与本次 tools 白名单相交；验证目标、去重、冷却、权限、预算、隐私和公开事实。将可出境的安全语义描述映射到稳定候选 ID；原始私聊、完整记忆、人设秘密、健康/私密内容不直传 Jev。沿用并扩充[现有净化器边界:528–544](../../apps/server/src/modules/ai-runtime/application/planner.ts#L528-L544)，不能仅把整个 snapshot 改名 state。
4. **一次窄 choice。** 以 `purpose: behavior_planning` 调 `media.decide`，options 为候选 ID 加 `none`、`defer`，prompt 给出每个候选的完整可理解描述，询问“此刻最值得做哪一件；无合适选 none，时机/信息不足选 defer”。多个候选同题竞争，避免分别得到几个 yes 后全执行。独立事实判断如有必要可同次批量，但不能让同批后题依赖前题结果。[现有 callJev:490–524](../../apps/server/src/modules/ai-runtime/application/planner.ts#L490-L524)可复用 deadline、幂等、后台费用字段的做法。
5. **代码解释答案。** 校验题号、候选成员、概率、置信度、模型版本；返回候选 ID 才能取回本地参数。不能把 `choice` 字符串硬塞进现有 EcologyDecision，也不能编造模型未返回的 brief/murmur。低置信/none/defer 都不执行；沿用现有门槛，不靠调低 0.55 让系统热闹起来。不同问题/语言的后续校准须先验收。
6. **执行前最后复核。** 重查开关/余额/上下文版本、未回主动消息、目标存在与频控，原子领取 actionId 后最多执行一项；主动消息与朋友圈使用同一批准链，实际正文仍由各自生成/执行器处理。情势变化则弃权，不重放旧批准。
7. **记录回执。** 区分 approved、idle、deferred、failed、done；碎碎念不得谎称已执行。defer 是下一次合规唤醒重评，不立即自循环或保证稍后必发。

私密/健康情境不能因新增选择层被绕道出境；当前私密唤醒走专用模型的[分支:343–367](../../apps/server/src/modules/ai-runtime/application/ecology.ts#L343-L367)要保留。无合规决策路径时本次自主动作不执行；这不等于停止用户正常聊天。用户明确要求发朋友圈另走已授权指令执行链，不必额外问模型是否“同意”。

## 5. 成本上限与故障不执行

**提议的次数硬上限**：每次合法唤醒最多 1 次意向生成 + 1 次批量决策，最多 1 项主动动作；若动作需要正文，最多再 1 次正文生成。单次不自动重试，不双模型投票，不因为 none/defer 再追问。无候选为 0 次。公开搜索、语音等有额外费用的工具各自通过既有独立预算和资格，不计作“只有一次正文所以免费”；多人搜索费用沿用已有分摊链，不在此手工扣款。

**金额上限不是 token 平均价**：每次请求先用核准路由的最坏输入/输出、阶梯价/附加费算冻结额，各阶段冻结额总和不得超过本次剩余后台预算、单次许可上限和用户余额中的最小值。未能核定任一阶段上界就不调用；执行阶段再冻结/核验，不透支后补。每日上界为有效唤醒数乘单次限额，并受用户总后台日预算截断；不是每个角色各自绕开用户预算。已有意向输出默认 500 token，但不是整条链的金额封顶。

**本轮没有可据以承诺具体积分数字的完整有效路由价格/预算证据**，不把历史约 $0.00062832 的参考估价写成生产套餐价格。上线配置应登记明确微元限额和核准报价后验收，不用本文虚构数值或现场改配置。

生产本次两条目 `billing_bounds` 均只有 text（128000 context / 8192 max output / maxImages 0），没有目录级 decision 上限；[网关:456–461](../../apps/server/src/modules/model-access/application/media-gateway.ts#L456-L461)要求有效 `decision` 上限，否则拒绝。但[计费证据服务:36–62](../../apps/server/src/modules/model-access/application/billing-bounds.ts#L36-L62)优先用 `model_routes`；本轮未获授权扩大查询该表，**不能仅凭 catalog 断言当前有效路由必不可用，也不能反过来声称用户网关计费已验收**。历史 J 直连适配器绕过用户网关，不能填补这一缺口。

故障原则：超时、熔断、欠费、预算不足、输出无效、候选消失、低置信、上下文过期、隐私不满足都停止本次主动动作；已发生的真实费用如实记账，不假称失败免费。不得退到概率抽签强发。[前次澄清:69–74](2026-10-22-decision-and-sticker-clarification.md#L69-L74)说明现有 Planner 错误会退规则、规则仍可能抽签；因此新桥接不能不加区分直接套用该回退行为。必须明确使用 no-action 安全回退，且不能借本方案改掉未授权的其它回复路径。

## 6. 哪些未验收，下一步最小工作是什么

历史为 4 次冒烟 + 28 次完整请求，共 32 次，不是 96 次；两条目各 14 条完整样本 Choice 标签为 13/14、12/14，各有 6/14 confidence < 0.55。中文公开资料题概率接近一半、海报中英文选择不一致；概率不是可靠程度。完整限制沿用[原报告:31–50](eval-runs/2026-10-21-planner-jev.md#L31-L50)：小样本不代表通用中文准确率，未完成 60 道中文题、100 对盲评、1000 次延迟、7 天稳定、出境/隐私政策、真实资金/并发验收；未核供应商账单。两条目同实际版本，更不能当两代 A/B 胜负。

后续推荐单独窄任务：先实现本地提案/选择桥接及无执行影子记录，覆盖 none/defer、过期快照、重复执行、低置信、预算不足、私密隔离与朋友圈/消息统一审批；合成中文候选题通过后，另按授权验收真实线路与计费，最后小范围开关切换。**目标是判断得合适，不是提高强发数量。** 当前合理需求已明确，不需要再让用户为“能不能想一想再决定”重新辩护。

本轮验证方式：只读源码/脱敏评测记录、一次成功的生产明示非密元数据查询；首次 SSH 命令因分隔符 shell 引号报错、未进入 SQL，修正后成功，无付费请求，无测试/部署声明。唯一新增文件为本文。

## 已实现：候选动作到决策的纯规则（未接线）

按上面的职责划分，已把「做不做」的硬规则写成代码：[规则](../../apps/server/src/modules/ai-runtime/domain/ecology-decision.ts)。

1. 系统先做确定性拦截——免打扰时段、每日上限、预算不足，不交给模型去「悟」。
2. 决策模型只能在**过滤后的候选**里挑一个，或明确说「现在不做」。
3. 模型选了不存在的动作、超预算的动作，或置信度低于 0.55，一律拒绝，**不会顺手换一个发出去**。
4. 没有模型参与时，按紧急度确定性兜底，同一输入结果固定，不会随机发。

7 条单元测试通过（免打扰跨零点、上限、预算、模型选择合法/越界/低置信度、无模型兜底、结果确定性）。**尚未接入真实心跳与执行链路**，真实发送前仍需再核一次预算与频率；线上行为不变。
