# 旧专属人设：结构兼容、个人运行时与隔离开发自测

日期：2026-11-09。工作副本 `C:/wb-dev/wb-migration-rehearsal-1109`，基线 `f7264477dfa0855ad62c00c93b3ce47c0714644e` 上的未提交候选。实施者 Codex；本报告为开发自测，不是独立验收或正式迁移完成。

## 已确认语义与本轮结果

经理选择保留旧定制效果、补齐专属结构兼容，公共角色卡不改。候选新增 0166、用户级加密结构及本人查看/恢复默认接口，把已核实的旧用户 patch 应用到当前公共基底的对应可编辑字段。未被用户改动的公共字段每次读取当前版本，不把旧官方整卡覆盖新版公共修订。

源语义依据旧源码 `server/lib/persona/persona_customization_store.js` 的 `editableDocument`、`applyMergePatch`、`materializeCard`：对象递归、数组整体替换、null 删除、空字符串保留；raw 字段优先，镜像字段只在缺失时补齐。`character/character_store.js` 的 rowToCard 与 `persona/runtime_adapter.js` 是已知结构到运行时的映射依据。未知格式不猜测。

主会话 2026-11-09T04:44:25.116Z 的聚合证据为 61 条 customized、raw_persona 全部为 object、23 条含 lorebook。本子任务未重新读取生产数据或任何真实人设正文，**没有证明这 61 条全部满足激活条件**；全域保留账号决定生效后，实际候选数量还要重新按同一快照与排除策略核对。旧有损文字转换预检保护保持不动。

## 数据与运行时边界

1. `characters.legacy_persona_overrides` 按 user + character 保存本地版本、active/blocked/reset 状态、来源摘要和 EnvelopeCrypto 密文。密文包含完整固定格式来源、原 patch JSON 字符串、原 base package JSON 字符串及新站承接基线。`legacy_persona_sources` 保存来源版本/摘要去重，`legacy_persona_commands` 保存恢复默认命令摘要。三表均随公共角色硬删除级联清理，账号注销 purge/count 也覆盖三表。
2. 导入格式固定为 `weiban-legacy-persona-v1`；需明确认证 owner、原 persona 名称、原版本、state、base signature/revision、package 字节 SHA-256、截止点及人工核对证据。源 owner 必须与目标 owner 一致，原 base 的稳定角色 ID 必须对应目标 legacy card；没有昵称猜测或最小 patch 猜测回退。
3. **未读取或使用旧签名密钥**。这里核对的是受控来源快照内的 exact signature/revision 关联与 package 字节摘要，不冒称重新验证了 HMAC。正式准备必须由可信源表导出证明该 base_version 关联，缺证据即 blocked。
4. 公共升级本身不是个人冲突。仅新站该用户已有补充设定/覆盖/reset、本人基线变化、来源或映射不明、分类未核实、不支持结构等阻断。已写来源的版本/摘要不可覆盖；同版不同内容或来源重新映射冲突，整批回滚。原 source reset 只写必要防复活摘要，不读旧备份恢复。
5. 公共 `legacy_card`、世界书和示例表均不改。已知性格/情绪/关系/风格字段按 patch 投影到本人的运行列，显式删除清空对应列；其余已支持的个人字段以明确覆盖同名设定的结构分区进入个人角色资料。未改列保持新站当前值，不把整个旧 base 的正文复制进去。
6. `CharacterForRuntime` 新增可选 `legacyContext` 与 `legacyPersonaVersion`；个人词条/示例从同一份个人快照生成。brain、reply-context 和 character-view 优先使用该快照，文字、群、电话及主动路径继续沿同一个 AI_CHARACTER_READ。未改的公共词条/示例继续跟随公共表，个人显式 `[]`/null 不回退复活。群/主动共用 brain 现把命中的个人关键词词条放入原有预算约束的 recall 区。
7. 资格、年龄、真人身份、音色与后台主动开关不能由个人结构放宽。身份保护限定明确的主角色 character/identity 直接字段及 voice/heartbeat 控制路径；亲属性格描述、词条/示例元字段中的 name/age 不被全路径误拒绝。未知结构、来源/分类证据不足以及受保护字段改写均 blocked；私设儿童线索取更严格，新增个人标记不能被公共人工 adult 标记冲掉。恢复默认不清除既有单向儿童特征限制，公共角色和其他用户分类不改变。
8. 服务 importBatch 与 ops 入口都调用统一 `assertLegacyMigrationOwnerAllowed`；固定摘要策略不能由参数替换，额外摘要只能增加排除。被保留的 owner 在首个数据库动作前拒绝，日志与结果不回显其身份。本报告与夹具没有真实昵称/明文账号 ID。

## 本人接口与删除语义

接口由契约 7.11 引入，主会话已在综合候选统一升至 **7.12**；最低客户端版本不因此改变。

| 接口 | 行为 |
|---|---|
| `GET /api/v1/characters/legacy-personas` | 本人状态列表，含角色名称、active/blocked/reset、本地与来源版本、时间和固定原因 |
| `GET /api/v1/characters/:characterId/legacy-persona` | `{item: Detail|null}`；服务器提供人设/说话/相处/群聊/词条/示例的可读分区，不向用户倾倒原始 JSON 或签名包 |
| `POST .../legacy-persona/reset` | `clientCommandId` + `expectedVersion`；版本/命令冲突 409 conflict，重复命令幂等 |

active 代表通过当前核对并被本人运行时采用；blocked 不生效，可安全读取的修改可展示，未知/危险结构不回显。运行时发现目标来源身份变化时，详情也转为 blocked，不能把密文存在显示为已生效。

**保留期**：active/blocked 期间完整原件与承接基线保留在同一用户密文中。用户恢复默认后立即清除在线存储中的该密文，`sections=[]`、`originalRetained=false`，只留来源/版本/命令摘要墓碑；没有“恢复旧原件”按钮，本功能不另存可恢复原件副本。既有系统级备份生命周期未在本次更改。再次导入旧来源不会复活。账号注销清全部新表。这里的恢复默认针对本项旧专属人设；现有新版个人补充设定不被擅自删掉。

## 隔离实测

使用既有容器 `codex-migration-chat-1109`（核对 fixture label），新建且只使用 `codex_migration_persona_1109`、loopback 56389。采用真实迁移至 0166、Nest/HTTP、真实身份/角色/crypto/数据库端口，来源全为虚构；密码只在进程内随机生成。`background:false`，没有启动工作器，没有供应商模型、真实媒体或收费调用。

本机测试库限制为上述专库；正式 CI 仅按仓库已有 GitHub Actions 临时 PostgreSQL 约定校验标志、run ID、host/port/user/dbname，不接受本机共享测试库。Ops 默认只计划，`--execute` 拒绝；函数执行器还要核对实际连接字符串、专库名、synthetic marker、service 数据库绑定、停写及通知隔离证据。不存在 SSH、DNS、生产连接发现或切站路径。

| 检查 | 证据 |
|---|---|
| 新 HTTP/PG 与纯结构专项 | 最终 25/25（15 个真实 PG/HTTP + 10 个纯结构），25.68 秒，退出 0；含同 owner 分批 41 份与主角色字段限定 |
| 旧卡/记忆/级联电话/实时电话回归 | 与当时专项合跑 7 文件 78/78，通过，195.02 秒 |
| 独立 ops 边界 | 4/4，通过；默认计划、owner 全域排除、非隔离目标/错连接/无 marker/无维护证据拒绝 |
| 格式、类型与模块边界 | 最终定向 ESLint/Prettier、server/contracts typecheck、依赖图 610 modules / 2728 dependencies、diff --check 全通过；并行 contacts 测试类型问题由主会话修复后，已重新取得完整 server typecheck 退出 0 |
| 0166 up/down | 空表在真实 PG 中执行 down/up；有任何数据时拒绝破坏性 down |
| 专库清理 | 先确认本任务库 synthetic marker、其他连接 0、新增 seq/cursor 列 0，再删除本任务数据库；最终同名库剩余 0，保留容器及其他库 |

专项覆盖完整加密往返、同 owner 结构生效、公共与其他账号不变、公共升级保留、词条/示例显式清空、并发去重、同版漂移、原 reset、缺证据 blocked、新站本人修改保护、批次原子失败、私有角色跨账号拒绝、统一保留 owner 零写入、个人更严格分类、真实查看/reset 及幂等、旧源不复活、真实 brain/buildCall 上下文、无导入费用/outbox、注销与角色删除清理。40 仅为单批上限，不设每账号累计 40 份限制；同一合成 owner 分 40+1 两批后 41 份全部保留、运行可读，重跑不重复。

发现与修复：首轮实际上下文检查发现 brain 只注入常驻词条，个人关键词词条未进入群/主动共用路径，已补有界 recall 并复测。另一轮失败来自测试夹具尝试修改已有角色 owner，数据库不可变触发器正确拒绝；改为新建合成私有角色，未放宽业务约束。交叉审查还指出累计 40 份限制不适合本次全量承接，以及任意深层 name/age 限制可能误伤他人描述；已去掉累计限制并按明确主角色路径校验。另补显式删除字段清对应运行列、来源身份改变时接口诚实 blocked，以及空年龄不被误判成 0 岁。

0166 SQL 已冻结，SHA-256：up `d8bfcb839b6d442212fe8b2878d288ebb93ce8d6dd952dacaa76cdec81e090b4`；down `c537804373643c40c6bb56d3b37f1c57ef734b3a7774486b189e399fe0d0af79`。没有改迁移账本绕过 checksum。

```powershell
$env:TEST_DATABASE_URL='postgres://postgres@127.0.0.1:56389/codex_migration_persona_1109'
pnpm exec vitest run --project server apps/server/test/legacy-persona.test.ts apps/server/src/modules/characters/domain/legacy-persona.test.ts
node --test scripts/ops/legacy-persona-import.test.mjs
pnpm --filter @weiban/server typecheck
pnpm --filter @weiban/contracts typecheck
pnpm lint:deps
```

## 限制与后续放行条件

没有读取真实 patch/base 正文、没有验证全部实际源的 base 表关联、没有执行正式迁移或真实模型/手机验收。网页由另一代理实现，本报告不代签其界面验收。个人来源中未知的 SoulSpec 字段、记忆抽取/硬件/voice/heartbeat 配置等不会被猜成通用补充文字；保留 blocked 原件，需显式核对能力与来源后另行处理。

仍需主会话在一致来源快照上先应用全域 owner 排除，再核对每项来源、原 reset、确切 base、当前个人基线与分类证据，并汇总 active/blocked/reset/已存在数量。不能用 61/23 的旧聚合数宣称全部已迁或已生效。本机实测时间不是生产停机估计。本子任务无提交、推送、发布、线上配置或入口变更，0164/0165 的群共享及微博候选保持原职责边界。
