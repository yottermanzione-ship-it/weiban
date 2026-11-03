# 交接说明：T-20261104a 用户触发的服务商拦截不影响上游账号；用户之间的拦截互不影响

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead + ai-lead（本任务由开发负责人兼任） |
| 日期 | 2026-11-04 |
| 分支 | `fix/upstream-isolation-20261104`（基于 origin/main 6256972e） |
| 任务卡 | `docs/tasks/T-20261104a-upstream-isolation.md` |
| 契约 | 不变（5.3）；`minClientVersion` 不动 |
| 迁移 | **无** |

## 结论

1. **上游账号不会再因为内容被拦而被打成不可用**：上游回 401 / 403、正文又不是已知的安全策略格式时，网关先用同一把密钥做一次连通测试（和后台「测试」一模一样）。测试通过，说明密钥没坏，这次只算「内容被拒」：上游状态不动，用户收到推托语。测试也失败，才按原来的逻辑标「密钥失效」。不管哪家服务商、用什么错误格式拦内容都成立。
2. **用户之间互不影响**：同一个用户 1 小时内私密回复被服务商拦 5 次后，接下来 1 小时内，他的私密回复不再发给服务商，直接回推托语、不扣费。只限制他一个人，别的用户照常。三个数字（5 次、1 小时、1 小时）只在 `product-params.ts` 定义一处，总经理可调。
3. 发版即生效，不需要手工操作，没有迁移。

## 1. 自检（总经理第 1 条）

**改在哪**：自检本身只有一处，`UpstreamService.keyStillWorks(upstreamId)`（`model-access/application/upstreams.ts`）。它用 `UPSTREAM_PROBE` 测试，和后台「测试」按钮是同一个探测：OpenAI 兼容调 `GET /models`，Anthropic 调 `GET /v1/models`。不产生费用。

**谁来问它**：

| 位置 | 作用 |
|---|---|
| `UpstreamService.reportStatus` | 网关（`source = 'gateway'`）要把上游改成 `invalid` 时先问；自检通过就不改。所有网关路径（文本、媒体、语音）把上游标 `invalid` 都只经过这里，是**兜底的唯一入口**。 |
| `UpstreamScheduler.recordFailure` | 文本网关累计失败、写暂停之前先问；自检通过就什么都不写（不累计失败、不暂停、不冷却线路）。 |
| 文本网关 `gateway.ts` `callUpstreams` | 拿到上游回答后立刻问；通过就把这次结果改成 `content_rejected`。之后的流程完全按内容被拒走：用量记录记 `content_rejected`，解冻原因 `call_rejected`（不扣费），不换账号，返回 `content_rejected`。 |
| 媒体网关 `media-gateway.ts` `withTarget` | 合成、流式合成、识别、实时识别、图片、搜索、实时通话、复刻都经过它拿上游结果；回 `invalid_key` 时同样问，通过就改成 `content_rejected`。`fail()` 遇到内容被拒本来就不改上游状态，`mapError` 给调用方 `content_rejected`。 |

后两处是为了让**调用方拿到的类别**跟着变。改动前，文本网关遇到 `invalid_key` 换账号失败后返回 `provider_unavailable`，私聊会进等待、被巡检反复重试；现在回复引擎拿到 `content_rejected`，按已有处理回推托语、登记被拦消息。

**缓存**：同一上游的自检结论在进程内保留 `KEY_SELF_CHECK_TTL_MS`（60 秒，`upstreams.ts` 常量）。缓存的是进行中的测试，同一时间很多请求一起遇到 401 / 403 也只发一次测试。上面四处共用这份缓存，一次调用最多发一次测试。管理员换密钥、点「测试」、改地址或协议时清掉。

**不变的**：`quota_exhausted` 和 402 照旧，不自检。安全策略正文（T-20261103j 的名单）照旧直接是 `content_rejected`，不自检。恢复探测（`GatewayMaintenance`，`source = 'probe'`）本身就是测试，不再自检。

**日志**：每次真正发出测试打一条 `upstream_key_self_check`，只有上游 ID 和结果类别（`ok` / `invalid_key` / `network_error` …），不含密钥和上游原文。

## 2. 同一用户反复被拦只限制他自己（总经理第 2 条）

**代码**：`model-access/application/private-block-limit.ts`（`PrivateBlockLimiter`），网关 `generateOnce` 在解析模型、冻结之前调用。

**参数**：`platform/config/product-params.ts` 的 `PRIVATE_BLOCK_LIMIT = { threshold: 5, windowMs: 1 小时, limitMs: 1 小时 }`，注释写明「总负责人 2026-11-04 定，总经理可调」。

**计数方式**：用现有的 `model_access.usage_records`，不新建表、不加迁移。数的是这个用户 `model_role = 'adult'`（私密模型）、`error_code = 'content_rejected'` 的记录：每次真正发给服务商、被服务商拦下的私密模型调用一条，包括第 1 节里自检通过后改按内容被拒的 401 / 403。走 `(user_id, created_at)` 索引，每次私密回复多一次很小的查询。不存内存状态，重启不丢。

**判定**：某一次被拦时，往前 1 小时内（含这一次）累计达到 5 次，就从这一次起限制 1 小时。

**受限期间**：网关直接返回 `content_rejected`，不请求服务商、不冻结、不扣费、不写用量记录。所以受限期间的回复不会让限制自己延长。限制生效时打一条结构化日志 `private_block_limited`，只有用户 ID、次数和到期时间，不含内容。

**适用范围**：只管**用户付费的私密回复**（`modelRole = 'adult'` 且 `purpose = 'chat_reply'`），也就是私聊回复、私密群聊发言、私密通话回合。理由：

- 共用账号的风险主要在私密上游。日常聊天、日常群聊、日常通话走的是别的上游，不受限。
- 私密回复是唯一会把「还没经服务商检验的新用户消息」发给共用账号的调用。回复被拦（包括受限）时，回复引擎会登记这一轮的用户消息（T-20261103j），记忆整理、摘要、私密整理、主动消息等后台调用都不再带上它们，只会带已经被服务商放行过的内容，所以不必一起限制。另外，后台整理失败会影响整理进度，一起限制副作用更大。
- 行为规划在私密范围不发用户原文（只发长度等特征），也不必限制。
- 安全判断和关怀回合（`safety_check` / `safety_followup`）安全优先，永远照常调用。

**受限期间私聊照样登记本轮用户消息**（回复引擎没改，按 `content_rejected` 的已有处理）。这些消息没发给服务商，但登记后，之后的上下文只带已被服务商放行过的内容。不登记的话，限制结束后，这些没经检验的消息会留在上下文里；如果其中有会被拦的，之后每轮都会被拦，而每次只登记最新一轮，会话又会卡住。代价是受限期间用户说的话不进入之后的模型上下文（界面照常显示）。

## 3. 隔离确认

| 要确认的 | 结论 | 证明 |
|---|---|---|
| 被拦记录按会话隔离 | 登记表主键是（会话 ID，序号），读写都按会话 ID。A 会话登记的消息不影响 B 会话 | 真库用例「被拦消息按会话隔离」 |
| 上游状态不会因任何用户的内容被拦而改变 | 安全策略正文、自检通过的 401 / 403、受限，三种情况都不改上游状态、不写状态历史 | 真库用例 1、4；单元测试 reportStatus / recordFailure |
| 进程内的线路冷却不会因 `content_rejected` 触发 | 网关遇到 `content_rejected` 直接结束，不调 `recordFailure`；`recordFailure` 收到自检通过的 `invalid_key` 也直接返回 | 真库用例 1、4（`isRouteCooling` 为 false、仍在调度候选里）；单元测试 |
| A 受限时 B 照常 | 限制只按用户 ID 判断 | 真库用例 4：同一时间 B 的私密回复照常请求服务商并成功 |

## 4. 上线说明

- 按正常流程发版。没有迁移，发版脚本照常即可。
- 如果 Abliteration 上游当前仍是「密钥失效」，按 `docs/handoffs/2026-11-03-private-policy-block.md` 第 4 节在后台点「测试」恢复。这次修复上线后，同样的情况不会再把它打回去。
- 上线后可以在日志里搜 `upstream_key_self_check`（自检结果）和 `private_block_limited`（用户受限）。

**回退**：直接回退代码。没有数据结构变化。

## 5. 自测结果（本机只跑一次）

- 服务器类型检查 `pnpm --filter @weiban/server typecheck`：通过（含测试文件）。
- 改动文件的 eslint、prettier：通过。`pnpm lint:deps`：没有依赖违规。
- 单测（本机）：
  - `model-access/application/upstream-isolation.test.ts`（新，16 个）：自检通过 / 失败 / 读不到密钥；60 秒缓存、同时到达共用一次、过期重测、不同上游各自测、`forgetKeyCheck`；日志不含密钥；`reportStatus`、`recordFailure` 自检通过时不改状态、失败时照旧、额度类不自检；媒体网关自检通过返回 `content_rejected`、失败照旧；限制规则（5 次 / 1 小时、4 次不限、分散超过 1 小时不限、到期时间、到期后再被拦不会立刻重新限制）；只管私密回复；受限日志字段。
  - 已有的 `live-model-fixes`、`safety-policy`、`tts-reported-usage`、`model-blocked-messages`、`private-model-fixed`、`realtime-voice-clone` 单测：通过。
  - `test/model-gateway.test.ts` 的装配用例（不连库）：通过，确认新服务的依赖注入完整。
- 真库用例（本机没有 Docker / `TEST_DATABASE_URL`，交给 CI）：
  - `test/upstream-isolation.test.ts`（新，5 个）：
    1. 401 / 403 普通正文、自检通过（私密、日常各试）：调用方拿到 `content_rejected`；每次只调一次上游；3 次只自检 1 次；上游 active、连续失败 0、无暂停、无状态历史、线路不冷却、仍在候选里；用量记录 `content_rejected`、不扣费；之后正常请求成功；日志不含密钥。
    2. 401 / 403 普通正文、自检失败：上游标 `invalid`，用量记录 `invalid_key`（原行为）。
    3. 自检缓存：3 个同时到达的请求只自检 1 次；59.999 秒内不再自检；满 60 秒重新自检。
    4. 用户 A 1 小时内被拦 5 次后受限：不请求服务商、不扣费、不写用量记录；同一时间 B 的私密回复照常请求服务商；A 的日常聊天照常；上游状态与线路不变；日志只有 A 一条、不含内容；到期前 1 毫秒仍受限，到期后恢复。
    5. 被拦消息按会话隔离。
  - `test/model-gateway.test.ts`：原「失效密钥」「普通 403」两个用例让假上游的 `/v1/models` 也回 401（密钥真的坏了），仍断言上游标 `invalid`；用例之间清自检缓存。

## 6. 遗留问题

- **密钥没坏、但 401 / 403 其实是别的原因**（例如这把密钥没有某个模型的权限、账号被服务商限制生成但模型列表还能读）：现在会按内容被拒处理，用户收到推托语，上游不标不可用，后台也不会有「密钥失效」提醒。只能从 `upstream_key_self_check`（结果 `ok`）日志和用量记录里大量的 `content_rejected` 看出来。这是总经理第 1 条要求的代价。如果以后需要，可以加一条提醒：同一上游短时间内大量「自检通过的 401 / 403」时通知管理员（要设计阈值，另开任务）。
- **自检会让那一次回复慢一点**：每个上游每 60 秒最多一次，通常不到 1 秒；连通测试最长等 10 秒。
- **自检缓存在进程内存**：与调度器的限流计数一样，单实例部署够用；多实例需要改共享存储。
- **限制计数包括私密后台调用的被拦**（记忆整理等也走私密模型）：它们也是这个用户的内容在共用账号上被拦，算进去是有意的。
- 私密群聊、通话被拦时仍不登记被拦消息（T-20261103j 的已有做法，没改）。
- 读用量记录失败时按不受限处理（照常请求服务商），不让回复失败。

## 7. 给其他负责人的交接

- **总负责人**：PR 合并后发版；如上游当前仍是 invalid，按第 4 节恢复。CI 里 `test/upstream-isolation.test.ts` 第一次跑，失败请转回来。
- **Codex（验收）**：重点看第 1 节四处是否覆盖所有会把上游标 `invalid` 的路径（`grep reportStatus`、`recordFailure`），以及第 2 节「只管私密回复」的范围和「受限期间也登记」的取舍。
