# 旧运行库遗留三表：保留规则与源码核对

日期：2026-11-09。执行者：Codex 媒体/安卓子任务，当前工作为来源清单补充。性质：**独立副本开发自测，不是正式迁移或独立验收通过**。

- 工作目录：`C:/wb-dev/wb-migration-rehearsal-1109`；分支 `codex/migration-rehearsal-20261109`；本次开始时提交 `35f510f1ecfbe9b7ced2e0d3e1655ed9c1716981`。本报告对应其上的未提交清单规则和测试；提交由主会话统一处理。
- 旧源码固定提交：`2c5632e2ed66f5144d8f7bbad805a4f9d913a0d5`，目录 `C:/wb-ref/old-weiban`。
- 只读范围：旧源码 `server/lib`、`server/routes`、`server/*.js`、`server/tests` 及这些受控源码路径的本地 Git 历史。不读取数据库、导出、备份、私有配置、用户正文或实际旧码；不连接线上。
- 本次仅修改 `scripts/ops/legacy-delta-inventory.mjs`、对应测试及本报告；未改主报告、业务服务或旧库。

## 结论与聚合观察边界

三张实际运行库遗留表必须单独登记，**只保留加密历史，禁止恢复旧业务、兑换、发放权益或重放**。保留原数据库及与其匹配的备份，不执行删表或清除行；后续删除需要明确指令。历史代码停止接受旧码是既有事实，本次没有新增激活、作废或权益裁决操作。

以下是主会话提供的只读结构/聚合结果，本子任务没有独立查询运行库；不得当作最终停写时刻的清单：

| 观察时间（UTC） | 表/范围 | 聚合事实及限制 |
| --- | --- | --- |
| 2026-11-09 04:24:54 | 运行库/当前源码 | 运行库 112 张业务表，加 SQLite 内部表共 113；当前源码扫描有 110 个声明名称。运行库独有 `chat_messages`、`licenses`、`cdks`；源码独有 `chat_groups_dynamic_migration` |
| 2026-11-09 04:24:54 | `chat_messages` | 0 行；仍须保存结构及当前行数、无业务消费者证据，不能自动跳过 |
| 2026-11-09 04:24:54 | `licenses` | 0 行；同样不能因为空表省略核对或删除 |
| 2026-11-09 04:24:54 | `cdks` | 3 行；没有读取 `code` 或真实用户值 |
| 2026-11-09 04:27:35 | `cdks` 使用状态 | 3 行的 `used_by`、`used_at` 均为空，已使用为 0；存在尚未使用的历史码，不能因数量与旧初始化样例相同就猜为种子或自动丢弃 |

主会话提供的结构摘要：`chat_messages(id,user_id,chat_name,content,timestamp,is_me,created_at)`；`licenses(id,user_id,plan,starts_at,expires_at,max_friends,voice_enabled,group_chat_enabled,early_access,source_cdk,status,created_at)`；`cdks(id,code,type,used_by,used_at,created_at)`。其中 `chat_messages.id`、`cdks.id` 为 INTEGER 主键，`licenses.id` 为 TEXT 主键。`cdks.code` 是否存在实际 UNIQUE 约束仍以最终结构元数据为准；合成测试中的 UNIQUE 不是生产约束证明。

## 当前源码证据

以下指针均对应上述旧源码完整 SHA；可在受控源码目录复核，无需打开实际数据。

| 指针 | 已核实事实 | 对迁移的含义 |
| --- | --- | --- |
| [activation.js:1](C:/wb-ref/old-weiban/server/routes/activation.js:1) | 注释明确记录 CDK 激活于 2026-08-09 废弃；该文件现用于会话、权益和版本配置 | 不能因文件名仍为 activation 就恢复 CDK |
| [activation.js:24](C:/wb-ref/old-weiban/server/routes/activation.js:24)、[activation.js:120](C:/wb-ref/old-weiban/server/routes/activation.js:120) | `sessionSnapshot` 调用 `resolveAccount`；`/activation/heartbeat`、`/license/me` 返回当前会话权益 | 这些仍在使用的 HTTP 兼容入口与 `licenses` 表不是同一件事，不应删除入口 |
| [auth_middleware.js:14](C:/wb-ref/old-weiban/server/lib/auth_middleware.js:14)、[user_store.js:216](C:/wb-ref/old-weiban/server/lib/user_store.js:216) | 权益来自 `app_users` 会员字段及 `effectiveMembership`，不再读写 `licenses` | 历史 licenses 不能直接发放当前会员权益 |
| [membership_grant.js:23](C:/wb-ref/old-weiban/server/lib/membership_grant.js:23) | 当前订单发放调用 `userStore.setMembership` | 旧码表不是当前订单/履约凭据 |
| [account_deletion_policy.js:60](C:/wb-ref/old-weiban/server/lib/account_deletion_policy.js:60)、[account_deletion_policy.js:345](C:/wb-ref/old-weiban/server/lib/account_deletion_policy.js:345) | `chat_messages`、`licenses` 作为带 `user_id` 的生产遗留空表登记在注销清理范围；当前仍有这一维护性消费者 | “无消费者”严格指**无业务读取/写入/激活消费者**，不能声称源码完全没有出现表名 |
| [account_deletion_policy.test.js:147](C:/wb-ref/old-weiban/server/tests/account_deletion_policy.test.js:147) | 合成测试建两表检查注销注册 | 测试 fixture 不是现行聊天或授权业务 |
| [migrations_registry.js:251](C:/wb-ref/old-weiban/server/lib/migrations_registry.js:251) | `0009-group-dynamic-mode` 建 `chat_groups_dynamic_migration`，复制后于第 277 行更名回 `chat_groups` | 这是迁移中间表；正常完成后没有这个名称不是业务数据缺失 |

仅从表名数量解释，`110 个声明 − 1 个中间表 + 3 个运行库遗留表 = 112 张业务表`。这只是差集解释，**不是字段、行、用户内容或迁移完整性通过证明**。清单原有 `schema_control` 审核门禁继续保留；未知表仍阻断。

## 历史提交证据及不可推断事项

在旧源码仓库按下列完整提交及路径复核；无需读取任何历史码文字或初始化具体值。

| 提交 | 路径及证据 |
| --- | --- |
| `7c95e2155afd7458cc3cf96c7e4ac72f51678e7d`（2026-06-11） | `server/db.js` 的早期初始化创建整数用户归属的 `cdks`，并包含三种时长的样例初始化。只能证明当时源码有样例，不能证明运行库当前三行的身份 |
| `1de4bae7fbe3d89d852c5634a3fe3fa5e8106e07`（2026-06-13） | `server/lib/license_store.js` 等引入 licenses 体系；当时 `cdk_store` 使用 `cdk_codes`，与更早整数用户体系的 `cdks` 不同，不可混同 |
| `9d4965dbfca4e23b513df14c1b255e44ab6dafa9`（2026-07-02） | 删除 `server/routes/cdk.js` 及挂载和旧 CDK 分支。其父版本 `/verify-cdk` 查询 `cdks`，按 day/week/month 延长旧 `users.vip_expire_at`，然后写 `used_by/used_at`；不是现行 `app_users` 会员模型 |
| `57d710f1226b9f0d6fb690307bb305b7342a0f21`（2026-07-03） | `server/db.js` 删除 cdks 建表及样例初始化；`license_store`、认证与 activation 清理 licenses 建表/读取/更新及旧授权分支 |
| `74b16560588f8e043bb379dff2bb83a29854a385`（2026-07-09） | 清理 licenseStore 命名，改为 userStore，避免把历史名称误读为仍在使用 licenses 表 |
| `f01f885b785e4b43a5ef6668496ebb31cec54d17`（2026-08-09） | `server/routes/activation.js` 明确记录 CDK 废弃，清理残留；当前文件保留该说明 |
| `0c8f0db85a2b2e20c005f32d15ebe571a6327ef5`（2026-09-21） | `server/lib/account_deletion_policy.js` 登记 `chat_messages`、`licenses`，防止遗留表使注销覆盖检查失败 |

在本次受限源码/历史范围内，没有定位到 `chat_messages` 最初的实际业务建表或读写来源。不得把它猜成 `chat_history` 的同义表并导入聊天。`cdks.used_by` 的早期整数用户模型也不能直接猜测映射为当前 `app_users` 的 UUID。

## 清单门禁实现

`migrationDomainRule` 分别返回 `retired_chat_messages`、`retired_licenses`、`retired_cdks`，唯一 action 为 `retain-encrypted-history`。所有列只允许 `retain-encrypted` 且不允许目标映射；不能用 `exclude-reviewed` 丢弃历史。原库、匹配备份、可恢复加密归档、无现行业务消费者、禁止恢复/兑换/发权益/重放、未经指令不删除，均要求证明摘要。CDK 额外要求“不按样例猜测丢弃”和“不猜数值用户映射”。

规划输入增加 `retiredTableObservations[table]`，仅接受以下元数据字段：

- `schemaDigest`、`tableDigest`、`sourceFinalDigest`：必须与当前规划结构及来源终态快照一致。
- `observedAt`：明确 UTC 时间，必须落在本次迁移窗口内；并不把上述历史观察时间硬编码为永久豁免。
- `rowCount`：非负安全整数，空表也必须给出。
- 仅 `cdks` 还必须给出 `unusedRows`、`usageMarkedRows`；前者为 `used_by` 与 `used_at` 都空，后者为任一使用标记非空，两者之和须等于总行数。这里仅定义安全聚合接口，不执行查询。
- `consumerSourceCommit`、`consumerSourceDigest`、`consumerScanDigest`、`businessConsumerCount`：固定扫描源码版本、源码摘要及消费者核对证明；业务消费者数须为 0，扫描摘要须与 decision 的 `no-runtime-business-consumers` 证明匹配。注销维护路径须在证明中明确区分。

`decisions[table].retirementReview.observationDigest` 必须等于整个该表观察元数据的 `inventoryDigest`。任何结构、来源快照、观察时间、行数、CDK 使用状态或消费者源码变化都会使旧 review 不再匹配；需要新的人工审查与证明，不能复用此前“0 行”或“三行未使用”结论。

`cdks.code`、`licenses.source_cdk` 明确为敏感旧码。直接 mapping 以及 `SELECT *`/指定列普通导出均阻断；三表任何普通导出也阻断，只有单独受保护的历史保留方案可承接。规划结果只返回固定表/字段名、动作、限制与分类诊断，不回显 observation、行、旧码、任意路径、用户值或自由文本。未知 observation 字段直接阻断。

该模块仍是纯规划器：不读数据库、不运行旧业务、不写加密归档、不执行删除，也不核验外部摘要本身的真实性。`productionReady` 永远为 false；源码扫描仍因缺少运行库验证保持阻断。摘要有效只说明所提交元数据相互绑定，不是外部证明真实或归档恢复成功的保证。

## 开发自测与剩余限制

2026-11-09 独立副本开发自测：

| 检查 | 结果 |
| --- | --- |
| `node --test scripts/ops/legacy-delta-inventory.test.mjs` | **39 / 39 通过，0 失败、0 跳过**；原有 28 项加本次 11 项。仅使用合成结构、计数及摘要 |
| `pnpm exec eslint scripts/ops/legacy-delta-inventory.mjs scripts/ops/legacy-delta-inventory.test.mjs` | 通过，无诊断 |
| `pnpm exec prettier --write` 指定两脚本及本报告 | 两脚本格式完成；报告遵循仓库现有 Markdown 格式忽略规则 |
| `git diff --check` 指定本次三文件 | 通过 |

新增测试覆盖三表分别归类、空表证据不可省略、禁止恢复/兑换/发权益/重放/丢种子、所有列加密保留、两个敏感字段直接复制及通配/指定列导出阻断、无效/缺失/不一致计数、行数和使用状态变化使旧 review 失效、结构/快照/观察时间/消费者源码变化、无业务消费者证明、拒绝并不回显原始值、相似未知表继续阻断。未运行数据库读写、正式归档或旧码兑换。

正式迁移仍需在冻结窗口重新核对完整运行库结构、三表当前计数、实际部署源码/外部消费者、匹配备份及加密归档可恢复性。当前源码无业务消费者证明不覆盖未纳入的外部脚本，也不自动证明生产加载的代码正好等于本地固定提交。三条未使用旧码保留历史，不自动承诺新站兑换资格，也不自动撤销；任何后续权益处置或删除均属另行明确决定。本次不涉及恢复码承接，既有恢复码停用决定不变。
