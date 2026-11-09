# 旧群记忆漏项：映射候选与隔离开发自测

日期：2026-11-09。执行人 Codex 子 Agent；主会话统一整合，未提交。新工程独立副本 `C:/wb-dev/wb-migration-rehearsal-1109`，本轮沿用主会话当前候选；已有代码基线为 `cc10580419eeb1306b361b799688af85ec52530d`，最终交付 SHA 待整合登记。旧源代码只读路径为 `C:/wb-ref/old-weiban`，未查询旧数据库或读取任何真实记忆/聊天正文、私人资料或凭据。

结论：明确审核映射下的窄子集已实现，并取得 8 项开发自测通过。**旧共享群记忆与新版按角色保存的记忆不是同一种结构，不能直接全表搬入；本轮不关闭实际迁移漏项，不宣称真实旧群记忆全部承接或独立验收通过。**

## 1. 真实代码对应关系

| 来源 | 核实的事实 | 对候选的约束 |
|---|---|---|
| 旧 `server/lib/migrations_registry.js:179` | `group_memories` 包含 `id/group_id/mem_type/content/confidence/enabled/source/created_at`；`mem_type` 是自由文本 | 不把任意旧类型猜成新版枚举，不把 confidence 换算成 importance |
| 同文件 2979 附近 | 后续增加 `subject_character_id/supersedes_id/provenance_json` | 有指定主体必须明确映射，不能扩大成全群；纠正链需单独对账 |
| 旧 `server/lib/memory/group_memory.js:113` | 自动提取写 `source=auto`，内容独立存储，`enabled=0` 可由去重/上限/纠正或管理操作产生；也可物理删除 | 停用内容不恢复；不存在的源行不能从历史副本猜测重建；稳定来源 ID 必须保留 |
| 同文件 170 附近及 `server/lib/group/group_service.js:1033` | 旧普通群逻辑读取全群启用记忆，部分新代码支持主体过滤；记录没有可靠源消息 ID/序号 | 不能把当前群成员当作历史受众，也不编造引用消息 |
| 新 `conversation-memory.ts:378`、`:542` | 真实群提取按历史入群时间、当前联系人及联系时期挑选角色，再把 `origin=group` 的记忆写进各角色的当前私聊记忆库 | 明确校验 owner、群、角色、私聊、联系人和加入时间，拒绝失配或重新加好友后的旧历史 |
| 新 `schema.ts` 的 `group_memory_states` | 该表是游标、重试、租约和整理缓存，不保存群记忆正文 | 候选不把记忆插入该表，不推进其游标、不产生整理任务 |
| 新 `MemoryPayload` / `MemoryEntry`、`memory.ts:627` | 记忆正文按用户加密，用户修改/遗忘会推进 revision/barrier，并更新群整理 generation | 实际采用契约解析与 `EnvelopeCrypto`；目标已有状态优先，屏障不降低 |

旧源代码的观察不证明线上仍是同一版本；正式准备仍需受保护的表结构与映射回执，不能据此读取真实正文或直接导入。

## 2. 候选范围与拒绝条件

新增 `scripts/ops/legacy-delta-group-memory.mjs`，导出：

- `initializeGroupMemoryFixture(database,target)`：仅在通过连接串、专属数据库名及合成标记验证后建立合成来源回执表。
- `readGroupMemoryBaseline`：读取目标 owner、群/私聊、成员、联系人、用户状态、记忆屏障及来源回执，生成受保护基线。
- `planGroupMemoryDelta`：纯计划；输出 `inserts/skipped/blocked` 和摘要。无连接发现、生产命令或自动执行入口。
- `applyGroupMemoryDelta`：只接受隔离目标，重新锁定并比对基线；同事务插入真实 `ai_runtime.memories` 与来源回执，不修改已有记忆、联系人、游标、余额、订单或后台任务。

允许的窄子集需要明确的旧群所属用户映射、历史受众审核、当前群成员/联系人一致、内容普通范围已核实、删除审计完整且没有先前遗忘，以及对“旧记录没有源消息 ID”的明确处置。自由文本类型到新版 category/importance 的映射由受控审核输入，本工具不自动分类。审核标记目前仅接受 `synthetic-*`，不是生产决策文件。

正文使用真实 `MemoryPayload` 格式，保留内容和源创建时间；`origin=group`、`scope=normal`，采用 `only_this_character/never` 限制，`sourceMessageIds=[]` 表达确实没有可靠引用，不伪造消息来源。不调用模型、计费或外部渠道；embedding 允许为空，不发起向量服务。

以下返回 `blocked`，不能在有冲突的整批计划上执行：

- 归属、历史成员、角色主体、普通/成人范围或删除依据不清；成员已离开、重新加好友，或源创建时还未入群/建立联系人。
- 任意未映射旧 `mem_type`、未知来源、未知 provenance、纠正链、超出目标长度或健康隐私规则的正文。不截断、不猜分类，也不绕过既有健康隐私限制。
- 新站已有非本候选导入的原生记忆；既有记忆 revision、遗忘/清空/隐藏屏障、群整理 generation/进度/租约/缓存；超出既有 1000 条记忆容量。这些限制偏保守，需后续逐项冲突方案，不能假定没有语义覆盖风险。
- 计划后目标发生变化；同一源 ID 后续内容变更或不同载荷；来源回执与真实目标身份不一致。

停用源行返回 `skipped`。已迁来源使用 owner＋角色＋旧群＋旧记录的稳定键；来源回执独立于目标记忆存在。目标后来被删除时，重跑会返回 `removed_target_do_not_resurrect`，不重新建立记忆，也不降低遗忘屏障。

## 3. 实际自测与环境

本机 Docker 容器 `codex-migration-chat-1109` 由主会话创建并明确授权使用，先验证标签 `weiban.fixture=migration-1109` 与回环端口 56389。仅新增数据库 `codex_migration_group_memory_1109`，运行真实 151 个迁移，最后 `0162_scan_payments`。未重启或修改该容器服务，不使用共享测试库；合成密码由已有隔离实验工具在内存随机生成，没有密码文件。

运行：

```powershell
$env:MIGRATION_GROUP_MEMORY_DATABASE_URL='postgres://postgres@127.0.0.1:56389/codex_migration_group_memory_1109'
node --test scripts/ops/legacy-delta-group-memory.test.mjs
```

结果：**8 项通过、0 失败、0 跳过**，约 7.040 秒；其中 3 项纯规则，5 项真实 PostgreSQL/EnvelopeCrypto。自建数据库在核对合成标记后已删除，主会话容器和其他数据库未动。

| 实际用例 | 结果 |
|---|---|
| 明确分类、源行去重、停用排除与未知类型/范围/主体/纠正链拒绝 | 通过；使用当前真实 `MemoryPayload` 解析 |
| 并发三次导入 | 只有一次插入，来源回执只有一条 |
| 实际密文读取 | 用所属用户 DEK 和 `ai:memory:<id>` AAD 解密，完整 `MemoryEntry` 通过；另一合成用户解密被拒绝 |
| 导入后删除，再推进群 generation 和私聊记忆屏障 | 重跑不复活目标，屏障及其他基线字节保持不变 |
| 插入记忆后注入失败 | 记忆与回执同事务撤销；随后重跑只插一次 |
| 计划后清空/源载荷变化 | 拒绝执行，不覆盖最新目标 |
| 原生新站手工记忆 | 保持密文字节一致，候选阻断新增旧记忆 |
| 副作用 | 钱包流水与 outbox 均保持 0，群记忆 pending 仍为 0，原 group/memory states 未改 |

两个新增 MJS 的 ESLint、Prettier 检查均退出 0。没有修改生产 schema、服务端记忆产品或旧源码，没有运行收费模型或真实供应商。

## 4. 仍需准备的具体缺口

1. 旧导出器没有群记忆表；正式受保护清单须增加该表及明确所属群/用户/历史成员信息，当前没有最新真实行数。
2. 旧记录缺源消息引用，`mem_type` 也不是枚举。没有受控分类、受众和缺引用处置时，候选只能拒绝，不能以“格式能插入数据库”当作可靠承接。
3. 旧全群共享记忆到新版角色记忆库的可见范围存在产品语义差异；本候选要求明确审核，不自动复制给所有当前成员。已离开成员、重新建立好友关系和新增成员均不能凭当前列表补猜。
4. 已有新站原生记忆/遗忘/清空/整理进度的目标、旧纠正链、未知范围及无对应能力的记录继续列为待对账或受保护归档候选，本轮没有批准丢弃或新增用户权益。
5. 本机 7 秒只覆盖极小合成样本与真实加密/事务行为，不能推算生产停机。实际准备进度应登记为“候选实现及隔离自测完成，真实映射与范围验收未完成”。
