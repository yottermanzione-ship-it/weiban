# 迁移运行账本与受控事务内核候选

2026-11-09，独立副本 `C:/wb-dev/wb-migration-rehearsal-1109`，基线 `bbc93a0ac085b4acd1c8bad86925a544e0b6ad1d` 上的未提交候选。Codex 开发自测；不是独立验收、正式迁移或生产停写证明。

## 实现结果

0168 新增 `platform.legacy_migration_target_identity / runs / units / events / evidence / attempts`，使用正式账本结构，不借用 `public.codex_migration_receipts`，不以 `synthetic=true` 代替生产许可。未改既有 domain/app/persona、legacy-delta 脚本或原 fixture 门禁。

- 默认 `mode=plan`，CLI 只有计划输出，执行参数拒绝；执行仅是内部显式入口。没有连接发现、SSH、停止/启动服务、DNS、下载入口、自动放行或整库恢复功能。
- 精确绑定实际 Database pool 的连接、数据库名/OID/安装 UUID、迁移 checksum、实际列/约束/索引摘要及 manifest。错误目标、改过的计划、schema 或 handler 摘要拒绝。
- 实际业务 callback、后态检查、来源事件和单元回执在同一 `Database.transaction`；失败回滚。异常不等于回滚，提交确认丢失记为 unconfirmed，恢复时重新查实际数据与回执。
- 同目标咨询锁互斥，竞争快速拒绝；数据库限制同目标只有一个 prepared/executing/verified run。关闭或明确 halt 后才可另开 run。
- 来源事件按 `(target_digest,domain,event_key)` 跨 run 唯一。重复事件须同摘要且后态一致；部分事件已存在要求重新规划，不重新执行整批。
- inspect 返回实际源及实际目标 owner，内核重新套统一固定排除策略，再比较声明的 owner 摘要。重签伪造 owner 清单仍被拒绝。
- `reconcile` 真实复核已提交单元后态，区分 retryable 与等待依赖；目标改变不覆盖。放行前再次复核所有单元；released 记录、新业务计数增加或同目标另有 active run 会禁止盲恢复。
- 回执只含摘要、固定状态、受限整数计数与探针元数据，不记录私人业务 payload。0168 down 在账本非空时拒绝破坏性回滚。

## 固定接入接口

文件 `scripts/ops/migration-execution-ledger.mjs`；不反向依赖 `legacy-delta-core`。

`createMigrationExecutionKernel({database,target:{connectionString,digest},mode='plan',probes:{identity,maintenance},authorizationVerifier,handlers,options})`。options 中额外保留 owner 摘要只能增加限制。

`buildExecutionManifest` 的严格字段：`runId,targetDigest,sourceDigest,schemaDigest,policyDigest,codeSha,inventoryDigest,backupSetDigest,receiptJournalIdDigest,requiredDomains,writerIds,units`。`executionPolicyDigest(options)` 绑定固定排除策略。每单元为 `key,domain,handlerDigest,planDigest,scopeDigest,beforeDigest,afterDigest,sourceOwnerDigests,targetOwnerDigests,events:[{key,digest}],dependsOn`；构建器补 unit.digest 与 manifest.digest。拒绝环/缺依赖、重复单元、同来源事件拆入多个单元。requiredDomains 缺注册执行器时，业务写入前阻断。

handler 是受信任代码注册对象，不能从清单反序列化：

```js
{ mode, domain, digest, metrics: ['inserted','updated'],
  inspect(tx,payload), apply(tx,payload), inspectAfter(tx,payload) }
// 两个 inspect 必须真实读取并返回：
// {stateDigest,planDigest,scopeDigest,sourceDigest,events,
//  sourceOwnerIds,targetOwnerIds}
// apply 只返回 metrics 允许的非负整数计数。
```

`assertExecutionTransaction(tx,expectedScope?)` 用模块私有 WeakMap，仅全部门禁、实际前态和 owner 检查通过后，在 await handler.apply 期间有效，finally 撤销。返回冻结的 `mode/runId/unitKey/domain/targetDigest/sourceDigest/manifestDigest/planDigest/scopeDigest/handlerDigest/policyDigest`。可按 domain/planDigest 等限定；普通事务、伪造对象、inspect 阶段、结束及回滚后都无能力。后续共享写函数必须断言它并使用同一 DbTx，不能调用另开事务的旧 wrapper 或另开连接，也不能触发付费/通知副作用。

| 方法 | 返回与行为 |
|---|---|
| `prepare(manifest)` | `{status:'prepared'或'already_prepared',runId}` |
| `executeUnit(manifest,key,payload)` | `{status:'applied'或'reused'或'already_applied',counts}` |
| `reconcile(manifest,payloadForUnit)` | `{committed,retryable,waiting}`；实际复核后态 |
| `close(manifest,payloadForUnit)` | 复核后记 closed，释放 active-run 限制 |
| `halt(manifest)` | 停止该 run，不动业务数据、不恢复服务 |
| `markReleased(manifest,payloadForUnit)` | 再复核后记 released，`servicesChanged:false` |
| `assertRestoreEligible(manifest)` | `{eligible:true,executed:false,requiredAdapter:...}`；整库恢复器未提供 |

## 探针与许可边界

三类适配器均须固定 `kind/mode/issuer/publicKey`，实现 `collect(challenge,{tx})` 与 `readArchivedEvidence(digest,{tx})`。生产拒绝 rehearsal provider；缺探针/许可验证器/handler 均不得写业务。签名封套绑定新 nonce、mode、issuer、run、manifest、目标、来源、scope、操作、unitKey，验证 Ed25519、固定公钥、时效，并回读持久封套核对相同摘要。

维护观察必须覆盖 writer 清单、停止状态、进程摘要/代际、所有在途类别、同 run fence、来源检查点、匹配备份及独立收款日志身份。`writersStopped:true` 不能直接过关。apply 前和提交前都验证，writer 恢复则回滚。默认证据最大年龄 30 秒，可配置但不超过 60 秒；生产禁止替换墙钟。单元须在有效证据窗口内完成，不得关闭时效检查来迁就长事务。

本轮 probe 只观察**自建 PG 模型**，不是生产进程。签名封套与公钥存入 `codex_execution_fixture.attestations` 后实际回读，私钥只在进程内。签名证明来源和完整性，不自动证明陈述真实。生产服务停止、真实排空、运行代码身份、备份恢复、外部收款日志及人工许可签发均未亲测，生产实现未提供。正式生产者必须实际测量，不能复制请求值，并把元数据回执放在整库恢复不会覆盖的证据库；fixture 存档在同一专库，不冒充该生产保留能力。

## 真实 PG 自测与留存

先核对容器 ID `2368b1b65e773eed5eee1a12bf8820e6dcacbe692a98f1cc566536566596adcc`、名称 `codex-migration-chat-1109`、label `weiban.fixture=migration-1109` 与唯一映射 `127.0.0.1:56389`，再新建 `codex_migration_execution_1109` 和 synthetic marker。没有触碰共享 weiban_test。全部资料虚构；按经理要求保留专库、数据和回执，仅关闭本任务连接。

| 检查 | 结果 |
|---|---|
| 首轮实际 PG | 20/20（19 子用例与父汇总），0跳过，17.78秒 |
| 最终固定文件 | 23/23（22 子用例与父汇总），0失败/跳过，46.11秒；含持久证据回读、依赖恢复及另一active run阻断旧基线恢复 |
| ESLint、语法、格式、差异检查 | 全部通过，退出0 |
| 0168 down | 有数据时实际拒绝，回执保留 |
| 留存/连接 | 保留累计76个rehearsal run（9 closed、63 halted、4 released）、79单元、39来源事件、357证据引用和1020份签名封套；包含早期测试迭代，全部为合成记录。关闭后本库其他连接0，新增seq/cursor列0 |

覆盖同事务、重复/跨 run 去重、真实 PG 互斥、错目标/计划/未接域、错用 rehearsal provider、签名篡改/重放/过期/无许可/无存档、回滚、依赖单元续跑、writer 状态失效、真实源/目标 owner 排除、源变化、后态漂移、新业务写入、放行后盲恢复拒绝。

提交后断线不是写前抛错：真实 COMMIT 后，先核对本任务连接的 database 与 application_name，再用 `pg_terminate_backend` 终止该连接并模拟确认丢失。实际数据/回执仍在；重建内核对象复核并重试，没有第二次业务写入。未终止其他库或任务的连接。

0168 文件 SHA-256：up `de21de3038add7883e22f5da4eec7ae6c6632f9ec29c62a1c663f4c0fd113d84`；down `0bfeeecd3c70c59de34ab34af17f18da7957943d3c8f00eacb16cffac818e8dd`。SQL应用后未修改，也未改迁移账本绕过checksum。

```powershell
$env:TSX_TSCONFIG_PATH='apps/server/tsconfig.json'
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 scripts/ops/migration-execution-ledger.test.mjs
```

本项完成可运行内核与合成 probe，实际业务 handler 接续由主会话逐域实现。整库恢复、跨机证据/收款保留与入口切换另行受控。不自签独立验收；没有提交、推送、合并、线上连接或切站，本机耗时不能作为生产停机估计。
