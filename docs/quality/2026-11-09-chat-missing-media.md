# 缺附件消息的逐条审核承接：开发自测

2026-11-09，独立工作树 `C:/wb-dev/wb-migration-rehearsal-1109`，基线 `bbc93a0ac085b4acd1c8bad86925a544e0b6ad1d` 的未提交候选。经理已明确决定：**保留文字和时间，明确标记附件不可用，找回后再补。** 本文记录准备代码及合成演练，尚未上线或执行真实迁移。

## 实现与保护

`legacy-delta-core.mjs` 的 `prepareLegacyChatRows` 新增可选 `sourceDigest` 和 `missingMediaReviews`。默认没有逐条证明时，语音/图片/表情仍走原 `MEDIA_NOT_READY` 门禁。

每条审核项严格限定以下字段，不能以批量布尔值放行：

```js
{
  version: 1,
  sourceDigest, // 固定来源检查点
  table: 'chat_history' | 'group_messages',
  sourceId, ownerUserId,
  sourceRowDigest, // fingerprint(完整原始行)，转换时间/补群owner之前计算
  reason: 'missing_file' | 'no_reference',
  proofDigest,
}
```

table/id/实际 owner/原行/来源检查点必须全部匹配。`missing_file` 要求原行有媒体引用，`no_reference` 要求原行没有引用；不接受 permission_denied、未知异常或任意原因。错误 owner、来源漂移、重复/多余证明、非媒体行证明均拒绝。固定保留账号不因例外得到迁移授权。

绑定已经指向媒体时不能回退：pending、外人媒体、错误用途、已 ready 的对象都继续按各自门禁拒绝冲突，不捕获异常后降级。没有把现存 ready 媒体谎称为缺失的通用开关。

确认缺失后生成 `[旧语音附件不可用]`、`[旧图片附件不可用]` 或 `[旧表情附件不可用]` 开头的文字。原正文、引用作者/引用文字及原时间完整保留；使用原 4000 字符分片规则，避免截断长引用/正文。消息和客户端 ID 仍为 `legacyId(...,table,sourceId,part)`，quote_message_id 保持原明确关联。不会创建假 mediaId、下载 URL、重生成音频/图片、计费或通知。

审核摘要写入计划中每个来源片段的 `source.mediaUnavailable`，参与正式计划及事件摘要；运行账本本身只保留摘要与计数。原群 UUID/opaque TEXT 编号、同时间 SQLite BINARY 顺序、私聊 BigInt 顺序等此前修复全部保留。

## 正式 handler 的证明回读与未来修复门禁

来源 reader 通过 `review.missingMediaReviews` 提供明确审核项，并新增 `readMediaReview({proofDigest,tx})`。handler 在 prepare、inspect、apply 和提交后检查中，用同一目标事务回读证明并重算原行及完整证明摘要。返回记录必须严格等于：

```js
{
  // 上述审核项去掉 proofDigest 后的全部字段
  version, sourceDigest, table, sourceId, ownerUserId, sourceRowDigest, reason,
  kind: 'legacy-missing-media-review',
  decision: 'retain-text-unavailable',
  authorityDigest, evidenceDigest,
}
```

证明缺失、读不到、内容改变、权限/来源错配都在写入前阻断。摘要回读证明完整性，不能单独证明有审批权限；**正式 reader 必须认证真实审核来源及实际缺失证据，生产实现本轮仍未提供。** 合成 reader 只回读专库中虚构审核记录，不冒充真实经理签发系统或文件可用性检查。

每个媒体来源另有一个稳定的“来源处理决定”事件，与所有片段回执同事务提交。它绑定原行及完整转换结果，不依赖消息 seq。以后有 ready 文件，普通增量即使看到相同首条 ID，或者准备多出新的文字片段，也会遇到 `CHAT_MEDIA_REPAIR_REVIEW_REQUIRED`，不能默默覆盖或追加另一种转换。相同来源/证明/内容重跑仍幂等。未按本候选记过决定事件的更早历史不自动视为可修复，需单独核对旧导入基线。

本轮实现**禁止自动补附件**的持久门禁，未实现恢复附件的写入器。未来受控修复至少要绑定同 source/owner/原行和原缺失证明、真实找到文件的归属/用途/内容证据，并核对全部目标片段仍是那次承接结果，保护后续撤回/删除/编辑/清空状态；另行规划保留文字与附加媒体的布局。不得借修复重付费、重生成、恢复已删除内容。

## 实际合成验证

再次核对容器 ID `2368b1b65e773eed5eee1a12bf8820e6dcacbe692a98f1cc566536566596adcc`、label `weiban.fixture=migration-1109`、唯一 loopback `127.0.0.1:56389`。只在本任务保留的 `codex_migration_execution_1109`，使用实际 schema 到 0168、真实 EnvelopeCrypto、真实 PG 事务/账本，新增虚构 `chat_media_reviews` 证明记录。未读取真人附件或私有原文。

| 检查 | 结果 |
|---|---|
| core 单元测试 | 18/18，0失败/跳过；保留原13项，新增5项，0.153秒 |
| 第一轮实际聊天 PG | 19/19（18 子用例及父汇总），0失败/跳过，25.35秒 |
| 最终固定文件聊天 PG | 19/19，0失败/跳过，24.92秒（父用例21.13秒） |
| 原聊天隔离执行器回归 | 12/12，0失败/跳过，6.54秒 |
| ESLint / Prettier / Node语法 / git diff | 全部通过，退出0 |

新增实际 PG 场景覆盖缺语音文件、缺图片文件、无引用、长正文/长引用全部分片、原始群空 user_id 加群 owner 证明、错 owner、错分类、受保护账号、pending/foreign/ready 冲突、证明必须回读、原行/证明变动后零写入、同计划重跑、找到文件后拒绝自动修复。原真实 COMMIT 后断线恢复、并发、跨 run、同 owner 多会话等仍一起运行。

测试核对新消息解密后的完整文字、原时间、稳定 ID、引用关系、正式来源回执数量；outbox、模型用量、收费账本没有新增。全部用自建合成数据，临时密码/加密钥匙只在进程内生成，未写入文件。专库及合成资料按经理要求保留，结束仅关闭本任务连接。

本次规则用于经理已批准的缺附件承接方向；主会话此前只读发现的 29 条缺文件及 4 条无引用尚未由本代理生成真实逐条证明或执行导入。没有把合成通过写成 33 条已完成。后续生产准备仍须接齐冻结来源/审核 reader、维护/许可探针、账号关系及全域执行器、加密计划保管和恢复演练。本机耗时不是正式停机估计。

## 账号和关系正式适配的最小后续工作量

沿当前私有事务抽取模式，预计约 3–5 小时开发自测，不含生产探针、真实导出验证或正式停机：账号 1–2 小时、关系 1–2 小时、整链依赖/故障恢复约 1 小时。该估计待具体数据形状及锁顺序核查后调整。

账号可抽取 `applyMissingAccounts` 的命名空间锁、实际 ID/alias 冲突检查、INSERT-only、真实 SettingsService 默认设置和关闭主动，接来源账号事件及 cap；已有账号、密码、余额、会员都保留。关系可提取 `applyLegacyRelations` 的实际事务，保留 `planLegacyRelations` 的角色资格、账号/群 owner、好友缺失、归档/离群/删除保护；正式只读基线入口仍需从 fixture wrapper 分开。两者需实际 owner 核查、排除策略、同事务后态和正式回执，依赖顺序为账号→角色/关系→媒体→聊天。此处仅估计与设计，未修改这些前置执行器。
