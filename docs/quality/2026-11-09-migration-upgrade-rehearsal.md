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
