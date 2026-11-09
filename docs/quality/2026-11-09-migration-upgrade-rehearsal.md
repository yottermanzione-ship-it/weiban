# 官网、旧更新协议与正式 APK 分发：本机演练

日期：2026-11-09。开发及自测：Codex 分工助手。任务为迁移计划 P07/P08 的本机准备，附录为 P02 漏项只读核对。依据[正式迁移方案](../handoffs/2026-11-09-migration-cutover-plan.md)、[准备核对](2026-11-09-migration-readiness.md)。

工作副本 `C:/wb-dev/wb-migration-rehearsal-1109`；分支 `codex/migration-rehearsal-20261109`；开始时完整提交 `cc10580419eeb1306b361b799688af85ec52530d`。本报告对应该基线加本轮未提交的分发演练与清单规划脚本/测试；主会话统一集成后另固定最终提交。旧源码只读路径 `C:/wb-ref/old-weiban`，未把本地旧快照当成线上最新源码。

## 结论

**本机开发自测通过，P07/P08 的正式环境验收仍未完成，不能据此切站。** 已有正式 3.0.0/127 APK 的实际身份、签名和字节核验通过；同一份原包在回环 HTTP、严格验证证书的回环 HTTPS 上，完整下载及断点拼接均匹配原始哈希。旧客户端字段、官网默认/动态入口、业务维护时仍可更新、错误及缓存行为有可重复的本机脚本。

没有连接生产域名或服务器，没有 SSH、DNS/下载配置/公开页面变更，没有启动或操控真机及已有模拟器，没有生成、重签或交付任何 APK，没有读取真实用户数据、生产私钥、SQLite 或数据导出。未重做经理已确认的通知、顶部、语音等无关功能。此处的 HTTPS 证明本机服务和校验流程，不证明正式域名 DNS、证书、静态服务器或带宽已准备好。

未在明确旧工程路径及文档引用的 `C:/wb-dev/artifacts` 找到旧正式 APK；后者只有不符合条件的旧调试包，因此没有拿调试包代替旧正式版，也没有扩大搜索到私有会话或数据目录。旧版打开→发现新版→系统覆盖安装→重新登录→迁入历史可见的连续设备流程未执行；没有用分开的静态/浏览器测试拼成“真机升级通过”。

## 已交付的本机工具

- [migration-distribution.mjs](../../scripts/ops/migration-distribution.mjs)：从正式 APK 读包身份，调用已有 `readApkMetadata`、`assertUpgrade` 和公开身份配置；构造只在回环使用的清单、两个旧兼容接口与本机页面夹具；HTTP/HTTPS 自行启动、核对后关闭。
- [migration-distribution.test.mjs](../../scripts/ops/migration-distribution.test.mjs)：14 项针对包清单、旧协议、页面动态脚本、Range、缓存、错误与 HTTPS 的开发回归；另复用既有升级工具 12 项检查，共 26 项通过、0 失败、0 跳过。
- 本报告：固定原包证据、复现命令、正式切换前仍需完成的工作，以及仅依代码/schema 得出的漏项附表。

脚本不接受公网地址，监听固定 `127.0.0.1` 和系统分配端口；HTTP 客户端也只接受该字面地址，不跟随重定向，不访问任何外部地址。正式包只做临时同字节 ASCII 文件名副本，供 Windows `aapt` 处理；副本在 `scripts/ops/fixtures/migration-distribution/.scratch-*` 内，结束时检查目录边界后删除。当前 TLS 测试私钥由 Node 在内存生成；Windows 使用现有 PowerShell 7/.NET 从 stdin 接收内存 RSA 参数并向 stdout 返回公开证书，其他系统使用 OpenSSL 的 stdin 路径；不产生密钥文件、不装入系统信任库。工具无部署、上传、DNS、后台配置、ADB 或设备操作能力。

历史纠正：第一版曾把仅供本机回环的临时合成 TLS 私钥写入 scratch，随后已由 finally 清理，并核对目录为空；不能改写成从未产生过密钥文件。主会话指出经理“密钥密码令牌不写文件”的严格约束后，已移除该写入实现。Windows OpenSSL 3.5.8 实测不接受 `-key -` 或 `/dev/stdin`，两次内存输入尝试失败后采用上述 .NET 路径，未回退磁盘私钥。最终 HTTPS 的证书链和主机名校验通过；没有接触真实生产签名材料。

本机官网是入口行为夹具，不是对原官网完整页面的已完成搬迁。新版网页目标在夹具中为 `/new-app/` 占位页，不含登录或历史；原 `/app/` 和深链接临时 302 到占位首页，丢弃旧路径及查询参数，不转发旧接口。

## 原正式包证据

原文件：`C:/Users/lomjy3/Desktop/微伴-3.0.0.apk`。只读核对结果与[11-08 正式交付回执](2026-11-08-android-notifications-devices.md)一致。

| 项目 | 实际结果 |
| --- | --- |
| applicationId | `com.weiban.weiban` |
| versionName / versionCode | `3.0.0` / `127` |
| minimumSdk / debuggable | `24` / `false` |
| 签名证书 SHA-256（公开指纹） | `2eea5e32df600c2eacd709d712cb86d6a18e7cb68faca8f2962694a5f9b3a865` |
| APK 字节数 | `5,392,086` |
| APK SHA-256 | `5e0918707cdb814d6dae5a32c895fe61eb2e3b78dfdf98961cfa82c108318e87` |
| APK SHA-1（旧客户端兼容字段） | `6eec0e526fb20079a1aa2a3bd393399a712b1f67` |
| 校验依据 | `apps/android/legacy-upgrade.properties` 的原身份、公开证书、前序构建126、候选127；`aapt dump badging` 与 `apksigner verify --print-certs` 实际产物结果 |
| 设备升级 / 数据迁移 | `not_performed` / `false`，工具明确保留该限制 |

本机清单使用包含版本、构建号和完整 SHA-256 的新路径：`/download-assets/weiban-3.0.0-127-5e0918707cdb814d6dae5a32c895fe61eb2e3b78dfdf98961cfa82c108318e87.apk`。它是本机演练路径，不是已经生效的公开下载地址。包、文件名和元数据不分别手填；内容变化必须获得新的不可变地址，不能静默覆盖旧包路径。

首次直接把中文文件路径交给现有工具时，Windows `aapt` 报 `Illegal byte sequence`；采用同字节 ASCII 临时副本后成功。没有修改或重构建原包。首次 HTTPS 回归在响应结束后读取已释放的 socket，造成验证结果 `null`；已改为收到响应时固定 TLS 授权结果，完整重跑通过。这两次初始失败没有写成通过。

## 旧协议核对与本机验证

旧源码依据：

| 源码 | 具体事实 |
| --- | --- |
| `server/lib/app_config_store.js:89` | `build` 决定是否存在新版；`has_update` 已包含软/强制开关；缺少构建号不提醒；正式与定向测试通道可相互影响 |
| `server/routes/activation.js:153` | `/api/app/config` 返回平铺字段；大小及两种哈希分别为 `download_size_bytes`、`download_sha256`、`download_sha1` |
| `server/lib/download_asset_info.js:20` | 旧代码按 `/download-assets/` 文件名找本地包；单换新服 URL 不保证旧机得到正确哈希，首次计算还可能返回空摘要 |
| `src/lib/services/app_update_service.dart:82` | Flutter 读取 `has_update` 并再次比较运行构建号，识别 `update_channel` 及上述三项下载元数据 |
| `src/lib/services/apk_download_service.dart:307` | 断点请求 `Range: bytes=<已下字节>-`，接受200/206；200会清空旧部分重新写，完整后核对长度和摘要；优先SHA-256 |
| `server/routes/admin/system.js:88`、`server/public/download-page/index.html:515` | 官网动态配置形状为 `{ok:true,config:{normal:{url}}}`，脚本只更新有配置的链接；原页面默认值也必须一并改变 |
| [旧版调研](../refactor/01-old-weiban-review.md) 第256行 | 历史记录：Android 包显示2.1.3/123，内嵌Dart曾为2.1.2/120，更新检查使用后者。本轮没有旧包重新验证该错位，因此同时覆盖120/123，不能只测123 |

本机 HTTP 与 HTTPS 各执行 19 类检查，真实下载数据均来自上述正式原包：

| 范围 | 已验证行为 |
| --- | --- |
| 旧版本判断 | 120、123、124、126发现127；127、128、0、无效构建不误报；软提示为true、强制为false、最低构建0。额外回归覆盖关软提示、最低构建与强制的新版门槛 |
| 通道 | 不读取用户令牌，不提供定向测试包，带合成Authorization或`channel=test`也只得到stable；没有读取或变更线上测试渠道 |
| 配置一致 | 默认页面与动态配置的Android、网页、iOS目标一致；quick/normal/developer旧字段全部返回同一份正式包，不残留网盘密码、调试包或对象存储备用链接 |
| 旧业务停写 | 非兼容业务`/api/*`返回503＋维护信息＋Retry-After；两个更新/下载配置接口和APK仍可读；无数据库或旧业务服务依赖 |
| 真实字节 | 完整200、HEAD类型/长度、SHA-256与SHA-1；分段206、旧客户端下载方式`bytes=N-`，两段拼接匹配正式原包 |
| Range | 起止、开放尾部、后缀、末端裁剪；过界/非法/多段请求416并带`Content-Range: bytes */N`；旧If-Range返回完整200，匹配If-Range返回206 |
| 缓存 | 版本化APK带摘要ETag、immutable、no-transform；If-None-Match/If-Modified-Since正确304且无正文；配置/页面/维护/错误返回no-store，不缓存“没更新”或404/416 |
| 错误及入口 | 缺失包404，写入405，错误Host421；旧/app临时跳转不携带旧深链接或查询参数；页面配置失败保留默认值，拒绝跨源动态链接 |
| TLS | 临时证书仅SAN=127.0.0.1；未授信请求失败，显式本机CA、默认主机名验证的请求成功；没有`rejectUnauthorized:false` |
| 清单保护 | 包字节或清单摘要/大小被改会在监听前拒绝；服务快照独立于调用者后续修改，防止元数据与传输字节混用 |

复现（在独立副本根目录，Node24、JDK21、Android build-tools36.0.0、PowerShell7；非Windows需OpenSSL，不需要联网）：

```powershell
node --test scripts/ops/migration-distribution.test.mjs apps/android/tools/verify-legacy-upgrade.test.mjs
$env:ANDROID_HOME = 'C:/android-sdk'
node scripts/ops/migration-distribution.mjs 'C:/Users/lomjy3/Desktop/微伴-3.0.0.apk'
pnpm exec eslint scripts/ops/migration-distribution.mjs scripts/ops/migration-distribution.test.mjs
pnpm exec prettier --check scripts/ops/migration-distribution.mjs scripts/ops/migration-distribution.test.mjs
```

可选第二个位置参数只用于已持有的旧正式 APK 双包静态身份/构建比对；不会安装或启动它。CLI 输出 `productionReady:false`、每个本机端口及通过项，退出后关闭服务并移除临时副本。本轮未添加 APK 二进制、证书或数据夹具到 Git。

最终检查：上述26项Node检查、真实正式包HTTP/HTTPS演练、两个脚本ESLint及Prettier均退出0。仓库规定文档不由Prettier处理；三个本轮文件另检查末尾换行、行尾空白与冲突标记，均通过。演练目录核对为空，未留下临时APK/证书；工作分支未切换，未提交或推送，其他分工的文件未修改。

## 进入正式切换前仍需的证据

| 门槛 | 本轮结果与剩余 |
| --- | --- |
| P07 官网与配置搬迁 | 本机逻辑通过；原官网所有按钮、二维码、图片/静态依赖及默认文案尚未搬迁；需要在实际候选中同步默认/动态入口，并沿本清单格式承接旧接口 |
| P07 新服直出 | 回环HTTP/HTTPS/Range通过；正式dl域名的DNS/CDN依赖、TLS、服务器静态目录、容量及带宽未检查。实际文件应先以临时名写入、核对长度/哈希、再原子改名并发布兼容清单；旧下载中的文件须继续按原字节保留 |
| P07 独立兼容服务 | 本机无旧数据库依赖；实际新旧两端过渡配置尚未部署。需保证业务停写后旧/app引导、更新配置、APK仍可服务，不把整个旧/api反代给不同协议的新后端 |
| P08 原包身份 | 实际127包通过，属于已交付正式原包；发布前还需确定全员/定向渠道实际最高构建，不能在已分发更高版本时固定发布127 |
| P08 连续设备升级 | 未执行；需持有旧正式包并在受控设备完成发现、下载、系统覆盖安装、合成本机标记保留、重新登录与对应已迁历史。静态同签名不保证旧Flutter缓存可被新壳读出 |
| P08 用户告知 | 本机已有告知要点；真实维护日期/时长尚未确定。正式公告需说明重新登录、会员核对承接、本机未同步内容、iOS新图标及通知授权。此文及夹具未对外发布 |
| 独立验收 | 上述均为开发自测；正式放行需独立审查以及尚缺的现场证据 |

本轮无需经理重复测试已确认的通知、顶部、设备或语音功能，也不触发自动安装/切站。正式来源仍须由主会话按最终远端与线上完整提交执行既定来源门禁；此演练不运行会接触服务器的发布检查。

## 只读附表：内容导出器之外的迁移域

只检查旧代码/schema及当前新代码，不运行旧模块、不打开SQLite、不读取导出/聊天/收藏正文。`export-legacy-content.py:36` 的查询白名单共14个表；它没有下列域，不代表所有历史工具都没处理过。数量、具体用户、当前线上开关及数据是否已有迁入成果均未核查。

| 域与旧源码证据 | 当前目标已有能力 | 漏项、限制与应准备的处置 |
| --- | --- | --- |
| 群记忆：`server/lib/migrations_registry.js:179` 的`group_memories`，按group_id存content、enabled、source；第2979行追加subject_character_id、supersedes_id、provenance_json | `apps/server/src/modules/ai-runtime/infra/db/schema.ts:266` 的加密memories有user/character/conversation及origin=group；同文件第147行group_memory_states是提取游标/任务状态，不能当作群记忆正文表 | 白名单没有group_memories，现有extras导入的是user_memories并写origin=private_chat。需要单独映射群归属、角色主体、启用/遗忘、来源及替代关系；旧无角色主体记录不能任意广播给每个角色/用户，不能导入后触发付费重新提取 |
| 个人表情及包排序：旧`migrations_registry.js:3003` 的user_stickers；3328/3331追加slot/is_public，3390的user_sticker_pack_pins | 新`media/infra/db/schema.ts:107` 有按用户去重的user_stickers，154有user_sticker_packs，库表情/包也有独立表 | 原导出白名单不含这些表。**已有部分表情承接**：`import-legacy-content-media.mjs:270`及290会把媒体计划中带stickerId的对象写入目标user_stickers；这不证明完整收藏、角色槽位、私有上传、公开状态、包排序都已迁。需逐项映射catalog_id/pack_id、归属和文件，并保护新用户排序/删除状态 |
| 消息收藏：旧`src/lib/services/favorite_store.dart:95`明确是本地快照、不做云同步；账号键favorite_messages_*，最多500条 | 新`library/infra/db/schema.ts:21`有加密favorites，含sourceId、归属、内容范围、媒体快照及唯一键 | **11-09经理已决定旧安卓聊天消息收藏必须保留**；它不在服务端表中，追加服务器导出查询也拿不到。主会话与媒体分工继续实现保留/迁入；规划要求归属与源快照映射、原字节保存、可用读取/导入结果及往返校验。仅保留不可访问的旧应用容器不算完成，也不承诺尚未实现的自动迁入 |
| 恢复码：旧`server/lib/user_store.js:25`的recovery_code_hash；`server/routes/auth.js:248`起使用bcrypt核验恢复码后轮换密码/恢复码 | 新`identity/infra/password-hasher.ts`能校验旧bcrypt密码；`identity/application/commands.ts:101`有管理员密码重置。当前`identity/infra/db/schema.ts:37`用户表没有旧恢复码字段，身份模块未见旧恢复码入口 | **11-09经理已决定恢复码机制不要、不承接**。不导出或导入旧恢复码/哈希，不新建恢复码兼容适配，保留新版现有账号找回方式。密码bcrypt兼容与这项停止承接决定分开。此决定不表示本轮删除旧数据库/备份或替用户改密；不再把是否保留恢复码作为待审批问题 |
| 微信/微博/QQ：旧`migrations_registry.js:1317/3193/3258`的独立bindings与inbox/deliveries；3421后微博按user_id+slot支持多个槽 | 新`channels/infra/db/schema.ts`有加密bindings、bind_attempts、收发去重/队列及QQ专属会话；新controller含微信二维码、微博凭据和QQ绑定；`channel-config.ts:76`起按启用、配置、公有访问/白名单返回实际可用性 | 导出白名单不含绑定/收发队列；新主绑定索引为user_id+channel，一用户一渠道，与旧微博多slot存在映射差异。需查明哪些能力真实启用、用户可达、收发验证与槽位处置；旧凭据/游标不能整表照搬。只有确认新版支持且已启用的渠道才能告知重绑；未支持槽位要明确缺失/留档或补实现。停止旧消费者、处理在途唯一性后再启新消费者 |
| 云偏好与旧人设备份：旧`migrations_registry.js:1082/1101`的user_persona_backups(package_json)、user_client_prefs(prefs_json)，后者有revision | 新identity.preferences、notification_settings以及chat.user_conversation_states有主题、通知、置顶/免打扰/背景等对应项；已有persona_customizations迁移路径 | 原导出包含persona_customizations，但不含整包旧备份和client_prefs。旧迁移本身可能已把部分备份转为customization（旧registry第2201行），应先核已有成果再补差。需要字段级冲突比较；不能把旧整份JSON覆盖新版偏好，也不能宣称备份全部漏迁或已迁 |
| 其他本机状态：旧`message_store.dart:546/604/735`有耐久媒体/消息/群发outbox；1387起pending_sends等按账号存；`local_persona_store.dart:221`起local_memory_items、summary、sync_meta、sync_ops、edits等；`client_prefs_cloud.dart:306`起有待同步状态 | 新壳与网页有自己的会话、缓存及待发送格式；公开升级工具明确不自动导入旧登录/缓存，见`apps/android/README.md` | 服务器内容快照无法覆盖尚未上送的本机操作。需分清已经同步、可重建缓存、未同步编辑、未发/待确认消息、收藏等，防止把旧outbox重放成重复消息或重复收费。保留旧应用数据，先设计兼容/导出和确认方案，再决定能承诺的承接范围；本轮未读取任何设备文件 |

以上是迁移准备缺口与能力差异，未据此判定实际发生丢失，也没有把表存在、源码功能存在或历史通过记录当作本次迁移已经完成。

## P02 补充：表与字段清单规划器

新增 [legacy-delta-inventory.mjs](../../scripts/ops/legacy-delta-inventory.mjs) 和 [legacy-delta-inventory.test.mjs](../../scripts/ops/legacy-delta-inventory.test.mjs)。这是只读源码扫描与纯规划器，不含数据库连接、SQL执行、网络、数据导入或生产应用启动；测试使用自行定义的合成schema字符串和不含正文的合成事件元数据，不创建或读取真实SQLite。

源码读取仅限明确旧项目 `server/` 下的 `.js`/`.sql`，跳过测试、public、依赖、data、exports、备份、日志、隐藏目录及链接逃逸。使用项目既有TypeScript解析器读取字符串/模板语法树，**不执行旧JavaScript**；输出结构与摘要，不输出源码中的配置值。SQL动态加列、重建/改名及无法解析的声明明确列为待核，不推断为当前线上最终结构。

本次实际只读结果：25份含DDL源文件中识别110个静态声明表名，全部匹配明确域规则；14个在当前导出白名单内、96个不在。另列`@local_device`与`@recovery_codes`两个不能只靠表数量处理的域。源码包含82处需最终结构核实的DDL提示（最终计划按相同代码/文件去重），也包含历史临时迁移表；**110不是已确认的线上存活表数，96不是已确认漏迁表数**。原有其他导入及配置/审计留档成果须按域核实，不能直接全表补迁。

| 固定证据 | 摘要 |
| --- | --- |
| 本地源码结构清单 | `7e232db5dceb5cb116e2edede3f1d7b4fb239866a3129038c7c26260d7c9fe18` |
| 当前内容导出器清单 | `cdb8fc865ed082e299058dbb77a60b768adfde3b1320d14c757a51498b4b3e48` |
| CLI结果 | `status=blocked`，退出码2；117条去重后的待核原因。不是工具执行失败，也不是迁移可放行 |

### 每张表与缺失域的机器规则

CLI为每张表返回域、schema摘要、是否被导出、遗漏字段、允许处置、必需证据及阻断原因。代码按明确表名分类，不使用把所有未知表归入“其他”的兜底；新增未知表直接`UNCLASSIFIED_TABLE`。前后schema的新增/删除表、字段增删/类型或约束变化、导出列不存在，以及复用旧摘要的处置均阻断；`SELECT *`不能掩盖字段漂移。

每张表必须有逐字段映射/保护/加密留档/明确排除决定；密码、恢复码、令牌等敏感列禁止直接复制。按经理最新决定，`recovery_code_hash`只能明确排除，恢复码域只接受`do-not-carry-forward`，任何导出器通配或投影包含该字段也阻断；保留新版现有找回方式，不需要再征求同一决定。旧消息收藏域只接受`preserve-required-favorites`，必须有可用的保留读取/迁入与原始快照校验证据。已被原导出器覆盖的表同样需要映射和目标保护证据，表名列入白名单不等于已迁入。证据引用必须是结构化摘要并绑定当前schema与exporter，单独`count=0`或`complete=true`不算证据。

| 域 | 必须具备的承接/保护要点；工具不会自动选处置 |
| --- | --- |
| 账号、关系、私聊/群聊、朋友圈 | 稳定来源ID、归属、目标基线、三方比较及删除屏障；角色身份、小V、好友永久删除、群成员映射、消息拆分/引用/游标/分页重同步按域追加；不回放历史副作用 |
| 群记忆与个人记忆 | 群/用户/主体映射，无主体记录具体决定；启用、遗忘、替代关系及可见范围；不因导入触发付费再提取 |
| 个人表情与表情包 | 文件摘要/归属、catalog与pack映射、角色slot及公开性、排序/删除保护、已有表情导入回执；不能以“消息里的表情已迁”替代整个收藏域 |
| 旧人设备份及云偏好 | 已有customization去重，字段冲突与新编辑保护；不把旧整包JSON覆盖新资料 |
| 恢复码、本机独有内容 | 恢复码已明确停止承接，旧码/哈希不导出、不导入，保留现有新版找回方式及密码保护；收藏已明确必须保留，需账号/源快照映射、原字节保存、可访问读取/迁入、往返摘要，不允许以不可读容器替代。本机未发送工作仍需防重放，未同步编辑需独立处置 |
| 微信/微博/QQ | 选择“重绑”前必须有已启用且验证的能力证据；旧消费者停止、在途投递去重、凭据处理、重新绑定指引；微博另要求多slot具体处置。未接入不能返回重绑就绪 |
| 权益、订单、邀请奖励 | 真实订单/付款/既有导入/新版流水证据链，旧履约去重，保留新版钱包与权益，迟到付款方案。使用次数单独留档，不能当钱包余额 |
| 队列、主动任务、通知、会话 | 待处理工作排空对账并留档，禁止自动重放；旧令牌不直接导入，保护新会话、唯一通知方与新设备登记 |
| 角色/音色、系统配置、运维记录、schema控制 | 对照已有新资源和配置逐项处理，不重付费克隆、不复制整份环境/密钥；审计/历史按归属和保留规则留档；旧schema记录仅核查，禁止在目标执行旧DDL |

### 删除、改密和权益事件证据

三类事件清单均须绑定初始/最终旧快照、新站基线、明确UTC窗口、schema/exporter摘要及扫描清单；事件集合必须与预期事件集合摘要相符，不能删除条目后仅重新计算一个更小的清单摘要蒙混通过。空清单须有空扫描证明，事件ID重复、窗口外事件、快照不一致或不允许的字段均阻断。输入只接受事件元数据和不透明摘要，不接收密码/正文；输出不回显额外私有字段。

- 删除：具体源对象、归属、拆分后所有目标片段集合、映射与目标删除屏障。目标隐藏动作另需具体决定；仅有452这样的计数不够。
- 改密：旧/新/基线凭据的不可逆指纹比较；新版已改变时只能保留，拒绝argon2id回退bcrypt。旧哈希不同不能充当改密事件；采用旧变化需来源事件及具体决定，新账号导入需目标不存在证明。
- 权益：订单、付款、首批导入和新版流水的证据链；只对经核定的未兑现权益引用批准差额。待付/退款不能按已到账补入，同一订单不能换事件ID重复补权益。

这些摘要仅把计划绑定到调用者提供的证据，**工具不能凭摘要证明受保护证据本身真实完整**。完整合成输入最多返回`planned-for-synthetic-rehearsal`，始终`productionReady:false`；真实源码扫描始终保留`SOURCE_SCHEMA_NOT_RUNTIME_VERIFIED`等门槛。后续还要在获准的受保护环境核实运行库结构和证据、确定缺失域实际实现/留档决定并由主会话形成正式放行记录。

### 本轮补充验证

```powershell
node --test scripts/ops/legacy-delta-inventory.test.mjs scripts/ops/migration-distribution.test.mjs apps/android/tools/verify-legacy-upgrade.test.mjs
node scripts/ops/legacy-delta-inventory.mjs 'C:/wb-ref/old-weiban'
pnpm exec eslint scripts/ops/legacy-delta-inventory.mjs scripts/ops/legacy-delta-inventory.test.mjs scripts/ops/migration-distribution.mjs scripts/ops/migration-distribution.test.mjs
```

最终54项检查全部通过、0失败/0跳过：28项清单与事件规则检查（含最新恢复码停止承接、消息收藏必须保留）＋14项分发检查＋12项原升级工具检查。四个脚本ESLint及Prettier均退出0。真实正式127包在改为内存TLS签发后完成HTTP/HTTPS各19类核验，仍为原SHA-256。本机源码CLI按预期返回阻断及退出码2；未开启线上检查、读取真实SQLite/私有导出或写入任何迁移结果。文件未提交，交主会话统一集成。

给收藏实现分工的现有源码指针：`C:/wb-ref/old-weiban/src/lib/services/favorite_store.dart:9`的`FavoriteItem`为`chatKey/chatTitle/savedAt/message`四项快照，群聊chatKey为`group:<id>`；30–35行去重身份包含会话、消息时间、类型及**正文**，不可直接进入公开日志；57–71行序列化保留四项，savedAt缺失会回退当前时间，迁移不能无声重写原时间；7–8行约定源消息删除/撤回后收藏快照仍保留。95–135行是本机账号键、无云同步及旧无账号键迁移逻辑，138–166行是去重写入。该定位不读取任何设备收藏，不与主会话/媒体分工重复实现。

## 11-09 追加：微博五槽兼容候选（开发自测）

本节更新上方“新版微博单绑定”的历史缺口结论。基线 `35f510f1ecfbe9b7ced2e0d3e1655ed9c1716981`，候选仍在独立副本 `C:/wb-dev/wb-migration-rehearsal-1109` 的未提交工作树。按总经理保留旧功能的决定补齐微博五槽；微信与QQ继续单绑定。主会话提供的旧聚合为微博58行/50用户、5用户多行、active56/unbound2，微信32行、QQ1行；本分工没有读取这些真实行、任何旧SQLite、配置秘密、导出正文或设备数据，也未独立核验这些聚合。

### 源语义与候选承接

旧 `server/lib/weibo/slots.js:3` 定义主号/小蓝/小白/小粉/小黄与各自助手名。`migrations_registry.js:3405` 增加AppID/AppSecret，3413为active AppID唯一索引，3421–3439改为用户+槽及用户+角色唯一。`weibo/inbound_service.js:62` 的回信对象来自已鉴权连接消息 `fromUserId`，154–177把binding/slot/generation交给回复任务；`weibo/channel_runner.js:8`、60/88按binding与真实来信对象发送。旧 `routes/weibo.js:192` 初次连接会把bot UID写入weiboUid，因此单独一列 `weibo_uid` 不能证明真实用户回信peer，迁移不得猜测。

候选入口在 `packages/contracts/src/http/channels.ts:46/146/250`：契约7.10新增 `WeiboBindingsEndpoints` 的五槽列表、按slot连接、按bindingId换角色/解绑。已有端点保留；旧客户端无bindingId遇到多条持久绑定明确409，列表只返回聚合状态，不随意取首行或让Map覆盖。所有新操作的用户来自认证主体，跨账号bindingId返回404。

`0165_weibo_slots.sql` 给现有行补main，不改变ID、generation、密文或peer，加入用户/渠道/槽唯一、active用户/角色唯一和非微博仅main限制。另加 `reply_conversation_id` 与 `reply_after_seq` 配对边界；既有active按本人角色的唯一未归档私聊初始化lastSeq，无法关联时保留凭据并写明确待核原因，不普遍要求重绑。已有AppID指纹唯一约束保留；应用同时用用户锁与AppID锁处理并发。原槽重绑保持ID，按用户DEK及binding AAD重新密封，旧任务代际失效。回滚脚本遇到任何非main历史行直接阻断，不能通过降级丢弃多槽。journal仅在0164群记忆之后追加0165。

换角色仅处理目标binding：generation加一、取消pending/retry/sending、安排runtime reconcile；保留同助手已验证peer与凭据。最后入站代际核验与真实聊天写入共用数据库事务；`ChatUserPort.sendMessage`仅新增可选Tx，旧调用兼容。渠道先锁自身绑定再锁聊天会话，不在持锁期间另借连接。出站排队重新核验并锁代际；同步交给本地WebSocket缓冲前也核验目标binding和sending行，迟到重试不能复活取消队列。其他槽的角色、peer、凭据、代际和任务不受影响。runtime按bindingId维护连接，分页扫描所有active微博绑定，分别重连/回复，保留消息去重。

独立交叉审查发现“旧回复已生成、outbox尚未首次消费”的额外改道路径后，候选补为会话序号边界：每次连接/重绑/切角色，在binding→conversation同事务锁序下读取目标lastSeq；首次消费事件必须来自该会话且原消息seq严格大于边界。不能用updated_at或毫秒时间判断。真实ChatParticipantPort写入的旧A回复，在主槽A→C、蓝槽B→A后首次消费不入队；换凭据后首次消费的旧回复同样不入队，新回复正常。正式窗口先排空旧出站及未派发事件，再应用边界；历史消息重排须按reply_conversation_id翻译此游标并更新相关代际，主会话负责`legacy-delta-db`登记及回归，本分工未修改该执行器。

网页仍沿现有插件/Sheet设计展示五槽及状态，每格仅列未被其他active槽占用的角色；换角色与解绑使用该格bindingId，连接携带明确slot。账号变化清空旧摘要与弹层，丢弃迟到回包。没有新建上传服务、修改Android运行代码或操作当前真机。

### 绑定迁移准备仍是候选

新增 `scripts/ops/legacy-weibo-slots.mjs` 纯元数据规划器及7项合成检查，无文件读取/写入、SQL、网络或执行入口。它按明确旧bindingID、账号/角色映射及五槽保留每个来源，不从counts推断迁入；拒绝未知槽、私密附加字段、歧义目标基线、角色/槽/AppID冲突。旧unbound/revoked只留所属账号历史；已有新版绑定和解绑墓碑一律保护，不能覆盖或复活。

仅当凭据保管证据和鉴权来信peer证据都绑定相同来源binding、旧用户、AppID指纹时，返回“受保护候选”：将来获准的执行器应只在内存解封并按目标用户DEK/binding AAD重密封。只有bot UID、证据缺失或借用其他用户/槽证据都保持停用候选，需要补来源证据或本人重新授权。所有结果均为 `productionReady:false`、`execute:false`、`activate:false`；摘要本身不证明证据真实性，不能据此启动真实消费者。

正式窗口仍需在获准的受保护环境核实逐行映射、凭据是否可解密、peer来源、目标基线、旧消费者停止及在途去重回执，再进行明确授权的承接/启用。确需重授权只针对凭据失效/来源无法证明的具体绑定；五槽本身现在已有候选承接能力，不能将多槽功能当作“不支持所以只留一行”。本轮没有迁入真实凭据、重放真实消息、启动线上微博连接或改变公开入口。

### 验证与限制

- 专用数据库仅 `postgres://postgres@127.0.0.1:56389/codex_migration_weibo_1109`，专属容器 `codex-migration-chat-1109`；检查精确库名/回环端口及synthetic标记后才重建。未触碰共享weiban_test或其他库。CI仅另允许带GitHub Actions作业标记的既有独占测试服务。
- 新五槽服务端12项＋旧微博8项＋QQ11项，最终31/31通过。覆盖真实HTTP认证/授权、真实PG/DEK、0165升级/回滚门禁与既有active边界初始化、稳定ID、满五槽WSS同时连接、两槽独立peer/相同事件ID去重/回信/4002重连、跨用户与并发唯一性、单槽解绑、unbound不复活、旧单槽兼容、多槽409、切角色期间旧入站及旧sending失效、回复生成后首次延迟消费不能改道。
- 新增真实 `ChatUserService → ChatWriteService → 加密消息/同步日志/outbox` 回归，预先占住除1条以外所有可借池连接后仍成功写入1条合成文字。实时LISTEN客户端本身常驻1条连接，所以不能把整个App设poolMax=1作为同一条件；最初夹具因此超时，已改为扣除常驻连接后保留1条可用连接。未调模型或产生付费请求。
- 网页五槽2项、原微信/QQ及窄屏9项，使用真实组件与本机内存API夹具；不将这组浏览器测试和服务端合成链路拼成一次真实平台/设备端到端验收。凭据、令牌及TLS私钥均为合成内存材料；本机WSS使用证书与主机名校验，没有关闭TLS校验。
- 原channels内存/协议/DI回归5文件62项通过。server/web/contracts类型检查、定向ESLint/Prettier、契约7项版本回归、规划器7项、网页构建通过。契约generate输出7.10、1362定义、530接口、420路径；Android生成与候选打包由主会话统一进行。

复现命令（仅指定专用合成库）：

```powershell
$env:TEST_DATABASE_URL='postgres://postgres@127.0.0.1:56389/codex_migration_weibo_1109'
pnpm exec vitest run --project server apps/server/test/channels-weibo-slots.test.ts apps/server/test/channels-helper.test.ts apps/server/test/channels-qq.test.ts
pnpm exec playwright test --config apps/web/test/web-feedback.playwright.config.ts weibo-slots.spec.ts wechat-binding.spec.ts qq-binding.spec.ts
node --test scripts/ops/legacy-weibo-slots.test.mjs
```

以上为开发自测，未自签独立验收。真实微博平台、正式配置启用、迁移凭据承接和最终真实设备使用仍未验证；本轮不部署、不提交、不发布安装包、不自动切站。

收尾记录：最终31项集成回归与server类型检查再次退出0。按主会话指令核对容器ID/`weiban.fixture=migration-1109`、该专库synthetic标记及0个剩余应用连接后，仅删除 `codex_migration_weibo_1109`；查询pg_database结果为0。保留容器与其他库，回环浏览器夹具已退出，无遗留应用服务。复跑上述数据库测试前须先在同一受控本机容器重新创建这个明确专库及 `public.codex_weibo_fixture(synthetic boolean PRIMARY KEY CHECK(synthetic))` 的唯一true标记；测试会拒绝缺失标记的本机库。后续最终增量游标验证由主会话使用自己的新专库执行。
