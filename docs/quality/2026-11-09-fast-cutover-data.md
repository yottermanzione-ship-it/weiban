# 今晚最小数据迁移准备

2026-11-09 19:59（北京时间），工作树 `C:/wb-dev/wb-migration-fast-1109`，基线 `3d0b0c6194e3654cc43cd45e3b85de4c19f2826a`。本轮准备约 16 分钟。仅离线代码；没有连接线上、写线上或执行真实迁移，没有提交。

范围已缩减为账号、联系人/会话、聊天、已批准的精确消息隐藏。旧用户人设与旧记忆不迁入；统一使用已经在新站的角色卡，不创建旧私有占位卡。星标标签/收藏新增兼容不作为前置。固定保留账号全域排除；其积分/年卡由主会话另做。

## 最短复用路径

10-24 的 `import-legacy-content.mjs` 不能直接重跑：它会创建旧私有角色卡、把迟到历史追加到末尾，并提高已有已读游标。11-08 已确认有交错历史及隐藏/归档目标。这里只复制已演练的必要纯规划和 SQL 到 `fast-cutover-*.mjs`，不引入整个 PR 124、正式 ledger、永久业务表或服务；聊天重排沿用事务内临时序号映射表，提交后自动释放。

| 模块 | 直接调用 |
|---|---|
| `fast-cutover-accounts.mjs` | `planFastAccounts` / `applyFastAccounts`；只 INSERT 缺失新账号，已有密码、资料、余额、会员均不更新 |
| `fast-cutover-relations.mjs` | `readLegacyRelationsBaseline` / `planFastRelations` / `applyFastRelations`；明确角色 ID 映射、官方小V、群及成员，仅新增缺项，保留新站删除/归档/退出状态 |
| `fast-cutover-core.mjs` | `prepareFastChatRows` / `planFastConversation`；稳定消息 ID、群 UUID/BINARY 顺序、私聊数字顺序、原时间及完整文本 |
| `fast-cutover-chat-db.mjs` | `readConversationBaseline` / `applyFastConversation`；同事务重排与新密文写入，翻译已有清空/已读/记忆/收藏序号，强制旧客户端重建 |
| `fast-cutover-deletions.mjs` | `planFastDeletions` / `applyFastDeletions`；只对核实的精确片段 INSERT hidden_messages，每用户一次游标失效；不物理删除、不改记忆/收藏/媒体 |
| `fast-cutover-owners.mjs` / `fast-cutover-execution.mjs` | 固定账号排除；显式连接串、数据库名/OID、sourceDigest、planDigest 核对；所有 apply 默认 `execute=false` |

没有自动连接或读取环境配置；调用方显式提供真实 Database、EnvelopeCrypto 和 `MessageContent.parse`。正式执行确认对象为：`{action:'APPLY_FAST_CUTOVER_20261109',connectionString,databaseName,databaseOid,sourceDigest,planDigest}`，另传 `execute:true`。这只检查目标/输入身份，**不声称证明服务已停写或备份已完成**；维护由主会话控制，当前授权仍不执行线上。

## 操作顺序

1. 主会话统一暂停两端聊天、修改资料、充值新单、AI/通知/渠道等写入者，排空进行中任务；先备份目标数据库/媒体并固定回退点。收款承接由付款助手单独协调，避免双站认单。此步骤不在本模块自动执行。
2. 在冻结点一致读取旧源和目标，私人字段/密码哈希只在程序内存，生成 sourceDigest；不得再用原脚本的明文 gzip 输入/私有媒体计划落盘。先过滤固定保留账号。
3. 账号：旧 `app_users.id/username/password_hash/created_at` 映射为 `id/username/passwordHash/createdAt`，role=user、status=active。缺失且 10-24 前已存在的账号先阻断，不能当新用户复活；用户名/alias 冲突阻断。使用真实 `SettingsService.createDefaults(tx,...)`，新迁入账号主动消息/来电关闭。已有账号不改密码。
4. 关系：角色仅从当前新站卡取得明确 ID；旧名称不明/多义就列阻断，不能造卡。sourceRelations 形状沿模块注释；小V用 kind=official。核实删除/曾导入清单后提供 protection；缺失的旧好友不自动重新添加。账号补入后重读真实关系基线再应用。
5. 附件：先完成本次所需正常附件的真实拷贝/校验，给 `mediaReady` 映射；缺附件的明确 missing_file/no_reference 项通过 `missingMedia:[{table,sourceId,ownerUserId,sourceRowDigest,reason}]` 输入，绑定完整原行与 sourceDigest，转为“旧×附件不可用”的文字并保留引用/时间，不再找回。pending、错归属、错用途和其他 I/O 失败不能冒充缺失。
6. 聊天：按明确关系 binding 转换旧记录，`initialCutoff='2026-10-24T12:02:47.053609Z'`，最终 cutoff 为本次冻结时间；已删除源记录排除。每会话重读基线→计划→核对冲突为0→同事务应用。现存消息密文/撤回/隐藏状态保留；记忆正文不迁入，只为聊天序号重排调整既有引用游标。新基线没有0165渠道回复边界列，本模块不写渠道配置。
7. 在聊天完成后重新取精确删除片段的当前 owner/conversation/id/clientId/seq/status。删除输入还要求 `table/sourceId/part/sourceRowDigest/sourceCreatedAt/sourceDeletedAt/actorScope(user-message或user-clear)/fullSourceScope:true`；只接受 10-24 前原消息、之后用户删除的冻结范围。最终 quote 引用非0即停下重审；已缺首条的2个来源不创造删除对象。保留角色记忆/摘要及收藏，符合已告知的旧用户清屏语义。
8. 主会话单独调用财务幂等补偿；核对新增/保留/排除/缺附件/隐藏数，抽查登录、历史顺序、未读与媒体访问。最后由主会话决定放行和入口切换。

每阶段只输出分类及数量；计划和密码哈希不打印/不写明文文件。若 COMMIT 回包丢失，先读实际数据，再用同一冻结源重新规划；稳定 ID 排除已写部分，不能把异常当成已回滚，也不要盲重跑原计划。原计划的基线不一致会拒绝。

## 当前证据和剩余工作

七个模块均通过 Node 语法检查；无 TS 依赖的 core/chat-db/accounts/deletions 已做离线 import 检查；格式及 diff 检查通过。这里只记录新副本实际检查，**没有运行新的 PG 测试或将旧副本测试算作本版通过**。

第一阶段尚缺的输入编排现已接续，见下节；完整线上执行命令仍未验证。主会话集中做一次本版真实 schema 验收，补足真实媒体传输与最终停写/备份证据。

安排上建议给“接一次性输入 + 一轮必要验证”预留 40–60 分钟，正式窗口另给 30–60 分钟操作预算并保留回退余量；这是排程估计，未测的网络附件体量和冻结后新差量可能使其变化，不是已测停机时长。若映射、媒体或最终对账仍有冲突，应当保持维护或回退，不能为午夜期限覆盖新站数据。

## 20:44 接续：内存流总入口（尚未执行测试）

新增 `fast-cutover-export.mjs`、`fast-cutover-source.mjs`、`fast-cutover-runner.mjs`。本阶段依指令只写代码并格式化，没有运行导出、runner、数据库测试或连接线上。

源入口在**一个 sqlite3 -readonly 连接的只读事务**内先取用户 UUID、排除固定账号，再读取必要账号/会员/基础资料、好友、群/成员、首次截止后的消息、旧消息删除关联和读游标。没有 require 旧 app/db，没有 Python，没有人设/记忆/朋友圈导出。stdout 必须为 pipe/socket，内容是私密 gzip JSONL；stderr 只有类别与计数。文件引用只 stat，权限/格式/外部引用不误报 missing。

```sh
# 默认仅供计划，旧站仍运行时不传 --frozen。
node fast-cutover-export.bundle.mjs --db /opt/weiban-server/weiban.db \
  --root /opt/weiban-server --cutoff "$SOURCE_CUTOFF" \
  | <受保护SSH或内存管道> node fast-cutover-runner.bundle.mjs --plan \
      --benefit-cutover-at "$BENEFIT_CLOCK"
```

最终源必须由根实际停止 `weiban-server` 这个 PM2 app（不停止PM2守护），并停止真实独立语音服务；可同时传 `--writer-units weiban-voice-agent.service,weiban-voice-bridge.service --confirmed-process-stop --frozen --freeze-id "$FREEZE_ID"`。两个真实 unit 会核对 LoadState=loaded / ActiveState=inactive / MainPID=0，前后各一次；PM2 主进程停止由根核验，输出明确标为 operator-confirmed，不伪称 systemd 已证明全部进程冻结。未冻结源永远不能 execute。

目标 runner 加载现有 HK 环境配置和 KEK、实际 MessageContent/SettingsService，**不启动 Nest 或 worker**。顺序为账号→关系→媒体→聊天→精确隐藏→权益。只给 active 且 role=user 的普通账号（含新版独有账号）发全员100；特殊账号、admin、注销中账号排除。既有新站密码/资料不更新；新增旧号继承旧hash及可兼容基本文本资料。头像不冒充已迁入。

```sh
<同一冻结gzip流；如需保管只经age加密，不保存明文gzip> |
  node fast-cutover-runner.bundle.mjs --execute \
    --confirm-maintenance "$FREEZE_ID" \
    --expected-database "$TARGET_DATABASE" --expected-oid "$TARGET_OID" \
    --expected-source-digest "$REVIEWED_SOURCE_SHA256" \
    --operator-id "$ACTIVE_ADMIN_UUID" \
    --rounding "$MANAGER_SELECTED_RULE" --benefit-cutover-at "$FIXED_BENEFIT_CLOCK"
```

目标还检查没有其他普通 DB 客户端连接；这不代替根实际停新 app。计划只输出分类/计数及 sourceDigest。新版不存在的普通/本人角色映射会列入 deferred 并留在旧源，不创建角色卡、不借用他人私有角色。关系过滤保留既有删除/归档，不恢复旧好友；新群默认不伪造已读。

需要搬运的媒体通过 `--media-plan-fd 3` 输出私密 JSON，FD 必须为 pipe/socket，可直接交根的加密管道或媒体调用器，不能落明文文件。已 ready 对象执行时会用 `fast-cutover-media` 做实际归属/解密/hash复核。新对象可使用下述 CLI settings 接入已建立的 SSH master，也可由根注入 `runFastCutover({...,importMedia:objects=>importFastCutoverMedia(...)})` 的内存回调。没有 settings/输入回调且新媒体未就绪时，execute 在聊天前返回 `FAST_MEDIA_INPUT_REQUIRED`；账号/关系阶段可能已提交，回执明确说明，重新用同一源规划继续即可。存在文件不能改报丢失。

构建依赖：reviewed 仓库的 server/contracts 依赖、sqlite3（仅旧端）、现有媒体运行依赖及财务模块。可由根用已有 esbuild 将 exporter 打为纯 Node bundle；runner bundle 应在 app server 可解析现有 node_modules 的位置运行，并带上财务模块引用的固定策略 JSON。原脚本也可在配有 tsx 的维护环境运行。数据模块仍适配0162，不要求渠道0164先存在。

### 可选的既有 SSH master 接线（仅静态准备，未运行测试）

runner 新增 `--source-ssh-settings /run/wb-fast/ssh-settings.json`。文件仅允许以下非秘密元数据及可选 `timeoutMs`，不接受私钥/口令字段：

```json
{
  "controlPath": "/tmp/wb-fast-control/old-%C.sock",
  "knownHostsFile": "/run/wb-fast/known_hosts",
  "sshAuthSock": "/run/wb-fast-agent.sock",
  "sourceScriptPath": "/tmp/wb-fast-1109/fast-cutover-media-source.mjs",
  "sourceRoot": "/opt/weiban-server"
}
```

仅 `--execute` 且有 settings 时，CLI 组成 `createFastCutoverSshMediaReader` → `importFastCutoverMedia`，复用同一个 Config/Database/MediaRuntime。计划模式不读取该 settings 文件，也不创建 SSH reader。缺省仍是原 plan 或明确缺媒体输入结果。

master 由根提前启动一次；runner 不启动 agent/master、不加载私钥、不更换 known_hosts。读取器只复用已存在 master，master 丢失时通过 ProxyCommand=false 拒绝重新连接。现有 source-frozen/目标身份/管理员门禁仍先于实际读取。root 提供 openssh-client 和精确 socket/public known_hosts 挂载；媒体仍按原 node UID 1000 权限写入。

## 21:19 集中验证结果与最终小修

`fast-cutover-integration.test.mjs` 仅白名单连接 `127.0.0.1:56389/weiban_test_codex_fast_data_1109`，另要求任务环境标记；确认实际 schema 最后为0162、没有0163/0164，不建库、不重置、不碰共享库。首轮1/1通过；补联系人独有变更后的受影响重跑仍1/1，0失败/跳过，4.68秒（用例主体0.96秒）。合成记录保留，连接关闭。

实际覆盖：gzip旧源进入真实PG；保留existing新密码/hash与资料；新增账号继承6位旧密码的bcrypt hash并可验证；新私聊和TEXT UUID群；旧新消息交错合并、原密文/隐藏/已读保护；缺语音保留全文标记；用户旧删精确hidden；新版独有普通user赠分而admin不赠；同数据第二次导出及全链重跑不新增消息/隐藏/积分。所有账号、消息、密码均为随机或虚构测试数据，密码只在进程内。

必要修复：关系事务末尾只对实际新增联系人/群成员的owner使同步cursor过期；没有新增聊天也会触发客户端重建，无变更owner及重复运行不改变cursor。同一用例已验证有变更者7→8、无变更者9保持，以及第二次仍8。ESLint、格式和diff检查通过。

sourceDigest 现为规范化cutoff＋各表原行摘要，排除 capturedAt/freeze观察时间及行输出顺序；同一内容与cutoff重导出保持一致，实际原行改变仍变化。`--expected-source-digest` 使用 runner 输出值，不能用gzip文件的sha256sum替代。默认预览与正式执行均采用已确认ceil，execute拒绝proportional。

密码仍严格“新站现有值优先”。runner仅在内存比较并输出same/different/different-algorithm/same-algorithm-different数量，不回显密码/hash，不自动覆写差异项。这些分类不能证明差异由哪一站改密引起；本轮未新建密码兼容框架。
