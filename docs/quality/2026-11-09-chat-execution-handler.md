# 聊天正式执行适配候选：开发自测

2026-11-09，独立工作树 `C:/wb-dev/wb-migration-rehearsal-1109`，基线 `bbc93a0ac085b4acd1c8bad86925a544e0b6ad1d` 的未提交改动。仅合成数据开发自测，不是独立验收或生产执行批准。

## 已实现

`legacy-delta-db.mjs` 把原聊天写入抽为私有 `applyConversationTransaction`。原 `applyConversationDelta` 仍要求原来的 isolated-fixture/synthetic 声明、loopback、专用库名、实际 pool 连接串一致、实际数据库名与 marker，并检查维护声明；这些 fixture 限制没有改为可配置生产开关。

新增内部 `applyExecutionConversationDelta(tx,args,expectedScope)` 必须具有运行账本的不可伪造事务能力，绑定 chat-history、计划摘要及实际固定排除策略摘要；没有能力的普通/伪造事务不能进入写入。与 fixture wrapper 调用同一个私有 SQL 内核；正式路径不查询或写入 `public.codex_migration_receipts`，不创建连接，不另开事务，不伪造 synthetic。

新 `chat-execution-handler.mjs` 注册到 0168 运行账本，实际完成以下操作：

- 用受信任、明确注册的来源 reader 重新读取原始来源行、群 owner、已核实映射及删除核对资料，在锁内重算计划；既有来源记录不能换 owner、跨群或凭显示名称重新匹配。
- 保留 `legacyId('message'/'client-message', table, sourceId, part)`。采用当前 core 的私聊整数 ID、群 UUID/opaque TEXT ID 和同时间 BINARY 排序修复；每个实际插入片段有稳定的来源事件回执。
- 真实源 owner（群消息包括 `chat_groups.user_id`）和实际目标会话/状态/用户成员/隐藏记录/带 user_id 的关联行均执行永久排除策略。只能增加排除项；不能靠清单谎报 owner 绕过。
- 写入前要求目标账号 active、目标关系/成员已存在、回复/记忆/渠道任务已排空。不会创建账号、恢复好友、重新入群或解除归档。
- 复用原真实 SQL：插入加密消息、保留原消息密文/ID/撤回/隐藏状态、翻译原序号及记忆/摘要/收藏/微博边界，保留序号空洞，最后使旧同步游标失效。不广播历史消息，不产生 outbox、模型调用或收费。
- 来源删除/永久删除清单参与原规划器；未解决冲突拒绝。已归档/已离群关系的历史可保留，原保护字段不改变；本适配不执行历史删除动作。
- 附件先读取当前目标媒体 ready/owner/purpose/到期状态；用户表情还核对 `media.user_stickers`。未就绪或他人附件拒绝。只验证已有元数据，不下载 URL、不声称已复核实际媒体文件。
- 计划前后态覆盖会话、消息、成员、状态、隐藏记录和整个 seq 引用注册清单。既有密文只计算哈希；本批新消息由真实 EnvelopeCrypto 在同 tx 解密核对内容摘要，临时 Buffer 清零，避免随机 nonce 使恢复不可核对。完整消息字段集合改变会要求更新适配。
- 同用户多会话可逐单元完成，采用“同步失效至少达到规划边界、trimmed_through 等于当前 last_update_seq”的单调检查，不要求第一单元的全局游标永远停在原数值。每个会话后态仍逐个严格核对。

本轮还修正原文件中不可达的微博边界校验：它原来位于 `model_blocked_messages` 分支内，现对 `channels.bindings` 独立验证 owner/角色/会话/边界，再更新。失败仍同事务回滚。

## 固定接口与信任边界

```js
const handler = createChatExecutionHandler({
  mode: 'production', // 默认 plan；没有生产来源或探针的通用 CLI
  sourceReader, crypto, validateContent, options,
});
const { status, unit, payload, sourceDigest } =
  await handler.prepare(tx, { sourceKey, dependsOn });
// unit 直接供 buildExecutionManifest；payload 是私人计划，不能放到运行账本/日志。
// handler: {mode,domain:'chat-history',digest,metrics:['inserted'],
//           prepare,inspect,apply,inspectAfter}
```

无变化/受删除保护返回 `{status:'unchanged',unit:null,payload:null}`。有变化返回完整单元，sourceKey 必须是摘要。每个单元一次处理一个会话；仅在账本 `handler.apply` 能力窗口内写入，业务及正式回执在同一 transaction。中断后先 `reconcile(manifest, async unitKey => payload)`，验证完才能继续；不是重新跑旧全量导入。`close` 需要先完成 reconcile；释放运行互斥不等于打开服务。

`sourceReader = { mode, digest, read({sourceKey,tx}) }` 是固定注册的可执行适配器，不能来自 JSON 清单。返回固定来源检查点与该单元的原始资料：

```text
snapshotDigest, table:chat_history|group_messages, rows,
group:{id,user_id}|null,
bindings:[{sourceId,ownerUserId,conversationId,legacyOwnerUserId,
           userParticipantId,peerParticipantId,peerKind,systemParticipantId,
           scope?,officialKey?,mediaId?,stickerId?,quoteMessageId?}],
review:{initialCutoff,cutoff,
        inventory:{complete,digest,sourceDigest},protection,
        reviewedGaps?,deletedSource?,newConversationReadCursor?}
```

reader 必须自行验证并读取冻结源、准确映射和完整删除核对证据。`complete:true` 不是独立证据。本轮实际 reader 只读取专库内合成源表；**生产冻结快照 reader/证据认证尚未提供**。来源全记录与 review 摘要均重新核对，运行账本另核对新鲜的来源 checkpoint、维护、许可及目标身份。只有换连接串或传几个布尔值不能完成接入。

payload 包含私人新内容与目标元数据，只在内存里使用；本代码不把它写到文件/日志/回执。跨进程恢复仍需要正式的加密计划保管器；本轮恢复用同一份合成内存计划重新构造内核，真实 PG 连接已断开并恢复。代码摘要、reader 摘要与固定排除策略绑定 handler 版本；变更需要重做计划。

## 实测

先重新核对本机容器 `codex-migration-chat-1109` 的完整 ID `2368b1b65e773eed5eee1a12bf8820e6dcacbe692a98f1cc566536566596adcc`、label `weiban.fixture=migration-1109` 与唯一 `127.0.0.1:56389` 映射。只使用本任务先前创建并保留的 `codex_migration_execution_1109`；先验证实际 marker，再运行实际迁移到 0168。没有连接线上或重置共享库。

| 检查 | 结果 |
|---|---|
| 聊天专项首轮 | 发现并修正后态投影对 `library.favorites.source_seq` integer 与其他 bigint 的差异；同时修正合成源 ID 重复与测试调用顺序，未绕过业务门禁 |
| 聊天专项上一轮 | 16/16（15 子用例及父汇总），0失败/跳过，93.21秒（父用例56.32秒） |
| 最终固定文件专项 | 16/16，0失败/跳过，56.56秒（父用例47.17秒）；包含无附件引用时明确拒绝的断言 |
| 原 `legacy-delta-db.test.mjs` 回归 | 12/12，0失败/跳过，11.99秒；真实同步客户端重建、账号→官方关系→旧消息链路、全部 seq 注册表也通过 |
| ESLint / Prettier / Node syntax / git diff | 全部通过，退出0 |

专项包括私聊交错、群 UUID/opaque 同时间排序、图片及完整文本拆分 ID、媒体未就绪/外人/错用途、原删除/归档/离群保护、固定排除的真实源与目标 owner、假事务/生产 reader 缺失/fixture 门禁、来源变化/伪造计划/目标变化、写中回滚、并发快速拒绝、跨 run 回执重用、同用户多会话同步失效、提交后漂移拒绝。

断线用例是在真实 COMMIT 成功后，核对 database/application_name，再终止**仅本任务拥有的连接**。新内核重新查询真实数据/回执，看到已提交单元；重试不再次插入消息、不重复创建来源事件。没有终止其他任务连接。

```powershell
$env:TSX_TSCONFIG_PATH='apps/server/tsconfig.json'
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 scripts/ops/chat-execution-handler.test.mjs

$env:MIGRATION_LAB_DATABASE_URL='postgres://postgres@127.0.0.1:56389/codex_migration_execution_1109'
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 scripts/ops/legacy-delta-db.test.mjs
```

按经理要求保留所有合成源、账本、临时资料与专库；仅关闭本任务连接。不提交、推送或切站。未重新执行整个产品测试，也未把本机时间当生产停机估计。

最终留存核对：累计聊天 run 53 个（3 closed、50 halted）、132 条聊天来源事件、76 份合成来源单元，包含前面失败/修正迭代；全部保留。专库其他连接 0，没有留下 active run。

## 仍需接入的正式迁移环节

1. 生产冻结源/映射/删除核对 reader 与加密计划保管器；每份源与目标身份、媒体准备回执和排除策略绑定同一个执行 manifest。资料仍必须程序内存处理，不能把私人 payload 放入运行账本。
2. 实际维护/排空/备份/收款日志探针、许可签发及恢复不会覆盖的证据存档；本轮 PG 模型不能证明真实服务已停写。
3. 账号、官方/私有角色、关系、媒体等 prerequisites 的能力保护事务 handler。顺序至少是账号→角色/关系→媒体 ready→聊天→群记忆等依赖，再做全域对账；当前缺失关系明确阻断，不自行加好友。
4. 旧来源删除动作、权益/人设/组织/其他已确认域的正式 handler 和依赖整合；本聊天适配不能代替它们。
5. 接齐后做全域合成整链演练与匹配备份恢复、实际维护窗口容量/时效验证。单会话工作必须在账本证据有效期内完成，不能放宽门禁冒充可迁移。真实开放服务/切入口仍是另外的明确授权步骤。

本报告上一阶段的 29 条附件路径失踪及 4 条无引用，共 33 条，来自主会话只读核对，本代理未读取真人资料。经理随后明确决定保留文字/时间并标记附件不可用；已接续开发 sourceDigest 绑定的逐条例外，见[缺附件承接开发自测](2026-11-09-chat-missing-media.md)。没有明确证明时仍为 `MEDIA_NOT_READY` 阻断，不自动丢消息。本聊天适配未执行 455 条旧删除核对项的隐藏动作；删除来源与引用/记忆条件由主会话另行核实。

账号/关系的最小后续实现可复用：`applyMissingAccounts` 的实际命名空间锁、账号/alias 冲突核查与 INSERT-only，以及真实 `SettingsService.createDefaults(tx,...)` 和关闭主动；把 SQL 抽为私有同 tx 函数并以来源账号事件登记正式回执。已有密码/资产/会员仍不改。关系可同样提取 `applyLegacyRelations` 的真实写入，复用 `planLegacyRelations` 及当前账号/角色/状态核对，保留失效关系/群归档/退出屏障；现在它和 `readLegacyRelationsBaseline` 仍是 fixture 包装，不能直接用在生产。两者都要在源/实际目标 owner 检查后声明账本依赖，不能把 `public.codex_migration_*` 回执改名当作适配完成。本轮只给设计，未改关系文件或实现这些前置执行器。
