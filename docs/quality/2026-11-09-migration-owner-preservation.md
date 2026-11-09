# 指定新账号的迁移保留保护候选

本分工仅处理迁移工具。工作树 `C:/wb-dev/wb-migration-rehearsal-1109`，开始基线随主会话纯格式提交推进到 `3e7bf255d88501ce7c52574efb94fb62351bf675`；本分工未提交、部署或连接线上。经理决定指定账号完全按新版新用户保留，不承接旧账户/密码、消息、关系、记忆、权益、偏好、收藏、媒体和渠道。本报告及新增代码不登记该账号的昵称或明文身份；固定不可逆名单由主会话提供的统一helper/JSON维护，本分工未改名单。

## 实现

新增 `scripts/ops/legacy-migration-owner-guards.mjs` 只编排既有固定helper。`options.additionalPreservedOwnerDigests`只能增加合成测试/操作范围，固定名单每次自动执行；没有“替换名单”“空数组关闭”或跳过固定检查参数。

| 入口 | 保护行为 |
| --- | --- |
| core聊天转换/聊天计划、账号、通用protected-record、删除范围 | 有源owner先于内容转换/映射检查；检查源与目标身份，聊天计划保留源owner溯源。批量可跳过时只返回owner摘要、固定分类和数量；单会话/单账号单元在不允许时明确拒绝。泛型记录/删除必须提供可核对owner，不能拿匿名key猜归属 |
| db聊天/缺失账号执行 | 先检查整份实际写计划的owner、消息、用户state/participant以及源账号；再核实真实会话归属，重新签署摘要或伪装plan.owner不能绕过。保留原weibo-user→binding→conversation锁序、generation翻译及待发任务排空门禁 |
| relations | 过滤受保护来源与目标映射，缩小基线范围；插入前核对实际引用的目标会话owner，防止把允许用户的声明套到受保护会话 |
| favorite-sources | 旧sourceUserId与新userId都查；不授予被排除来源分区，不新建其媒体链接；全批链接先查真实media.owner并核对原有可用性接口 |
| entitlements、角色专属group-memory、shared-group适配 | 单元owner/旧owner均先于读取正文、委托服务或写事务拒绝；群记忆还核对真实目标群/私聊归属，shared服务由主会话另外设置内部防线 |
| preferences | sourceUserId与ownerUserId都查，候选保留来源归属；保护初始/新版编辑规则不变。整批实际变更owner和媒体目标先核验；只为专用保留测试库增加了精确名称/回环端点许可，未放宽到共享库 |
| media规划/搬运/导入/底层迁移port | 剔除受保护对象后重新汇总共享源文件，其他owner的相同源引用继续搬运；执行前核验整批对象的源/目标owner和已存在目标媒体归属。孤立文件（无允许owner对象引用）拒绝，不能删除对象条目、重签摘要后仍搬运其文件。原始媒体不删除 |
| weibo元数据规划 | 旧用户ID和userMap映射后的用户ID都查；受保护记录不产生槽位承接/凭据动作，仅摘要跳过回执 |
| 三个旧full import | 在已经读到源owner清单后、第一笔业务写之前整批预检。media另预检头像绑定及实际目标会话/媒体归属。不自动删除旧来源，不运行这些旧生产CLI |

普通新版注册、发消息、付款和后续正常星标/标签保存不引用本策略。业务服务的迁移专用入口由主会话/个人定制分工负责，其实现及验证不计为本报告成果。

## 开发自测

新增 `scripts/ops/legacy-migration-preservation-domains.test.mjs`，全部身份为自行生成的合成owner，额外摘要由运行时计算；真实名单只以不可逆摘要检查“默认及任意extra均不能关闭”，没有读取或构造真实身份明文。

专项覆盖：批量摘要跳过、单元固定类别 `LEGACY_MIGRATION_OWNER_PRESERVED` 拒绝、错误userMap改投、保护源owner→允许目标owner、实际受保护会话与伪造声明不符、共享文件保留其他引用、源文件原字节不变、重签媒体计划及孤立文件拒绝。对8类迁移执行入口及伪造目标归属，使用真实PostgreSQL，并观察SQL执行：业务INSERT/UPDATE/DELETE/DDL尝试为0；合成受保护账号12类既有记录的完整内容指纹前后一致，不只比较counts，也不把“回滚后相同”冒称开始写前拒绝。

测试数据库仅 `codex_migration_preservation_1109`，端点 `127.0.0.1:56389`，容器 `codex-migration-chat-1109`（核对 `weiban.fixture=migration-1109`）；复用现有openLab的精确回环/专库/合成标记门禁。未使用共享weiban_test、生产配置、旧真实SQLite、用户导出、真实凭据或用户真机。

复现专项：

```powershell
$env:TSX_TSCONFIG_PATH='apps/server/tsconfig.json'
$env:MIGRATION_PRESERVATION_DATABASE_URL='postgres://postgres@127.0.0.1:56389/codex_migration_preservation_1109'
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test scripts/ops/legacy-migration-preservation-domains.test.mjs
```

同时运行core/entitlements/shared-group/weibo纯规则，媒体实际加解密/解码/中断续传回归，以及真实DB聊天/关系/收藏来源/群记忆/偏好回归。已有测试改动只为明确owner上下文、允许这个精确合成专库、以及共享合成库串联时比较本次操作前后副作用；未关闭原安全门禁。旧full import CLI本轮未启动，源预检由同一可直接测试的函数负责；对它们不能宣称真实批量迁移验收通过。

这仍是独立环境开发自测，不是上线、真实迁移或独立验收。摘要能绑定已提供的身份事实，不能替代正式受保护执行环境对源owner映射真实性的核实；未知owner直接拒绝，不能猜归属。

最终回执：7项专项＋64项真实DB/规划回归＋17项媒体回归＋27项纯规则，共115项通过，0失败/0跳过；定向ESLint、Prettier与diff空白检查通过。未启动HTTP应用、真实消息消费者或外部API，测试进程已退出。专库保留为纯合成复核环境交主会话，未删除任何旧来源；后续星标/标签实施另用新的专库，不复用这份测试数据。
