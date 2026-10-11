# Codex 产品收口活动断点

## 当前断点（2026-10-12 07:57，优先于下文）

- 上轮是实际进展（全量/安卓/本机升级、32题及草稿PR）；随后真人/儿童草稿在工作区停留，本轮先实查再续接。源码检查点**4cbbad62c03fed3113637a935759b6190a70dbe6**，分支codex/product-closeout、C:\wb-dev\codex-closeout；共享目录再次实查main，未修改。Claude既知JSONL仍2026-10-11 09:04:46/2213073字节，无新会话状态，不发送消息或启动代理。
- 格式修正和文档已实际推送d4dc8c8d61b007265b2807017983999d618eaa13；新push run38162076437、PR run38162079880均真实completed/success。PR run日志github-green-d4dc8c8-clean.log证实**77文件619项通过、0失败0跳过**，411.64s，网页26项(59.0s)/后台8项(14.9s)、安卓BUILD SUCCESSFUL(3m22s)，生产镜像/迁移/双域HTTP/非空加密媒体/空卷恢复/非空目标拒绝演练通过。是d4源码的开发CI证据，不是独立审查或最新4c源码全部CI绿。原两次失败是前轮未修格式，保持历史，不反复rerun旧job。
- 本轮登记真人20题（eval-plan 3.10）和儿童15题（3.11），总151题/10套，版本2026-10-12.2。真人跨日常/傲娇/恋爱重测传闻、时事、编造新闻、未审核候选、自拍和无资料代言；儿童5类场景×贴合度1/3/5，要求实际七夕上下文、补充设定保存但不覆盖儿童事实、待审上下文隔离/无人物图片请求等检查。中性儿童场景不存露骨文本，新增inputKind和模板/实际展开引用字段，缺引用仍待评审；未制作展开模板、受控R-01/C-01完整运行卡或真实执行器，不把题量当作质量通过。
- 新增观察JSONL汇总命令（包build/summarize，tsconfig.build）及逐行类型校验，不增加依赖/SDK/密钥出口。CLI返回0仅为当前登记题记录检查通过、2待评审/缺题、1明确失败或输入错误；报告文件flag wx拒绝覆盖；错误只给行号/字段名、不回显输入。CLI不核实日志真伪或评审者独立性，也不执行模型/运行前置条件。源码首次build因never回调未显式类型导致unknown无法收窄失败，修正类型声明后通过，不改成any或省略验证。
- 最新boundary-evals-round2.log **5文件20项通过**，625ms；boundary-evals-build-round2.log及typecheck-round2通过，全仓boundary-evals-lint-round2.log340模块1474依赖通过，包format-round2通过。已编译CLI实际5分支验证（boundary-evals-cli-round1.log）：空输入exit2、全题fixture记录exit0且scope registered_cases_only、拒绝覆盖、运行时false失败、无效输入不回显canary。verify-eval-cli.mjs及JSONL/报告在仓库外日志目录，文件名含fixture-not-quality；这些fixture不代表真实模型和独立评审。正式pnpm summarize命令实跑空文件（boundary-evals-cli-command-round1.log）返回2，151题待评审，报告另存唯一文件。
- local-model-config-ready-round5.log本轮重新登录正式本机并实际GET列表，入口/刷新/密码框通过、0页面异常，上游仍0条。正式服务仍01:52已验证ba4b76b镜像，新增评测工具无apps依赖、未调整生产数据或发布假供应商，模型由用户后台自行配置的选择不变。真实供应商/角色卡/19类全部材料及执行器、设备、异机离线保管、独立审查仍缺。没有必要因仅评测包变更重跑相同服务端全量或重装同业务镜像。
- 后续先推送新检查点并更新草稿PR/观察新CI，然后继续完整19类材料和真实执行路径。已找到SafetyCare纯函数及高风险分类在domain/reply-rules，可核查默认无供应商下的硬边界运行证据；目前仅阅读线索，不记发现漏洞或已验证缺陷。所有本轮本机句柄已终态；目标活动，仍有可独立推进工作，未暂停/阻塞/完工。

## 当前断点（2026-10-12 02:00，优先于下文）

- 当前源码已推送GitHub独立分支codex/product-closeout，未修改或合并main；[草稿PR #19](https://github.com/yottermanzione-ship-it/weiban/pull/19)已建立并附着此任务，OPEN/draft，建立时head ccde929a0737376a8bea92a334db584663b1882e、base main。描述区分业务基线614项与后续评测包13项，完整19类和实际模型/设备/独立验收仍明确未完成。此PR作为持续接管检查点，不是产品完工请求。
- 首次push CI run38161611453/check失败，直接job日志github-check-job-round2.log证实停止在pnpm format:check：custom-characters.test.ts和web/features/media.tsx两处Prettier换行。不算业务测试失败（尚未进入测试）。本机之前只检查本轮5个文件，未覆盖这两处；现只修格式，无逻辑或断言改变，final-format-full-round9.log全仓格式终态exit0。运行中的run整体日志gh暂不可读，改取已失败job日志并清理ANSI后诊断，未重新触发旧job或关闭检查。
- 02:00观测push run安卓构建与检查SUCCESS，PR run38161811798安卓job仍IN_PROGRESS；两轮check都FAILURE，修正尚待推送后的新CI，不登记CI绿。本机最新完整614/网页26/后台8/安卓123/类型lint生成证据仍以01:52明确源码范围为准；纯格式不要求重跑同业务全量。正式本机仍ba4b76b实际镜像，上游0条，已成功升级，未因草稿PR变更或重装。
- 后续先推送格式及登记，观察新CI具体失败；同时继续不依赖配置的完整考题和执行证据工作，优先真人/儿童。没有发送Claude会话消息、没有创建独立用户线程或代理、没有合并。目标活动，未完工、暂停或阻塞。

## 当前断点（2026-10-12 01:52，优先于下文）

- 上轮有业务修复/19项验证/34项浏览器与模型接入文档进展；本轮继续观察原全量句柄44600，真实终态exit0：full-tests-round8.log **76文件614项通过**，883.38s，开始01:24:53。运行时固定5c8fd5a，收集时包含后来14f0ee9提交的记忆测试上限修正；当前新评测包不在该全量证据内，不能把614用于新增考题质量通过。全仓final-typecheck-round8.log、final-lint-round8.log及final-generated-round8.log通过；契约3.1、888定义/323接口/1201 Kotlin定义一致，源生成未引入漂移。
- 当前源码**ba4b76be5918183485cc89a61a6cd2088a34fdeb**新增eval-plan 3.1安全关怀32题，登记合计116题/8个suite，版本2026-10-12.1。29号夸张作业抱怨单列非硬性过度反应对照；20号即时危险只允许110/120求助渠道。保留儿童/真人、熟悉度、群聊/通话、成人暂停与已触发小巧思前置设置，单题需必需评审项逐项真值及运行时真值与独立日志引用；明确失败不被高分覆盖，缺证据待评审。仅验证引用存在，不核实文件真伪或独立评审身份。判分器和登记最新3文件13项通过(safety-evals-round2.log)，类型safety-evals-typecheck-final.log、全仓safety-evals-lint-round1.log、最终局部safety-evals-eslint-final.log通过。fixture回答/评分/日志引用只证明工程状态分支，不是模型质量。完整19类考题和实际执行器仍未完成；后续优先真人/儿童及各组数量/运行前置条件，不以新32题替代完整要求。
- 最新安卓内容（最后业务变更7365975，随后Android源未改）在容器新目录/work/android-final真实重建并运行全部testDebugUnitTest，句柄55475已exit0：android-linux-final-round6.log BUILD SUCCESSFUL 5m52s，250任务实际执行。 fresh XML31套件**123项、零失败/错误/跳过**，保存于C:\wb-dev\closeout-logs\android-linux-final-round6-results，tar.gz同名；原121项旧结果不冒充本轮123项。Linux日志有image decoder unimplemented警告，但XML全部零失败；这些是隔离环境单元/Robolectric/受控HTTP测试，不代表手机设备、真实厂商推送或图片主观品质验收。旧Windows APK/ktlint/detekt对应同一未改Android源码，仍需真实设备。
- 升级前重新执行现有age加密备份成功，local-pre-upgrade-backup-round3.log，目录C:\wb-local\backups\20261012-014557-7041c1a89b2643fea220999cc32a2faf；仅加密数据库/媒体/清单，原KEK和age身份保持分开，应用finally自动恢复，后续双端database+crypto健康实查通过。离线/异机保管尚未完成，不因本轮备份记完成。
- 正式本机已从旧736镜像升级到源码ba4b76b，local-upgrade-round8.log原句柄33930终态exit0。app镜像**sha256:4e1c868ca7155edc11c90cbb5114def50cd575c863c8789cf0116e11e4e384e7**，edge仍sha256:8d254f5d9dc5b488d8928049884a01ddbbf5c51ddfc5984e410f008b88e7b3ef（前端内容无新增业务变化）。实际容器dist/main.js检查presetRow及锁内persona版本分配均存在；最初误按未打包modules路径读文件失败，不算部署故障。app/postgres/caddy健康、迁移exit0；仅127.0.0.1:8080-8081，原账号/卷/密钥保留，无测试seed写入生产。
- local-upgrade-smoke-round8.log双端健康/实际登录/刷新会话/安全上下文通过，0页面异常。local-model-config-ready-round4.log实际请求GET上游列表，**upstreamCount=0**，配置页/字段/密码框/刷新通过、0异常；真实供应商确未配置。旧ready脚本仅硬编码not_configured不作为该事实证明，round3误捕/upstreams HTML后加/api/过滤，round4才是实际列表证据。用户选择在后台自行录入，接入步骤在local-deploy，未要求聊天发密钥。后台是否可达不等于AI可用。
- C:\wb-local\deployment-version.txt原内容混合旧行式和追加JSON，已另存deployment-history\pre-20261012-0151-version.txt，并改为唯一当前JSON：sourceCommit/image IDs/verifiedAt和真实配置状态。共享目录实查main，未修改；开发分支codex/product-closeout。当前运行/检查句柄均已终态，不再poll或复启。
- 后续：继续完整19类考题及运行证据/执行路径，模型由用户后台配置后实际连接/聊天/费用与固定独立评审，契约映射剩余条目逐项审计；真实设备、厂商推送、离线/异机保管、独立审查分别登记。当前目标活动，全部开发自测，未完工或暂停；无重复阻塞，仍有不依赖外部资源的开发工作。

## 当前断点（2026-10-12 01:32，优先于下文）

- 总经理无配置文件，允许后台自行接入或提供URL/API Key；已选择后台自行接入，不要求在聊天发送密钥。正式本机上游/模型/价格页实际登录、字段、密码框空值及刷新会话检查通过，零页面异常（local-model-config-ready-round1.log），未创建假供应商或写入真实密钥。open_in_codex请求打开localhost:8081/upstreams返回queued，不冒称已显示。docs/ops/local-deploy.md新增接入步骤：上游测试保存→同一模型键发布价格→目录选择实际模型ID/默认聊天后台/启用→实际聊天及用量验证。真实供应商仍未配置。
- 源码检查点14f0ee9c6fc2e232c020073f63aa500ded311220，管理员/回滚业务仍5c8fd5a；14f仅测试修正。记忆复跑admin-private-memory-round2.log11项10通过1超时，不是通过。单独诊断memory-long-diagnostic-round1.log将命令上限120秒，1项通过10项筛选跳过，总61.30s，全部原批次/游标断言保留；未观察数据库锁等待。该批量集成测试65条真实加密消息及事件派发，现仅此项显式120秒，不调整运行时回复期限，完整套件仍待最新全量结论。
- 完整网页round8/round9都25通过1失败：先是先前清空共用账号导致日期定位null；自行创建可见消息后定位成功，但旧测试错误要求已消费的seq参数留在URL。修正为验证真实flash-row高亮和消费后的会话地址，web-final-round10.log完整26项通过（1.9m）。后台admin-final-round8.log完整8项通过（41.2s），含真实密钥掩码/输入清空/缓存不含密钥、价目发布与模型启用，但上游为受控本机测试服务，不等于真实供应商可用。
- 全仓final-typecheck-round8.log终态exit0；5个本次文件格式final-touched-format-round8.log通过，管理员业务lint/依赖前已通过。最新全量pnpm test日志full-tests-round8.log，现有句柄44600仍运行，切换到新Vitest工作进程，当前无失败输出也无汇总；不要重新启动、不要重置同库或当作通过。本次收集包含当时未提交、现已纳入14f的记忆超时修正，运行时保持5c8固定；后续仅网页E2E测试和文档变化，不改变该全量业务源码。完整结束后再执行生成一致性/适用lint与本机镜像升级。
- 安卓最新HEAD源码已用git archive导入原容器weiban-closeout-android-linux-retry的新目录/work/android-final，SDK配置复用，尚未执行Gradle。归档在C:\wb-dev\closeout-logs\android-final-source.tar，容器/tmp/android-final-source.tar；原/work/android留缓存，不把旧121项结果当作新源码通过。等待后端全量结束后执行新目录测试，避免重负载影响真实时间断言。
- AI审计确认当前包仅84题/7个suite且EvalCase只含5种category，README明确不覆盖完整19类。后续须补完整考题、运行条件及评测证据，不把剩余工作全归于用户尚未配置供应商。当前业务既定范围核查、客户端回归、本机升级、完整考题和实际模型、设备、离线/异机保管与独立审查仍待完成；目标保持活动，未暂停或完工。

## 当前断点（2026-10-12 01:24，优先于下文）

- 总经理再次确认先在本机部署、不用服务器。localhost:8080/8081仍为正式本机入口，镜像7365975，原配置、密钥、账号及数据保留；最新修复待升级。共享目录main只读，开发副本C:\wb-dev\codex-closeout、codex/product-closeout。
- 管理员ID操作原先未限制preset，真实私有角色复现5项失败（admin-private-character-round1.log）：编辑/发布500、下架和版本读取200、回滚422。按契约预设角色维护范围，update/publish/listPersonaVersions/rollback先presetRow，unpublish在SQL限定kind；修复后5条路径404，私有密文/状态/DEK不变。
- 正常预设生命周期另行复现回滚500：历史published密文直接写为draft，AAD不匹配；新版本在锁外分配，名字/介绍等未恢复。源码5c8fd5a237982e0760b1941db39f7924401fd6a8在FOR UPDATE锁内分配revision/personaVersion，分别seal新发布与草稿，恢复旧内容、搜索与分类字段，保留儿童识别/私人事实，校验历史稳定标志与当前结构/儿童头像规则，补发布/分类事件。真实HTTP回滚后实际运行时读取旧角色卡，两路并发回滚历史连续[5,4,3,2,1]；无契约或迁移新增。
- admin-private-character-round6.log：3文件19项通过，27.39s（管理员6、分类8、注销5）；类型admin-private-typecheck-round2.log及全仓lint/依赖admin-private-lint-round2.log通过，340模块1474依赖。角色评估端口受控成功，不代表真实模型质量。round5失败是测试把catchphrases放到social而非契约speech，修正测试后通过，不算产品缺陷。
- admin-private-character-round4.log：3文件25项，24通过1失败；memory-persona长消息批量抽取30秒超时。原因未判定，单独复跑admin-private-memory-round2.log句柄46793仍运行。最新完整网页web-final-round8.log句柄30580运行中，独立weiban_closeout_probe_test库。观察现有句柄终态后登记，不重启已运行任务。
- 最新全量、后台浏览器、Linux安卓、本机升级、19类真实模型、设备、离线/异机密钥保管及独立审查待完成。全部开发自测，目标活动，未完工。

## 当前断点（2026-10-12 01:00，优先于下文）

- 前轮媒体修复后完整`pnpm test`已真实结束：`full-tests-round7.log`74文件603项通过，耗时745.54s，句柄91892终态exit0，不再poll或当作仍运行。本次收集开始时源码为e38b89d（业务同fe59bce），不包含随后准备的角色注销复现测试；不能用于证明新修复8bea162的最新全量通过。
- 四项新复现实际失败（`custom-deletion-race-round1.log`）：create/update在真实DELETE /me后仍写入，广场createFromSnapshot仍返回成功，试聊虽拒绝却保留新DEK。每例先真实账号/登录/角色权限或实际发布快照，真实注销销毁DEK后释放请求，不替换注销/加密/数据库。该风险已从代码形态升级为可复现问题。
- 修复源码检查点`8bea162ec796bafe18a4e0e5071400ad36276175`。CustomCharacterService普通创建/试聊创建/编辑和CharacterPlazaService复制/writeRow先在写入事务FOR SHARE检查active，seal用同一事务，拒绝后不复活密钥或新版本。试聊保持先ai-runtime用户咨询锁、再状态行锁的原锁序，来源版本/复用校验仍在seal之前，未改契约。广场状态端口经identity公开出口注入，模块原有Identity依赖不变。
- 新增第5项验证真实广场正常复制、正常版本更新可用，并在读取旧草稿明文之后真实注销，迟到新版本更新被拒绝，DEK0且旧版本未改变。最新5文件39项通过（`custom-deletion-race-round3.log`58.12s）：本次5项、原自定义角色/试聊、音色和分类策略；此前round2因不存在plaza.test.ts只匹配3文件26项，不把它记为广场完整套件通过。服务端类型`custom-deletion-typecheck-round1.log`及全仓lint/依赖`custom-deletion-lint-round2.log`340模块1474依赖通过；R10测试出口与5项测试已提交。全部为开发自测。
- 后续仍需复核CharacterService管理员更新/发布/回滚中ownerId非空的事务外seal路径，当前仅代码线索，不能记已复现；平台owner的预设角色不按用户注销问题计算。完成剩余私人密文写入复核后再做最新全量，避免反复在变动源码跑完整测试。本机镜像仍7365975，媒体/角色两轮注销修复尚待一起升级。最新网页/后台/Linux安卓、19类真实模型、设备、离线/异机保管和独立验收待执行。共享目录保持main，目标活动未完成。

## 当前断点（2026-10-12 00:53，优先于下文）

- 上轮媒体注销修复和21项检查是实质进展；本轮继续观察原全量执行句柄`91892`，没有重启。最后观察仍运行，Vitest工作进程已多次自然切换，日志`full-tests-round7.log`尚未产生最终汇总，不能登记全量通过。业务源码保持上一检查点；新增复现草稿不会被本次已收集的全量作为通过证据。
- 扩展权限已用真实隔离库/NOLOGIN非管理员角色验证：DB所有者可安装trusted pg_trgm；同一角色安装非trusted vector被拒绝（要求superuser）；管理员预装后普通所有者可CREATE EXTENSION IF NOT EXISTS、建vector(256)表与HNSW索引；无数据库CREATE权限的角色安装pg_trgm被拒绝。4份日志为`extension-pg-trgm-owner-round1.log`、`extension-vector-owner-round1.log`、`extension-preinstalled-vector-round1.log`、`extension-pg-trgm-no-create-round1.log`。探测数据库`weiban_extension_probe`/`weiban_extension_readonly`和角色`weiban_extension_probe`/`weiban_extension_reader`已核对后删除，未碰完整回归库或生产库。条件已写入production-deploy，未来外部DB权限配置及全套受限账号迁移不因此视作完成。
- 阅读其他seal路径发现自定义角色create/update及广场复制/writeRow仍在事务外生成用户密文，这是待复现风险，不冒称已验证的产品问题。准备了未提交的`custom-deletion-race.test.ts`4项：普通创建、试聊创建、编辑在真实头像权限读完后延迟至真实DELETE /me销毁DEK，再继续执行；已取得实际角色发布快照的广场添加在注销后执行。真实媒体权限与注销均不替换，只在头像读取返回处设置时序闸门；lint草稿通过`custom-deletion-race-lint-round1.log`，运行尚待全量释放数据库。另有characters/testing.ts新增CustomCharacterService测试出口未提交。继续接管先poll 91892，终态后运行草稿、根据实际失败修复，避免在同库并发reset或影响在跑的源码版本。
- 其余断点不变：全量结论后仍需最新网页/后台/Linux安卓、本机镜像升级、完整真实模型、设备、离线/异机保管及另一位独立审查者。目标活动，未完工或暂停。

## 当前断点（2026-10-12 00:41，优先于下文）

- 上轮加密备份/恢复为实质进展，本轮推进T-103收藏快照真实PG证据并修复注销并发。独立分支源码检查点`fe59bce957f91235885fd21577fdfa103f63f0e5`，媒体修复提交`50e530c393bb216dca97b418ab804ffce8cf5692`；共享目录实查仍main，未修改。正式本机镜像仍为7365975音色版本，本轮修复待完整回归后升级。
- 新增`library/testing.ts`与7项真实数据库/磁盘/HTTP测试：正文加密故障回滚并删除已复制头像；8路同来源收藏仅一个收藏/头像副本；取消收藏不删原头像；复制不可用保留文字快照；注销后迟到收藏不复活DEK；写盘中的用户状态锁阻塞真实注销请求，提交后真实注销销毁密钥并清理媒体；文件实际写入后故障回滚新DEK并删除磁盘对象；原头像物理删除与角色资料不可读后仍可列出快照并实际签名读取。前两项在同一测试中包含多个断言；角色资料/动态来源为受控端口，不声称实际角色删除器或源动态权限已在这些用例验证。
- 第4轮复现产品问题：真实DELETE /me已销毁DEK，迟到头像复制重新建出一条DEK；收藏事务虽被实时同步拒绝并删除副本，事务外生成的DEK仍残留。通过MEDIA_ACCOUNT_STATUS装配绑定真实IdentityAccountStatusPort，私有媒体store事务内先FOR SHARE检查active，seal及ready更新共享事务；pending元数据仍先提交，保留进程中断的上传回收能力。底层media没有直接import上层identity，必需状态端口由app装配，未修改契约或架构依赖白名单。错误写盘会回滚新DEK，清理原pending及实际文件；用户锁覆盖写盘，注销不能在中间销毁再重建密钥。
- 最新4文件21项通过`library-media-round8.log`（35.66s）：收藏7项、原媒体6项、音色4项、导入4项。服务端类型最终`library-media-typecheck-round3.log`通过；全仓lint/依赖`library-media-lint-round2.log`340模块1472依赖通过，最终新增测试lint`library-snapshot-lint-final.log`通过。全部为开发自测，未独立验收。首轮误读Favorite字段为id导致测试失败并连带留下测试副本；改为契约favoriteId后通过。首轮注销测试漏confirm=DELETE且未完整等待失败分支，修正后第4轮才得到真实DEK残留证据，不把测试错误记为产品问题。
- 已启动最新全量`pnpm test`，日志`C:\wb-dev\closeout-logs\full-tests-round7.log`；必须继续观察现有执行句柄，未完成前不登记全量通过，不重复启动同库测试。完整回归之后再升级本机生产镜像。尚需其他事务外seal写入路径的注销复核、扩展权限、最新网页/后台/Linux安卓、19类真实模型、设备、异机/离线密钥保管与另一位审查者独立验收，目标未完成。

## 当前断点（2026-10-12 00:26，优先于下文）

- 上轮为实质进展，本轮继续本机备份/恢复交付。核对安全规范发现cd1cfd0初版把KEK和数据库备份同目录，不符合`security-and-privacy.md`；已向总经理明确说明遗漏并纠正，初版不作为合规备份交付。两份旧备份的秘密与登录资料移至`C:\wb-key-custody\legacy-20261012`，原清单失效标记，原运行配置未改。Windows ACL首次命令导致身份文件无允许项，修正为明确SID授权后解密成功；仅本人/SYSTEM可读，未输出任何秘密。
- `Backup-Weiban.ps1`现强制提供age公钥文件，加密数据库dump与媒体tar，成功目录仅2份age密文和格式2清单，KEK/口令/登录资料不复制。源应用镜像取实际运行镜像ID；可通过ProjectName备份隔离恢复项目。finally清理临时明文与容器dump，即使清理抛错也执行恢复启动。实际生产空媒体备份`local-encrypted-backup-round1.log`通过；目录`C:\wb-local\backups\20261012-001144-0ea9817b1c354ba78c3fe0e69f884962`。age官方1.3.2Windows包SHA256校验通过（官方值见本机部署文档）。仅公钥放运行目录，演练age身份暂在ACL保护的C:\wb-offline-keys；尚未离线或异机保管，不把目录名当作离线证明。
- 非空数据只在隔离恢复项目写入：以原账号真实HTTP上传64×64PNG，得到加密媒体与用户/平台两条DEK；同一脚本加密备份（`local-nonempty-backup-round1.log`），全新项目恢复后原账号/原KEK实际签名下载并解密88字节图片，SHA256与备份前内容一致（`local-nonempty-restore-media-round1.log`）。正式本机数据库没有注入测试图片/DEK，仍保留其原状态。
- 新增`Restore-Weiban.ps1`，只接受格式2清单且检查两份密文哈希，目标必须全新weiban-restore-*项目；另行提供原运行配置/KEK和age身份。解密、单事务恢复库、恢复媒体后启动app，未启动Caddy或开放端口，不替换正在使用的服务。实际执行全流程通过（`local-restore-script-round1.log`），经该脚本恢复后的实际登录/媒体解密及哈希一致再次通过（`local-restore-script-media-round1.log`）。损坏密文和已有卷拒绝，损坏路径未创建卷（`local-restore-refusal-round1.log`）。受控错误公钥使备份加密失败，未留下明文或成功清单，恢复启动命令成功（`local-backup-failure-round1.log`）。原生产双端健康/登录/刷新最终通过（`local-encrypted-backup-login-final.log`）。
- 3个隔离探测项目容器/网络/6个数据卷已按精确项目标签核对后移除，临时解密dump/tar已删除；保留加密演练包与非秘密媒体哈希、脚本证据。组合清理命令曾被执行策略拒绝，拆为不删除卷的compose down、核对标签、明确卷名删除及LiteralPath明文删除后成功，没有绕过权限或触及生产卷。
- 下一步：收藏快照失败/重复清理真实PG测试；扩展权限限制验证；最新全量服务端/网页/后台/Linux安卓；19类真实模型、设备和独立审查。异机/离线密钥保管、真实供应商和设备仍是外部验收项，不能写完工。全部为开发自测。

## 当前断点（2026-10-12 00:08，优先于下文）

- 用户确认先在本机部署，不需要外部服务器；现有localhost:8080/8081继续运行。独立副本`C:\wb-dev\codex-closeout`、分支`codex/product-closeout`不变，共享main未修改。目标继续进行，未完成或暂停。
- A12补充真实PG验证：加密故障导致计划与待寄信一起回滚；8路相同来源登记仅一条计划/加密存档；注销更新状态时登记等待账号行锁，解锁后拒绝且无孤立计划。连同原恢复/自述/注销测试5项通过（`letter-atomic-runtime-round2.log`），服务端类型通过（`letter-server-typecheck-round1.log`）。第一轮误以为请求等待advisory锁，观测断言失败；实际`getAccountStatus(tx)`使用FOR SHARE行锁，修正观测后通过，未为假设风险修改业务代码。完整寄送扣费/可用时间场景仍需与最终回归核对。
- 本机启动脚本在写入配置前检查现存部署卷：原密钥/连接文件缺失则拒绝，即使配置也同时消失。真实已有卷+不存在的探测配置目录验证拒绝且未写入替代文件，原配置PrepareOnly通过。
- 新增`deploy/local/Backup-Weiban.ps1`：短暂停止应用冻结写入，备份pg_dump自定义格式、只读加密媒体卷、原秘密/配置、登录信息与部署版本，生成SHA256清单，finally自动恢复应用并清理容器临时dump；拒绝在源码工作区放置含密钥备份。两次实际备份通过（`local-backup-round1.log`、最终清理版`local-backup-round2.log`）。首次8项清单校验、独立无网络无宿主端口PG恢复成功，源/恢复各1个用户，vector/pg_trgm扩展恢复；探测容器已移除。原应用双端登录/刷新/健康通过`local-backup-login-round1.log`。秘密没有打印到日志。恢复库应用解密、非空媒体与异机演练未验证，不能将原应用登录替代恢复验收。
- 下一步保持：收藏快照失败/重复清理真实PG证据；恢复库原KEK解密与非空媒体；扩展权限限制；最新全量服务端/网页/后台/Linux安卓；19类真实供应商评测、真机与另一位审查者独立验收。上述全部是开发自测。

## 当前断点（2026-10-11 23:54，优先于下文）

- 默认音色源码检查点 **7365975f5fa90e296eaac8d022eb3f63bcc1aeaa**，独立分支/副本不变，共享main仍未修改。本轮有实际代码、测试及本机升级进展，目标继续活动，未登记产品完工。
- 自定义创建、编辑、保存前试聊与导入草稿增加可选可空voiceId；两端音色库选择/免费样音试听、加载失败重试及停用旧选择显示，保存/重读/清空保留语义。选择保存到加密角色payload和运行时卡；新选只允许启用库音色，原有已停用选择可随其他编辑保留，已有角色的试聊快照也可继承旧选择。陪伴设置→自定义默认→预设默认，每次合成重查enabled，均无可用音色就不合成。没有新增迁移或默认供应商/克隆声音。
- 发现旧预设复制品social.voiceId为voice_young_m_02等示例代号，不能当作库UUID返回；旧卡兼容为未选择，真实库ID可继承，明确null不重新继承。导入保存在任务锁内校验库ID，新选停用/不存在音色拒绝，旧选择可保留或清空。试聊快照保留音色，不将现有文字试聊测试说成已实测语音试聊。
- 最终后端5文件19项通过（custom-voice-runtime-round4.log）：角色/试聊快照及归属、真实库启停/优先级/清空、默认音色传入受控合成端口、通话已授权快照音色传入受控语音流、导入草稿保存/并发合并与停用旧选择、旧卡兼容。数据库/HTTP/角色/素材为真实实现；供应商合成及通话流为受控端口，不代表声音质量、真实费用或设备麦克风通过。
- 网页3项完整流程通过（custom-voice-web-e2e-round3.log），涵盖保存前试聊、正式创建/编辑/重读/清空、导入保存/刷新/创建保留音色。通过真实加密媒体上传一段可播放WAV测试音，浏览器实际播放、切换默认后paused=true；测试记录真实Audio实例，没有替换播放实现。这是试听链路测试，不是语音模型音质评测。网页生产构建通过（custom-voice-web-build-round1.log）。
- 安卓ktlint/detekt、Compose/Room/HTTP2项和APK构建通过（custom-voice-android-check-round1.log，7分6秒；custom-voice-android-tests-round1.xml零失败/跳过）。手动编辑选音色→试聊请求保留，重新打开导入草稿→保存保留原音色均验证。APK20708624字节、23:49生成。初次格式检查因测试JSON超140列失败，拆行后通过，没有放宽ktlint；长构建经真实进程/线程与输出确认仍在编译，未因等待重启。
- 全仓类型custom-voice-typecheck-round2.log、最终服务端类型custom-voice-server-typecheck-final.log、全仓lint/依赖custom-voice-lint-round2.log（339模块1470依赖）、生成一致性custom-voice-generated-check-round1.log通过。全部为开发自测，独立验收仍由另一位审查者执行。最新完整服务端和Linux安卓回归待全部收口后执行。
- 本机生产镜像已升级到上述源码，连同f06392d导入字段一起送达。构建/健康通过（local-custom-voice-upgrade-round1.log），npm一次ECONNRESET由正常重试恢复；双端实际登录/刷新、数据库/加密健康、安全上下文、零控制台错误通过（local-custom-voice-login-round1.log）。新编辑器代码实际存在于本机送达资源（local-custom-voice-installed-ui-round1.log）；用户账号仍在真实初始昵称引导，未绕过引导冒称已在生产数据完成创建。生产没有注入测试角色、音色或样音；正向编辑/试听走独立probe数据库。原密钥、账号及持久卷保留，部署版本和镜像ID追加C:\wb-local\deployment-version.txt。
- 下一步：A12原子寄信/恢复、收藏快照失败/重复清理的真实PG证据；本机备份恢复及缺密钥启动保护；数据库扩展权限；最终全量、完整真实模型评测、设备和独立审查。T-103继续进行。

## 当前断点（2026-10-11 19:12，优先于下文）

- 开发源码检查点 **f06392d00be7614f211b024a5d62163499876c73**，独立副本/分支不变，共享main未修改。Claude会话文件仍为09:04:46、2213073字节，未发现新进度，未向其他会话发送消息。活动目标未完成，继续推进T-103。
- 导入编辑草稿契约3.1新增可选可空birthday/avatarMediaId，无迁移；省略兼容旧草稿，null保留主动清空。服务器保存前调用真实媒体权限端口，拒绝他人私有头像及非头像用途，最终创建仍执行原有分类/头像校验。网页导入加载、保存、重读及创建保留生日/头像/真人类型/年龄/儿童外貌，补真人类型选择；上传中禁止保存草稿，草稿保存回调校验会话归属。安卓同样补生日、头像裁剪上传、真人类型/年龄/儿童外貌，不再把儿童外貌固定为false。
- 真实PG/HTTP与合并：2文件7项通过（import-fields-runtime-round3.log）。包含两批不同线索并发追加、编辑字段不被覆盖、主动清空保持null、他人媒体/错误用途/日期拒绝，以及他人目标、不同kind、未完成/已删除合并目标拒绝。分析器为受控测试替身，媒体、加密存储、接口、数据库均为真实实现，不代表模型质量通过。
- 网页真实接口完整流程1项通过（import-fields-web-e2e-round2.log）：上传头像、生日及历史人物/未成年/儿童外貌→保存→刷新像素加载→清空生日头像→再保存/刷新→创建角色仍保留分类。生产构建通过（import-fields-web-build-round2.log）。首轮测试未打开头像来源弹窗就找恢复按钮超时，修正测试操作后通过，未修改产品交互以迎合测试。
- 安卓ktlint/detekt/assembleDebug及Compose/Room/HTTP2项通过（import-fields-android-check-round2.log），包含原试聊及重新打开导入草稿→清空生日→实际保存请求保留头像与分类。JUnit零失败零跳过，保留import-fields-android-tests-round2.xml。APK20695440字节，19:11生成。首轮缺PhotoCropper导入编译失败，补正确依赖引用后通过；真机及最新Linux完整安卓回归仍待执行。
- 最新全仓类型（import-fields-typecheck-round2.log）、lint/依赖（import-fields-lint-round2.log，339模块1467依赖）、契约/安卓生成一致性（import-fields-generation-check-round1.log）通过。后端首轮上传测试误写200而实际201，修正测试预期，未改上传返回码；第二轮6项通过，第三轮新增归属/并发实际线索断言后7项通过。全部仅为开发自测，独立验收需另一位审查者。
- 本机服务仍健康运行于源码e4f2180282aa95933df6d9aa2dc550d1349fa440（用户http://localhost:8080、后台http://localhost:8081），本轮导入字段代码尚未部署；准备与后续音色功能一并构建升级。生产密钥、凭据、卷未改动。剩余音色选择/运行时默认音色、A12/收藏失败清理、备份恢复及密钥缺失保护、最终全量、完整真实模型评测、设备和独立审查继续按T-103推进。

## 最新可恢复状态（优先于下文历史断点）

- 全量第五轮开发自测通过：64 个测试文件、537 项测试，726.09 秒。日志 `C:\wb-dev\closeout-logs\full-tests-round5.log`。此前两个受并发构建影响的失败套件在无构建并发时单独复跑也全部通过（20 项，backend-isolated-round5.log）。未改放宽原断言。
- 网页既有 22 项端到端通过；新增真实服务器搜索场景通过（web-search-e2e-round3.log），后台 7 项通过（admin-e2e-round1.log）。网页、后台生产构建及类型/lint 已通过；新改动完成后还需最后核对。
- 安卓第四轮 lint/detekt/编译/APK 构建通过，117 项单元测试中 113 通过、4 失败。其中空输入误期待发送按钮的旧用例已修；另三项为 AndroidX FileProvider 在 Windows 的路径分隔符兼容问题，正在独立 Linux 容器复跑，未跳过或伪报通过。
- 新发现普通手动创建/完整编辑自定义角色无安卓入口，已补编辑页面和入口，保存全部口头禅、风格、生日、标签、头像；使用 custom_character_avatar 上传用途。新增字段保留/清空/分类锁定测试，尚待编译和运行。契约 startTrial 要求已存在角色，当前提供保存后试聊；PRD 保存前试聊及弹层关闭即删除记录仍需核对服务端生命周期，不据此计完全满足 CHR-07。
- 正在执行 Android 格式/静态检查/编译及新增测试（android-round5.log）；Linux 容器 weiban-closeout-android-linux 内使用单独源码副本，不触碰共享目录。
- 对照派发队列确认：私聊小巧思引擎仍未实现，不能因 3.1 配套或旧 39 张卡均已写完就宣布产品完工。还需核对日常照片类别、55 分钟提示、评测题登记、部署/备份/真实供应商与设备验证。国内厂商通道和品牌铃声另列环境/素材依赖，不替换为通过。

所有检查均是 Codex 开发自测，独立验收仍须另一位审查者执行。当前目标继续进行，不是完工声明。

### 安卓与最后静态检查续记

- 新本地检查点：83b09b356b8d5abf25529a5d5a8ec8696bb0746c。未推送、未合并。
- Linux 第三轮整个聊天模块 22 项通过，零跳过，76 秒；包含拍照取消/裁剪上传/换账号丢弃晚到结果、导航与草稿恢复、角色编辑器。日志 android-linux-round3.log、逐套件 XML 在 android-linux-round3-results。第二轮六项失败是缺少仓库 JSON 测试数据，补入后同断言通过；生产 FileProvider 未因 Windows 环境修改。
- Linux 全 Android 单元测试继续执行中：容器 weiban-closeout-android-linux-retry，日志 /work/logs/android-linux-all-round4.log，完成标志 android-linux-all-round4.exit。
- 已开始小巧思规则层，尚未接进回复链/持久配额；不得计功能完成。必须让新的求助/关怀消息取消待发送的冷落延迟，否则队列会被最长3分钟延迟阻塞。另确认原试聊只创建会话：ReplyContext.build 要求正式 active contact，试聊消息实际无法获得回复，T-103需修复真实生命周期及回复入口，不只改按钮。

- Android 第八轮通过 ktlintCheck、detekt、assembleDebug；导航/草稿恢复 2 项与编辑器字段/分类/限制 4 项全部通过（android-round8.log）。修复实际的聊天草稿在聊天信息页返回后丢失问题；未删断言。
- 手动创建之外增加「我的角色」列表，保存但未加通讯录的角色可以再次打开。编辑操作按 owner/session 隔离；来源复制品分类只可更严。
- 最新 APK `C:\wb-dev\codex-closeout\apps\android\app\build\outputs\apk\debug\app-debug.apk`，20,659,139 字节，2026-10-11 13:03:54。不是设备运行验收证据。
- 最新完整类型检查通过（typecheck-final-round7.log）；全仓 lint 通过（lint-final-round6.log）。后台保留当前已停用音色的显示，避免下拉框误显示为平台默认。
- Linux 已准备 JDK21、Android36 SDK、独立源码副本。首轮尚未运行单元测试，失败在 KSP Maven 依赖下载 TLS 握手（android-linux-round1.log），不算拍照场景失败/通过。缓存容器 weiban-closeout-android-linux 停止；正在保存环境镜像以便重试下载，不重复安装 SDK。
- ktlintFormat 与检查须分成两次 Gradle 调用，避免同次调用对格式化前输入的检查；第七轮格式检查失败已经第八轮分开执行后通过。

## 位置与授权

总经理 2026-10-11 要求 Codex 接续 Claude，持续推进至产品完工。
活动分支 `codex/product-closeout`，副本 `C:\wb-dev\codex-closeout`。
起点 `2ebc29ff7a19bee8a020f0cfade849a15708aada`，任务见 `docs/tasks/T-102-product-closeout.md`。
共享目录 main 和 Claude 工作副本均不切分支、不覆盖。

## 已接住的成果

Claude 在周额度耗尽前，已提交后端 B1～B10；B11～B21 的未提交源码和迁移从 `C:\wb-dev\wb-b31` 逐文件复制到本分支，原副本保留。
共享目录中缺少于集成副本的任务、设计和交接文档已补入本副本，已有文件未覆盖。
依赖按锁文件安装完成。后端已补 0074 journal 登记、分批合并最终归属/状态检查、保存草稿锁行校验、收藏快照失败清理和重复来源去重；模型不能确认可用时不伪报可识图。

## 第一轮收口实现与证据

- AI：A1 全局来电开关、A2 冲突结果 hash 写入、A3 契约类型、A4/A5 真实人设摘要与卡片文案绑定（卡片文案 P-33 闸及后台费用）、A6 所选模型真实估价、A7 预检冲突与过滤信息、A8 用户当地日期实付费用比例闸、A9 本机熔断状态、A10 起名带物种、A11 图像字节数配套已实现，尚需完整集成回归，不据此标记整体完成。
- 真实装配发现并拆除两条底层媒体注入循环；组合根使用 ModuleRef 延迟查找真实端口，不返回假空值。
- 新库安装发现 0056 引用尚未创建的 plaza 表；SQL 保持不改，通过显式迁移依赖先执行 0060。决策见 ADR-0029。
- 50 条契约/AI 接入/导入合并测试通过；另一次真实应用装配、全部迁移执行/回滚/重执行与安全透支统一入口检查 12 条通过。统计是两组不同范围的开发自测，不是独立验收。
- 完整类型及全仓 lint 曾通过（日志 `C:\wb-dev\closeout-logs\typecheck-round3.log`、`lint-round2.log`）；后续 AI 改动需再次确认。
- 全量第一轮失败：旧迁移安装错误导致 29 个套件初始化失败，最终 32 文件失败、28 通过；246 条通过、4 条失败、271 跳过。不能计完整通过。
- 全量第二轮正在运行，日志 `C:\wb-dev\closeout-logs\full-tests-round2.log`。已复现遗留失败：identity 测试重复登记真实 growth 删除清单；media 测试仍查旧 `avatar.uploaded` 审计动作（实现为 `asset.uploaded`）；billing 注销测试及 proactive/simulation 的固定迁移位置断言尚待核对。未完成前不得写全量通过。
- 曾取消一次装配循环诊断运行；临时诊断日志在 `assembly-debug.log`，不是通过证据。

## 仍需推进

1. 完成全量第二轮失败分类和修复，增加关键后端配套集成用例，确认第二批后端逐项证据。
2. AI A12（0075 自述档案、0076 纪念日信件待寄队列及注销清单）、A7/A8 边界与并发验证；网页 W1～W11、安卓配套尚未开发。
3. 对照原需求、派发遗留和质量问题完成集成验证与必要修复。
4. 登记构建、测试、部署及真实设备/供应商限制，提供整体交接。

本记录是活动断点，不是开发完成或验收通过声明。Codex 自己开发的验证只能登记开发自测。

## 更新：后端回归与客户端收口

- 全量第二轮已结束：53 文件通过、10 失败，521 条通过、11 失败；旧测试重复登记删除模块、审计名称和迁移位置已校正，实时通信接受当前 3.1 协议。
- 独立范围复跑：身份/账单/媒体/主动消息/模拟 89 条通过；回复/记忆/模型/实时通信/服务器流程 60 条通过。两个较长场景保持原断言，分别设 120 秒预算后完整通过。
- A12 已实现加密自述档案、待寄纪念日队列、账户删除清理及原子寄送配套；真实数据库/装配/迁移 10 条通过，后续恢复事件改动仍待复跑。
- 网页 W1～W6、W8、W10、W11 已有实现；搜索改为服务器日期定位/分类分页，并支持群发送者筛选。W7、W9 尚在收口。安卓尚未配套。
- client-core 错误详情等 13 条通过；最新全仓类型检查与 lint 通过，日志 typecheck-client-round2.log / lint-client-round2.log。
- 全量第三轮正在运行，日志 full-tests-round3.log，未结束不能登记全量通过。上述均为开发自测。

此更新替代上文第二轮运行中、A12 未开发及网页未开发的旧断点；其余完成要求仍待执行。

## 客户端配套与运行中检查（续）

- 网页 W7/W9 和后台配套已补：分批合并跳转、保存草稿、冲突/过滤信息、识图入口限制、来源角色 ID 匹配、已发布版本、作品未读/下架原因、举报作品直查、分页停权列表、本机熔断时间。需浏览器走查。
- 契约新增可选 ImportResult(new_character).editorFields，保存表单值，合并保留刻意清空；生成命令 android:generate 通过。相关 46 条契约/合并测试通过。
- 安卓已接 W1/W3/W4/W5/W7/W8/W9/W10/W11 的主要源码；仍需检查搜索异步切换、作品版本提示、创建/编辑字段覆盖和通知实际入口。新改动尚未完成构建验证。
- 第三轮全量：63 文件通过、1 失败，536 条通过、1 失败。失败为运行中新增 editorFields 用例使用进程已加载旧契约（字段被剥除）；新进程单跑通过。第四轮固定后端/契约源码执行，日志 full-tests-round4.log，不可提前登记通过。
- 类型及 lint 第三轮通过；网页/后台生产构建进行中。Android 首轮 ktlint 因检查期间新增搜索源码未格式化失败，其余编译/既有单元测试仍在执行，必须完成后格式化再复跑。
- 仍需：A12 模型恢复/每日问答状态和并发寄送验证，费用闸/导入估价边界，网页/后台 E2E、安卓编译/单元测试/设备走查、遗留队列核对、部署与独立验收。所有统计只属开发自测。

## 验证更新与下一步

- 本地开发检查点 b16dc3f4f5184a22a67dda87f9d03959d1cd4b4d 已提交，尚未推送或合并。后续端侧修正仍有未提交文件。
- 网页/后台生产构建通过；网页已有 22 个浏览器场景全通过（web-e2e-round2.log）。新增搜索用例补完整新手流程并按 contentType 查真实请求，单独复跑中；后台 E2E 排在其后串行使用 probe 测试库。
- 安卓地址夹具失败最终确认是 Windows/Docker 将本机服务器命名为 kubernetes.docker.internal，生产白名单维持原范围，15 个测试夹具显式使用 127.0.0.1。早先 IPv6 解释已撤回。
- Android 第一/二轮不是通过证据：未整理搜索格式、收藏字段拼写及重叠构建的文件占用均已修正；network 新测试长行拆分；第四轮编译通过，APK 17150055 字节，单元测试仍有 ChatScreenTest/ContactAvatarEditorTest 失败待查。搜索查询参数已修正为契约 contentType，需最终复跑。
- 服务端第四轮已有 201 批次恢复超时及独立 worker 推送失败。该轮并行运行多个端侧构建，先保留失败，待资源安静后独立复核；不得直接提高超时或登记为通过。
- 只读核对：每日一问恢复查询实际已包含 pending 与 waiting_balance，不需要为此再加状态接口。仍需并发寄送/费用闸边界验证。
- 额外发现待核对：安卓手动创建/完整编辑自定义角色入口（CHR-07）在源码中未找到，不能仅因旧任务卡声明完成而略过。需要按需求和设计确认并补齐。

## 当前断点（2026-10-11 13:40，优先于上文旧进度）

- 已提交客户端修正检查点：83b09b356b8d5abf25529a5d5a8ec8696bb0746c。含安卓手动创建/完整编辑、我的角色列表、完整字段、头像上传、聊天输入草稿恢复；不代表独立验收。
- 固定源码、资源安静时全量64文件537项通过：full-tests-round5.log。此前资源争用/加载旧契约的失败日志仍保留，不能与后续新改动的全量通过混算。
- 网页22个既有场景、新增真实HTTP搜索1项、后台7项分别通过（web-e2e-round2.log、web-search-e2e-round3.log、admin-e2e-round1.log）。
- 安卓 Windows ktlint/detekt/assembleDebug 通过，最新 APK 为 app-debug.apk（20659139字节）；Linux 整套 Robolectric 30套件121项全通过、零跳过（android-linux-all-round5.log 和 android-linux-all-final-results）。Linux 运行修复的是资源位置及依赖缓存，未改生产 FileProvider 或跳过权限断言。设备实际走查尚未完成。
- 本轮小巧思源码与0077迁移已接入回复链。真实回复测试18项通过（quirks-engine-round1.log），规则/配额/记忆3文件29项通过（quirks-memory-round2.log）；服务端类型检查、全仓lint通过。记忆新用例第一轮字段夹具错误已修正后复跑通过，不算生产问题。最新完整回归仍待执行。
- 新确认试聊缺口：没有正式好友的试聊被回复引擎取消，且保存前试聊、关闭清理缺失。ADR-0030登记独立快照和会话的实施方向，下一步实施后端、契约与端侧，不复用正式角色会话。
- Linux 容器 weiban-closeout-android-linux-retry 暂保留（/work/android，SDK /opt/android-sdk）；数据库测试串行使用 weiban_closeout_test，浏览器使用独立 weiban_closeout_probe_test。不得重叠重置同一测试库。
- 后续：试聊完整生命周期；A12原子寄送/恢复边界；导入并发/收藏失败清理；派发遗留逐条核实；最终全量与构建，部署/设备/供应商和另一位审查者的独立验收。所有以上通过统计仅为开发自测。

## 当前断点（2026-10-11 17:45，优先于上文）

- 小巧思已提交a8699c3；独立分支继续开发，共享main只读。总经理要求持续推进至产品完工。
- 0078/0079实现独立临时角色、来源版本、30分钟到期及拒绝过期聊天写入。结束在用户/会话锁内清除回复计划、消息和快照。已保存角色并发启动复用，未保存编辑快照独立。分类变严/版本变化停止旧试聊，检测儿童标记继承。试聊不进入好友、广场、常规会话列表、长期记忆、推演、养成、推送或小巧思。
- 真实数据库/HTTP：8项试聊与13项原有角色通过（trial-runtime-round12.log），覆盖生成中关闭、过期、正式历史保留、并发复用、跨用户拒绝、分类变严、儿童标记继承、注销清理。APP_ROLE=web只入队；注销通过真实请求/事件、显式真实worker处理器及回报验证，未宣称pg-boss自动消费通过。
- 网页构建通过（trial-web-build-round1.log），真实HTTP完整流程1项通过（trial-web-e2e-round2.log）。安卓ktlint/detekt/assembleDebug及Compose/Room/HTTP测试服务器流程1项通过（trial-android-check-round2.log），JUnit零失败零跳过。APK20689194字节，17:41生成。真机及供应商模型未验证。
- 全仓类型检查（trial-typecheck-round4.log）、lint（trial-lint-round1.log）、契约/Kotlin/icons/tokens一致性（trial-generated-check-round1.log）通过；最新检测标记测试另跑eslint通过。最新完整服务端/安卓回归待执行，旧64文件537项与Linux121项不能算最新源码通过。
- 失败轮次保留：runtime6/7/11为错误HTTP断言或测试路径；runtime9等待Web进程消费任务失败，改显式真实worker处理器；网页1定位也命中分类说明，改精确textbox；安卓1测试漏SessionVault导入，补后通过。未修改生产拒绝状态或降低权限断言。
- 下一步：修复已核实头像展示/媒体用途与归属校验缺口，核对网页生日/头像；A12寄送/恢复并发、导入归属并发、收藏快照失败清理、派发遗留、最终回归、部署/设备/供应商与独立验收。
- 环境保持C:\wb-dev\codex-closeout、codex/product-closeout；后端测试库weiban_closeout_test，浏览器独立probe库。Linux安卓容器保留待全套回归。所有结果为开发自测，项目未完成。

## 头像与编辑字段更新（2026-10-11 17:55）

- 试聊检查点完整SHA：a9d8be9e10e765214f9cc71c32feb784568fa0d2。本轮后续禁止直接PATCH临时试聊快照，防止生成中的不可变人设被改写。
- 自定义角色的头像ID不再被映射器丢弃，创建/列表/资料/编辑返回真实短期链接；读取校验媒体归属和用途，允许自有custom_character_avatar与公开plaza_avatar/character_avatar。真实上传验证错误用途、他人私有ID拒绝、修改保留、清空恢复默认与公开广场头像继承。角色/试聊22项通过（custom-avatar-round3.log）；此前分类/装配一起31项通过（custom-avatar-round2.log）。
- 网页添加头像裁剪上传、生日和外表儿童；编辑时提交完整分类，清空标签和示例对话不再变成undefined而被忽略。浏览器真实HTTP两项通过（custom-avatar-web-e2e-round1.log），网页生产构建通过（custom-avatar-web-build-round1.log）。Web/server类型检查与本轮全仓lint通过；最后公开素材兼容改动仍需全量核对。
- 继续推进：最终全量回归；导入草稿生日/头像与音色覆盖；A12原子寄送恢复、导入归属并发/收藏失败清理；派发遗留、部署/设备/供应商及独立验收。所有结果均为开发自测。

## 本机部署与队列复核（2026-10-11 18:22）

- 总经理确认先在自己的电脑部署，不依赖外部服务器。新增deploy/local/Start-Weiban.ps1与Compose覆盖配置，沿用生产镜像和持久卷，项目weiban-local。真实入口http://localhost:8080与http://localhost:8081，仅127.0.0.1绑定；数据库不暴露宿主端口。开发与部署数据库独立。
- 首轮镜像构建成功但迁移被生产媒体HTTPS校验拒绝（local-deploy-build-round1.log）。补显式ALLOW_LOCAL_HTTP回环白名单，外部HTTP仍拒绝，同时堵住生产未填写媒体地址却默许默认HTTP的配置遗漏；配置/密钥集合2文件11项通过，server类型检查和改动eslint通过。原有两个生产配置夹具改为显式HTTPS地址。
- 第二轮真实生产镜像构建/68项迁移/服务健康通过（local-deploy-build-round2.log）。创建管理员weiban_admin，随机密码及入口存C:\wb-local\admin-login.json；数据库连接与加密主密钥在C:\wb-local\secrets。未把秘密写入Git、日志或模型工具输出；后续不得重新生成已使用主密钥。
- 双端实际浏览器登录与刷新恢复会话通过，localhost安全上下文为true，控制台错误为空（local-browser-smoke-round2.log）。第一轮浏览器自测等待新账号主导航超时：新账号实际进入必填昵称引导，改为核对该页面，未修改产品绕过引导。脚本首次Windows ESM绝对路径格式错误已修正，非产品故障。
- 重启postgres/app/caddy并通过SkipBuild启动检查，原管理员两种会话重新登录及刷新通过（local-deploy-restart-round1.log、local-browser-restart-round1.log）。本次只证明账号数据库持久化，不冒称媒体备份恢复或真实AI通过。服务保持运行，已请求在Codex打开用户端。
- 最新服务端全量full-tests-round6.log为67文件中66通过、568项中567通过，唯一失败ai-runtime-queue恢复测试20秒内仅2条角色消息。原夹具单独复跑1项通过（queue-recheck-round1.log）；静态发现默认高贴合度可随机触发30–180秒已读延迟，可能干扰该非小巧思测试，原失败轮次没有直接配额行证据，因此原因仍为推断。夹具通过真实CompanionSettingsService将personaFit设置为1，保留20秒、四条消息与单次扣费断言；独立小巧思场景维持原有验证。修正后单项通过（queue-recheck-round2.log），最终全量仍待源码收口后重跑。
- 后续：日常照片类别/历史插画素材过滤、55分钟提示验证、AI评测统一登记及编号；导入字段/音色与并发；A12/收藏失败清理；最终全量及安卓Linux回归；媒体备份恢复、真实供应商、设备与另一位审查者的独立验收。保持活动目标，项目未完成。

## 素材、通话与评测登记收口（2026-10-11 18:45）

- 本机部署检查点00250577392e27fb199afe9fa38aff778f563eb8。继续在独立分支开发，共享main未切分支、未写业务代码；活动目标保持未完成。
- ⑱新增管理素材用途daily_photo，聊天/朋友圈兜底只按日常照片挑选，不再借用moment卡面。卡片保持cardKind、宠物保持pet。MediaAssetReadPort.listCardTemplates新增可选classicalStyleOnly，历史人物发图同时要求古风与无肖像；空集合不发图。管理端展示和契约/Kotlin资源同步，无需迁移（kinds为JSON）。管理端响应枚举与服务器同期部署，按ADR-0028管理枚举例外并入尚未发布的3.1，内部端口可选新增向后兼容。
- 素材真实策略、HTTP上传/登记和数据库筛选5项通过（daily-photo-runtime-round3.log）；第一/二轮夹具缺真人发布来源/拒绝示例及来源访问日期，被正常发布门禁拒绝，补齐夹具后通过，未绕过门禁。角色发布评测端口为受控测试替身，未声称供应商或50张人脸效果通过。
- P-31虚拟计时验证55分钟前不提醒、到时仅一次提醒、59分半道别结束、提前挂断停止轮询/计时。发现道别完成后25秒计时器残留，已清理；阻塞语音测试又证实最多20秒余额轮询+25秒道别违反耗尽后30秒，改道别最多10秒并中止仍阻塞的合成，关闭取消全部计时器。通话3项通过；前两轮路径夹具错误/真实计时器残留以及预算首轮30秒超时失败均保留（call-agent-timers-round1/2.log、call-agent-budget-round1.log）。
- AI评测src/registry.ts统一84题（L2 42、推演14、主动6、群聊5、社交6、宠物4、玩法7）与版本2026-10-11.1。R-01为eval-plan的虚构示例林夏予，假设真人celebrity；child兼容C-01罗小黑，未知编号不默认。全部评测专用，不上架；完整R/C受控卡片仍须真实评测准备。summarizeEvalRun核对全登记题输出与角色/版本/依据/评审，重复/未知/失败不能被覆盖，缺证据待评审；最多返回passed_registered_cases，非发布许可。8项工程测试通过，fixture全通过不算真实模型结果或完整19类覆盖。
- 新核实部署图片问题：生产后台和用户入口不同源，后台img-src self拦截用户入口的媒体URL。实际本机浏览器证据local-media-csp-round1.log确认跨入口图片被CSP拒绝；该安全限制维持。后台所有素材/缩略图/宠物图片及音色样音改经自身API代理，保留签名查询与后端权限。真实HTTP图片上传/保存/显示/刷新E2E1项通过（admin-media-proxy-e2e-round2.log），确认src与后台同源、有token、像素实际加载且控制台无错误。首轮直接上传损坏PNG夹具被解码校验拒绝，改浏览器canvas生成真实PNG后通过，未放宽媒体校验。
- 本批最终4文件16项自测通过（media-call-eval-final-round1.log），全仓类型检查（media-call-eval-typecheck-final.log）、后台类型/生产构建、全仓lint/依赖边界（media-evals-lint-final.log）与契约/安卓生成一致性通过（media-contracts-generated-check-round1.log）。最终全量及最新安卓运行回归尚未完成；源码本批后续后台代理改动已独立E2E验证。生产本机镜像当前仍为上一检查点，下一步构建升级并核对后台日常照片入口，不将开发源码检查当作已部署证据。
- 下一步仍为导入草稿生日/头像及音色覆盖、导入并发/归属、A12原子寄送恢复与收藏失败清理；备份恢复演练、最终全量及安卓Linux回归、真实供应商/设备与另一位审查者验收。

补充（18:49）：通话新增“模型回复仍阻塞时余额道别不得等待”场景，首轮失败（call-agent-pending-reply-round1.log），确认队列会拖延30秒目标。余额/ASR耗尽/59分半结束改为直接触发幂等道别，晚到回复及语音结果拒绝继续播放，语音异常仍发end。通话4项+评测8项通过（call-evals-round5.log），须在本批最终类型/lint复核。后台完整8项通过（admin-e2e-round2.log）；音色预览也使用同源路径。本批仍待本机镜像升级与对应记录。

本机升级完成：源码检查点e4f2180282aa95933df6d9aa2dc550d1349fa440，生产镜像构建和服务健康通过（local-deploy-upgrade-round1.log），新迁移0项、原密钥及卷保留。两个入口实际登录/刷新/安全上下文通过（local-upgrade-login-round1.log），新后台日常照片入口可见（local-upgrade-policy-ui-round1.log）。外部未代理图片仍被原CSP拒绝为预期负向控制，并未把安全限制改为通过跨域图片；正向签名媒体由独立probe数据库E2E验证。镜像ID与验证时间保存C:\wb-local\deployment-version.txt。最终服务端类型检查call-agent-final-typecheck-round1.log与全仓lint/依赖media-calls-lint-final-round2.log通过。共享目录仍在main，既有dirty/untracked保留未修改；Claude会话文件mtime为09:04，未向其发送新消息。开发副本保持可恢复，项目目标继续活动，剩余项以T-103为准。
