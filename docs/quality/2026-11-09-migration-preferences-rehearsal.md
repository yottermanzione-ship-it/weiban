# 旧云偏好：受保护适配与独立 PostgreSQL 演练

2026-11-09，Codex 开发自测。工作目录 `C:/wb-dev/wb-migration-rehearsal-1109`，分支 `codex/migration-rehearsal-20261109`，开始及最后检查的 HEAD 为 `35f510f1ecfbe9b7ced2e0d3e1655ed9c1716981`；本报告对应其上的新增未提交文件。主会话统一提交。本次不是正式迁移，也不自签独立验收。

仅新增 `scripts/ops/legacy-delta-preferences.mjs`、对应测试及本报告。没有修改业务模块、契约、其他代理文件、共享 lab 接口或主报告；没有连接线上、读取真实用户 JSON、下载 URL、访问手机文件或触发业务端口。

## 结论

已实现旧 v1/v2 云偏好到**六个现有目标字段**的候选规划、明确审核和隔离数据库应用。现有新编辑、隐藏、归档、清空、永久删除、退群优先；旧墓碑不被旧投影复活，来源缺项不解释为删除。源删除或替换需要绑定字段指纹的审核；新账号需要首次不存在、当前默认状态及未被编辑的来源证明。

最终开发自测 **25 / 25 通过，0 失败、0 跳过**：16 项规则/纯数据检查和 9 项真实 PostgreSQL 检查。ESLint、Prettier 检查通过。

星标、用户标签及昵称缓存仍有明确的待处置分类和私有原值载荷；本次没有新增这些产品功能，也不宣称全部旧云偏好已完整承接。61 份人设备份不在本次写入范围。

## 来源与聚合观察

旧源码固定于 `2c5632e2ed66f5144d8f7bbad805a4f9d913a0d5`。依据：

- [client_prefs_document.js](C:/wb-ref/old-weiban/server/lib/client_prefs_document.js:1)：六个 map section 为 `remarks/nicknames/chatFlags/chatBackgrounds/friendAvatars/tags`，另有 `momentsCover`、`starred`；v2 的 `_sync.entries` 才是值、修订时钟、writer、删除墓碑的权威来源。
- [client_prefs_cloud.dart](C:/wb-ref/old-weiban/src/lib/services/client_prefs_cloud.dart:314)：`chatFlags` 保存 `name/isGroup/remoteId/isMuted/isPinned`；昵称为服务端同步缓存。没有把主题或全局通知算作这张表内容。
- [message_store.dart](C:/wb-ref/old-weiban/src/lib/services/message_store.dart:229)：flags key 为 `single:<name>` 或 `group:<remoteId??name>`；[state_core.dart](C:/wb-ref/old-weiban/src/lib/pages/chat_page/state_core.dart:94) 的背景 key 则是私聊裸角色名或 `group:<groupId??name>`。适配器只接受显式映射，不用统一字符串猜测两者身份。
- [app_profile_state.dart](C:/wb-ref/old-weiban/src/lib/pages/app_profile_state.dart:266)：三类图片云端导出只选远程引用；本次不自动抓取这些引用，必须使用已有媒体迁移结果。
- [remark_manager.dart](C:/wb-ref/old-weiban/src/lib/services/remark_manager.dart:18)：显示优先级是用户备注、服务端微伴昵称、角色名；昵称缓存不是“TA 怎么叫我”的 `addressAs`。

主会话提供的 **2026-11-09 04:31:25 UTC** 聚合观察：`user_client_prefs` 313 行，其中 295 为 v2，没有坏 JSON；不是本子任务重新查询或最终停写快照。

| section | 当时可见投影项数 | 当时删除墓碑数 |
| --- | ---: | ---: |
| remarks | 374 | 31 |
| nicknames | 2448 | 0 |
| chatFlags | 112 | 18 |
| chatBackgrounds | 177 | 29 |
| friendAvatars | 260 | 1 |
| tags | 2 | 0 |

另有 145 个非空封面、90 个账号非空星标。以上只是历史聚合规模；不能据此推定任何具体值、媒体均可用或未出现后续删除。

## 实际目标及边界

| 来源 | 真实目标 | 约束 |
| --- | --- | --- |
| remarks | `contacts.contacts.remark` | 按旧显示语义 trim；显式 null/空值可作为清除候选；新契约上限 20 个 UTF-16 code unit，超长明确阻断，不截断 |
| chatFlags.isPinned | `chat.user_conversation_states.pinned` | 只对精确映射会话；不修改 hidden/read/cleared/markedUnread |
| chatFlags.isMuted | `chat.user_conversation_states.muted` | 只迁会话静音，不推断全局通知设置 |
| chatBackgrounds | `chat.user_conversation_states.background_media_id` | 必须为本人、ready、用途 `chat_background` 的既迁媒体 |
| friendAvatars | `contacts.contacts.custom_avatar_media_id` | 必须为本人、ready、用途 `contact_avatar` 的既迁媒体；不修改角色公共头像 |
| momentsCover | `identity.profiles.moments_cover_media_id` | 必须为本人、ready、用途 `moments_cover` 的既迁媒体 |

目标字段取自当前 contacts/chat/identity 真实 schema 和 HTTP 契约。联系人还检查 active、删除状态、私有角色所有者及会话确为该角色的私聊。不会创建缺失账号、角色、联系人、会话或参与者。

媒体输入以 `ownerUserId + referenceDigest + purpose` 精确定位；每条需 `mediaId/state/contentHash/readyProofDigest`。目标 `media.objects` 必须匹配本人、用途、ready 状态、内容 hash，并无过期时间。缺失、歧义、错账号、错用途、未 ready、hash 改变均阻断。只使用引用摘要，不请求 URL；文件读取/加密/完整性另由媒体迁移模块负责。解绑旧图片不删除旧媒体对象。

`nicknames` 返回 `nickname_source_cache_not_address_as`，`tags` 返回 `tags_pending_disposition`，包括空列表取消状态的 `starred` 返回 `starred_pending_disposition`；未知 section 也保留为待处置，不能静默丢弃。`pending` 保留私有原值且单独计数；已明确的字段可演练，但 pending 非零不等于整体迁移完成。

## 模块接口与审核流程

`normalizeLegacyPreferences(document)` 解析旧 v1/v2。版本化文档完全以 `_sync.entries` 为权威，不用可见投影覆盖墓碑；不支持的同步版本或坏结构阻断。初始墓碑不因后续普通值自动复活；倒退的时钟、同一时钟/writer 下被改写的值阻断。这里消费已合并的权威数据库文档，不代替旧站多设备 CAS 合并服务。

`planLegacyPreferences` 接受：

- `sources=[{sourceUserId,document}]`。
- `bindings=[{sourceUserId,ownerUserId,characters:{旧角色键:[UUID]},conversations:{准确旧键:[UUID]}}]`。一个源必须有明确账号映射；角色/会话恰好一个候选，多个候选拒绝；多个源指向同一目标账号拒绝。
- `initialBaseline={sources,target}` 与当前 `targetBaseline`。每个候选保留 `sourceInitial/source/targetInitial/target` 四个指纹，另绑定具体映射、目标完整快照及保护清单。初始源记录缺项只表示未知，不能当删除。
- `protection.inventoryComplete=true`，可带 `deletedOwnerUserIds/purgedContactKeys/purgedConversationIds/leftParticipantIds/editedFieldKeys`；联系人键为 `owner:character`，字段键由 `preferenceFieldKey` 产生。
- `decisions[fieldKey]={action,candidateDigest,proofDigest,noTargetEditProofDigest}`。action 仅 `apply-reviewed` 或 `preserve-target`。必须与候选摘要完全一致；保留目标不要求证明未编辑，但写入要求明确审核及无目标后续编辑的证明。
- 新账号通过 `newAccountDefaults[owner]` 代替逐字段 apply 决定：`preferenceNewAccountRequirements` 提供待核对的 `initialAbsenceFingerprint/defaultTargetFingerprint/sourceFingerprint`，操作者必须另提供 `proofDigest/noTargetEditProofDigest`。初始账号及其资料/关系/状态均须不存在，当前待写字段必须仍为 null/false。辅助函数只是算摘要，**不会自动生成真实的缺失或默认来源证明**。

特别限制：当前联系人和聊天个人状态没有逐字段版本号，仅比较值无法识别“修改后又改回原值”的历史。因此相等指纹不自动视为未编辑：必须取得上述未编辑证明，已知编辑的 fieldKey 即使最终值相同也优先保留。若缺少审计依据，保留待审核；本模块不声称凭空补出了旧站或新站编辑事件历史。摘要相符只证明输入绑定，不认证外部证明本身的真实性。

规划产物包含敏感备注、来源及待处置原值，属于受保护操作数据；禁止直接输出、普通归档或提交。**仅 `plan.summary` 可用于公开回执**：只有数量、固定分类、`ok/productionReady`。测试使用合成敏感哨兵验证 summary 无用户 ID、角色名、备注或 URL。`productionReady` 始终为 false。

## 隔离应用与真实库证据

`readLegacyPreferencesBaseline` 只读取绑定用户的必要目标字段及指定媒体元数据。`initializePreferenceFixture` 只在专库建立两张合成回执表。`applyLegacyPreferences`：

1. 复用 `assertFixtureDatabase`，同时强制数据库名恰为 `codex_migration_preferences_1109`，连接端点必须逐字匹配本报告命令中的专用 URL（包括端口 56389）。目标须 isolated-fixture/synthetic、loopback，实际连接字符串与目标一致，实际库名和 synthetic 标记匹配；没有生产 CLI 或自动配置发现。
2. 要求 `writersStopped`、`notificationsCaptured` 均为 true，检查规划摘要、冲突和逐字段授权。
3. 单事务内取得涉及真实表和回执表的写入排他锁，重新读取整个受保护基线。计划后任何相关目标或媒体变化均要求重规划。
4. 只 UPDATE 上表六个明确列；不使用联系人业务创建或设置端口，不调用同步/outbox/费用/模型/通知。源墓碑清除只改偏好链接，不删媒体。
5. 字段前后指纹及计划回执同事务提交。故障会连同已写字段和回执一起回滚。相同计划并发只应用一次；重跑重新核对字段回执，缺失/损坏回执报错。成功导入后再编辑的值保留并返回 `changedAfterImportPreserved`，不被旧计划覆写。

本次仅使用根会话明确建立的 Docker 容器 `codex-migration-chat-1109`，实际 label 为 `weiban.fixture=migration-1109`，端口 `127.0.0.1:56389`；在其中自行创建专库 `codex_migration_preferences_1109`。没有连接其他库进行业务查询，没有清理共享 `weiban_test`。复用 `openLab` 的真实 Migrator、Database、账号默认值与会话 fixture；随机密码/密钥仅生成于合成测试，密钥不输出或写文件，关闭 lab 后清零密钥。

最终测试在主会话确认 `0164_legacy_group_memories`（含最后的 `encoded_bytes` 变更）冻结后进行。重建前核对本专库 `current_database/synthetic` 与 0 活动连接，只删除/重建自己创建的这一个库；没有改迁移账本或绕过校验。专库当前保留合成 fixture 供后续独立复核。

## 开发自测

```powershell
$env:MIGRATION_PREFERENCES_DATABASE_URL = 'postgres://postgres@127.0.0.1:56389/codex_migration_preferences_1109'
$env:TSX_TSCONFIG_PATH = 'apps/server/tsconfig.json'
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test scripts/ops/legacy-delta-preferences.test.mjs
pnpm exec eslint scripts/ops/legacy-delta-preferences.mjs scripts/ops/legacy-delta-preferences.test.mjs
pnpm exec prettier --check scripts/ops/legacy-delta-preferences.mjs scripts/ops/legacy-delta-preferences.test.mjs
```

结果：**25 项全部通过**；冻结后先重建完整 schema 验证，随后收紧专用 URL 门禁再复测通过。不以合成小规模时长估算正式迁移窗口。覆盖：

- 16 项纯规则：v1/v2 权威与墓碑、源缺项、明确审核、旧墓碑保护、新编辑/隐藏/清空/归档/删除/退群、默认来源证明、指纹漂移、20 字限制、目标改回原值的编辑清单、显式 null、版本冲突、身份歧义/归属、媒体状态/用途/hash、待处置内容及公开摘要不泄漏。
- 9 项真实 PostgreSQL：六字段应用及重复执行；计划后变化锁内阻断；审核后六字段清除且原媒体不删；中途故障整事务回滚；同计划并发幂等；导入后新编辑保留及损坏回执拒绝；媒体失效阻断；新账号默认来源证明和 pending 保留；生产/错库/错端口/错连接/缺维护/篡改计划拒绝。
- 正常应用前后，实际 sync/outbox/ledger/charge/reply-plan 相关表的聚合行数一致。测试库没有启动后台业务 worker；本模块也没有相应业务端口。

保留失败证据：首次运行命令未指定服务端 TSX 配置，因参数装饰器转换失败；增加正确 `TSX_TSCONFIG_PATH` 后运行。随后同一合成库复测曾因其他任务在开发中的 0164 校验和变化止于 before hook，未执行偏好断言；遵守门禁、冻结后重建自己专库，最终 25 项通过。没有为通过测试修改迁移校验器或其他任务的 SQL。

## 未完成范围

未读取真实偏好、未验证真实迁移媒体、未收集生产逐字段编辑证明，未演练线上流量或实际停写窗口；不能把合成通过等同正式放行。完整偏好迁移还需星标、用户标签的明确产品处置以及待处置/无法映射记录的受保护恢复方案。

主会话给出的 61 份人设备份都有对应非空 customization，仅作去重提示。本轮没有重导：旧 [persona_customization_store.js:277](C:/wb-ref/old-weiban/server/lib/persona/persona_customization_store.js:277) 已优先保留非空定制及 reset，整卡 backup 是兼容镜像；必须按账号/角色/版本/状态核对。现有 extras 导入把 `patch.raw_persona` 转成字符串，不能据此证明结构化 merge patch 已完整承接；该适配不在本次偏好范围。
