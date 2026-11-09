# 旧群共享记忆：最小承接候选与隔离开发自测

日期：2026-11-09。工作副本：`C:/wb-dev/wb-migration-rehearsal-1109`。基线：`35f510f1ecfbe9b7ced2e0d3e1655ed9c1716981`，本报告对应其上的未提交候选。实施者 Codex；这是开发自测，未签独立验收，未执行正式迁移、发布或线上变更。

## 结论与来源范围

候选将旧 `group_memories` 按来源账号和原群单独加密保存，仅为同 owner、当前仍在该群且联系时期有效的角色提供普通群回复上下文。不复制进 `ai_runtime.memories`，不供私聊、主动群话题或其他群读取，不进行历史抽取、模型调用、扣费或通知。

旧源码依据为 `C:/wb-ref/old-weiban/server/lib/migrations_registry.js:179` 的真实表结构，`lib/memory/group_memory.js:171` 的原群 enabled / 最近 30 条读取，以及普通/主动群回复调用方。旧 `subject_character_id` 与 `supersedes_id` 默认为空（迁移注册表 2980–2982）；本候选只接受固定共享格式中的空字段。角色专属记录仍交给原窄工具核对，不能互相假装覆盖。

主会话提供的 **2026-11-09T04:27:35Z 只读聚合**为：群 91、归档 29；共享记忆总数 11,877，enabled 4,596，其中非归档群 enabled 3,730 条涉及 58 群，归档群仍 enabled 866 条；角色归属与替代字段非空均为 0。本子任务没有重新连接线上或读取实际正文，这些数量不能当成本候选已激活数量。

## 实现边界

- `0164_legacy_group_memories.sql` 新增来源映射、逐行密文、按用户/角色的遗忘排除墓碑三张表；没有新增 seq/游标列。0164 的 down 只允许三张空表，有任何来源、密文或墓碑均拒绝破坏性回滚。journal 的 0165 由其他代理追加，本任务保留该条目。
- `LegacySharedGroupBatch` 固定格式 `weiban-legacy-shared-group-memory-v1`，严格校验来源账号、原群、target digest、截止点与五项人工核对证据。不存在公开导入口；隔离 ops adapter 默认只计划，执行委托必须同时验证 loopback 专库、实际连接字符串、库名、synthetic marker、绑定的 service database，以及停写/通知隔离证据。没有 SSH、DNS、生产连接发现或自动切站能力。
- `LegacyGroupMemoryService.importBatch` 使用实际 `EnvelopeCrypto`，完整保留原 source 对象；按用户、来源群、来源记忆 ID 去重。同 source ID 的正文/字段变化、已有映射变化及目标变化均冲突，整批回滚，既有目标不会被覆盖。原停用、归档、来源不明/私密健康、证据缺失和受保护目标仅留加密档案，不自动激活。
- **空群保护**：`lastSeq === 0` 默认受保护。现有聊天清空在空群可能 no-op，不能把没有 cursor 当作没有遗忘证据。无对应历史的空群不会自动读取旧记忆。
- **blocked 不自动升级**：已写来源的 `review_digest` / `target_digest` 不可覆盖；补齐消息后原样重跑或换 target digest 都不会把已 blocked 来源转 active。正式候选顺序必须先完成消息承接，再核对群记忆；空群/缺证据留档项进入明确待核对清单。本次没有提供放宽保护的“解封”操作。
- 群读取检查账号 active / 未封禁、同 owner、normal 范围、未归档/隐藏/清空、用户仍在群、当前角色成员资格、active contact epoch，以及现有个人记忆 barrier 和独立遗忘墓碑。私聊遗忘/重置后只排除受影响角色，不抹掉其他当前成员的原群共享记录。generation 用于旧准备请求失效，不把正常整理重试误当作永远删除共享历史。
- 每轮只从原最近 30 条合格候选里，按新到旧选择 **2400 UTF-8 字节总预算内的完整条目**；预算包含提示头、JSON 括号/分隔和转义。过大的条目原样加密保留，本轮不注入；不会截断原存储，也不保证 30 条全部进入提示。stamp 绑定实际选集、source digest、预算版本、成员、联系时期和 generation。最终模型 gateway 仍保留自己的上下文预算检查。
- 普通 `context` 是纯读，不新建写事务。发消息最终门禁沿既有 owner 咨询锁 → contact 行共享锁 → chat 会话行写锁顺序，在同一个 tx 重读 metadata/stamp 并发送；显式 `lockForWrite` 没有 tx 就拒绝，避免并发清空穿过校验与发送间隙，也避免读阶段另连导致死锁。
- `GroupChatService.speak` 的内部 stamp 与既有加密 durable 输入一起保存，模型调用前、重试前、结果后、最终发送前都重新核对；失效的旧缓存不能照常发出。可选依赖追加在构造器末尾，兼容既有手工构造测试。
- 群解散事件清除密文、停用来源并保留防重建墓碑；账号注销的 purge/count 覆盖三张表。延迟联系人 reset/purged 事件只在账号仍 active 时写排除墓碑，既有清理继续执行，不在注销后重建个人元数据。

## 实测证据

环境为既有独立容器 `codex-migration-chat-1109`（实际核对 label `weiban.fixture=migration-1109`），loopback 56389，新建且仅使用 `codex_migration_group_scope_1109`。全为虚构账号、角色、群消息和记忆，测试密码只在进程内随机生成。使用当前真实迁移到 0165 的 schema、Nest 装配、真实 crypto/identity/contact/chat ports；`background:false`，没有启动工作器。测试文件也只允许本机该固定专库，或仓库既有 GitHub Actions 创建的固定临时 CI 库；这项 CI 放行依据已有 `.github/workflows/ci.yml`，不是“设置任意 CI 变量便安全”。

| 检查 | 结果与覆盖 |
|---|---|
| 群共享 PG/Nest 专项 + 既有 group-chat-sticker | 最终 18/18（共享专项 14 + 既有 4），28.11 秒，退出 0；包含并发清空门禁 |
| 既有 memory-persona 回归 | 18 项通过；该组合运行总耗时 186.56 秒，另两项开发中失败随后已复核，不能把整次组合执行称为通过 |
| 隔离适配器 Node 测试 | 最终 5/5，约 0.52 秒，退出 0；默认计划、执行参数拒绝、外部/共享库/错绑定/无 marker/无维护证据拒绝 |
| 代码规则、模块依赖、类型 | 定向 ESLint、服务器 typecheck、git diff --check 均退出 0；依赖图 602 modules / 2696 dependencies 无违规 |
| 迁移与清理 | 空表实际执行 0164 down/up，有数据拒绝 down；确认专库 synthetic marker、其他连接 0、新增 seq/cursor 列 0 后删除本任务数据库，最终同名库剩余 0；保留容器及其他库 |

专项包括：最近 30 条、逐行密文往返、原停用保留、跨账号/群拒绝、并发幂等、原来源漂移拒绝、整批失败原子性、缺证据/归档/私密健康/未知 provenance 不激活、成员退出/隐藏/清空/非 normal、空群及 blocked 不自动升级、真实个人记忆遗忘后不复活、epoch/generation 栅栏、无新增费用/outbox、群解散及注销迟到事件、受控群回复入口、旧缓存拒发和并发清空门禁。

运行命令：

```powershell
$env:TEST_DATABASE_URL='postgres://postgres@127.0.0.1:56389/codex_migration_group_scope_1109'
pnpm exec vitest run --project server apps/server/test/legacy-group-memory.test.ts apps/server/src/modules/ai-runtime/application/group-chat-sticker.test.ts
node --test scripts/ops/legacy-shared-group-memory.test.mjs
pnpm --filter @weiban/server typecheck
pnpm lint:deps
```

本轮修复并验证了审查发现的总预算缺口、注销延迟事件重建墓碑风险，并补上空群和发消息前并发清空保护。一次持续编辑中的组合运行曾报导出未加载与墓碑重建两项失败，不能据该次宣称全绿；最终以固定文件后的专项结果为准。另修复过开发中 `bytes` 初始化顺序及不存在的 AppError 枚举值，未绕过检查。

0164 最终文件 SHA-256：up `742d776ce3436f9897215ea9d39f8c13700ef1944b8be2efe35f3a71671ee52f`；down `8bb9cfb169893532cbabb9407b2fbf529ed36bda0130748e3d109f491421729f`。添加 `encoded_bytes` 后已冻结迁移字节；没有修改迁移账本绕过 checksum。

## 未测与执行前条件

未读真实正文、未跑生产导入、未做真实模型语义/费用/通知验收、未做生产规模吞吐或用户端完整独立验收。群回复测试运行真实 `speak` 路径并用本机数据库校验，但模型、brain 和发送观察器受控替代；不能称真实供应商调用或完整群聊端到端验收。本机数十秒/分钟测试时间不是生产停机估计。

正式候选需先冻结两站写入并取得一致源快照，完成消息与账号/群映射承接，再逐群核对 owner、normal、归档/删除/清空/遗忘证据及 target digest；只对明确满足条件的共享来源提交候选。不能把 4,596 条 enabled 全部激活，也不能把 3,730 条非归档 enabled 当成自动放行数量。需要独立复核与最终整体迁移演练后，由主会话决定执行安排。本子任务没有提交、合并、发布、修改生产或切换入口。
