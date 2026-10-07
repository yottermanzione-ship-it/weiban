# T-041 两端可靠聊天与通知客户端

2026-10-07；Codex；开发中。接续T-036至T-040服务端，不合并main。

依据D-L1-07/09、message-reliability、conversation-list/private-chat/contacts设计。范围：Web/PWA同步驱动与聊天/联系人/角色入口、通知归属校验与点击；管理后台告警红点/分页/处理；安卓Room协议驱动、WorkManager与原生聊天/联系人/通知。尚未完成项不标记验收。

必须先原子持久化状态/游标/outbox，再执行副作用；账号与会话归属在同一本机事务检查。退出停止驱动和在途请求，清库后迟到回调不能重新写入。补拉与快照必须networkOnly，不能把GET页面缓存当成功同步。完整重建先获取S再快照，再从S补拉；不丢覆盖负记录。复用19份两端协议向量，不另写一套排序/幂等算法。

当前实现客户端基础：ApiClient追加networkOnly与取消信号；IndexedLocalStore.setOwned事务归属写；SyncRunner串行处理、保存先于网络、迟到回调与保存失败保护。新增10条开发测试，原19份协议向量保持通过，共35条client-core测试通过。

Web已接HTTP/WS鉴权、补拉/重建、事务发送、虚拟历史、联系人/预设角色入口与聊天设置；PWA已接真实Service Worker归属/时效校验、去重、点击和退出清理，系统拒绝展示不吞掉相同ID后续重试。最新真实浏览器10组通过，含WS/撤回/历史、HTTP丢失ACK、断网刷新、账号切换和版本升级；其中通知系统展示层明确使用夹具，不构成真实OS展示证明。后台告警红点/分页/处理7组最新真实浏览器通过，丢失处理响应后同URL幂等重试。整仓49文件430条、依赖边界175模块629依赖、格式/类型/令牌检查通过。

安卓历史/负覆盖、可取消HTTP、networkOnly和Room归属事务已接入，已装配串行SyncRunner、单例ChatRuntime、HTTP快照/补拉，以及会话列表、私聊、引用/撤回/本人删除、已读、离线队列与重试。完整原生静态检查、52条JUnit零跳过与APK构建通过，含真实Room离线队列重启恢复/换号隔离、取消后的迟到结果不能二次保存，以及实际Compose进入会话→断网发送→提交Room后清输入→重启仍用同ID的一条交互测试。已读限制前台RESUMED，空队列不频繁整库写入。两端引用草稿仅保留ID，撤回/隐藏后从有效消息读取预览，避免残留正文。原生聊天其余UI交互和真机仍待测试，不能据一条交互测试宣称原生完整交付。WS、WorkManager、完整原生联系人/角色/设置、真机通知及保活仍待完成。最终发布与独立验收未完成。

前置T040远端f548ffdfca89d05fbebcf071501b83b234f0c10e，本机f432f85c455ae470860948919e2f140d9a33ebd4，同tree1b9952c5b3e98b05fde4b4501fd4e189d602438e。push37561984286、PR37561988414均success，已读取两套check及安卓job结果。

真机/真实厂商/iOS主屏幕PWA及独立QA另验。后续L2–L7继续。


T041已发布客户端检查点：本机f297a1d00e9f5acd0de1c54e60dffa96d29b5234，远端0748fba763ca66405bc7adb15c5611a1b0d844f3，同tree ae6e6b5aa65175cb3056968b2d01b3a96a35378a。push37566911981与PR37566914953（attempt2）均success，已读取最终结果；新源码生产镜像、14迁移与加密备份空目标恢复在push CI实际通过。PR首轮安卓KSP插件下载失败，不算通过；保持原锁定版本，单独重跑失败job后通过。原生WS与后台恢复属于检查点后的继续开发，不能借用上述CI证明新代码。


## T041 原生实时连接与后台恢复检查点（2026-10-07）

已装配原生同源WS、首帧2.2鉴权/无URL令牌、心跳/有限收件队列/前台focus/正在输入与退避，HTTP仍是可靠发送与断网补拉出口。Application单例供前台与WorkManager共享；仅前台或后台任务持有租约时轮询，最后一个后台租约退出即取消在途效果并保留原clientMsgId。WorkManager使用联网约束/指数退避/按账号会话追加唯一任务链；退出与换号取消旧tag，启动恢复Room队列，调度参数仅含归属ID，不含正文或令牌。UI调用者取消不会中断已开始的Room提交及应用级任务安排。

复核修正请求调度期间换号风险：ApiClient在进入IO线程前捕获会话，仓库向网络显式传递同一捕获对象；所有同步HTTP请求额外绑定所属userId/sessionId，旧任务不能用新账号令牌发POST、补拉或下载。networkOnly与请求owner合并为内部SessionCallOptions，不改网络契约。保留响应后的归属复核与Room事务检查。

完整ktlint/detekt/testDebugUnitTest/assembleDebug通过，60条JUnit/零跳过；新增真实MockWebServer WS握手/首帧/typing/presence/更新与旧socket不能退出新账号两条，Room/HTTP后台发送、限时取消后同ID重发/只保留一个ACK消息、过期账号任务/POST不出网、页面消失且Room被阻塞时提交后仍安排任务四条，以及捕获旧会话POST/媒体请求不出网一条。另有SyncRunner取消调用者仍完成本地提交测试。CI报告要求新增WS和后台恢复suite实际执行。最终本机证据/tmp/weiban-t041-android-background5.log与JUnit XML；源码未改版本或放宽检查阈值。中途静态检查未通过的轮次及工作区断开导致未完成的轮次不算通过。

这是开发自测：WorkManager系统调度/进程杀死/厂商保活和真实推送仍需设备验证；MockWebServer HTTP并非真实Node服务端到原生客户端整链路。原生联系人/角色/聊天设置、默认头像、客户端引导等继续开发；T041与整个产品仍未完成，不标记独立QA通过。发布后另读本检查点CI。


T041原生实时/后台检查点已发布并核验CI：本机f6105216472fc7e75fb4171d277060f4e698f87e，远端beb1b6849fd0e2e68f7ba02c2673c28b677e97ba，同tree75a95f5785719447934e742758755b78ad0f1256。push37569743985和PR37569748050均success；两套check/Android job最终结果均已读取，push中的新源码生产构建、14迁移、加密备份与空目标恢复通过。这仅证明该检查点，后续联系人和聊天设置代码须另行验证。


## T041 联系人、角色与聊天信息继续开发（2026-10-07）

原生通讯录/预设角色广场接入真实角色API：名字与备注搜索、中文排序、分类/分页、资料、50字招呼、等待通过、30天恢复或重新认识，以及联系人→私聊入口。联系人仍含待通过项，不编造已建立会话。原生聊天信息接置顶/免打扰、秒回/拆条、备注/对我的称呼、清空、软删除和两次确认的永久删除；更新备注只提交两个字段，清空用显式null，不影响已有自定义头像字段。移除重复的UI后台调度钩子，发送恢复仍由Application统一安排。

两端共享同步处理增加HTTP清空确认的持久负覆盖，既不编造updateSeq也不推进日志游标；缓存正文及引用预览在落盘后消失，迟到历史和清空前启动的快照不能恢复它们。无正文的设置/删除响应等待服务器日志序号已保存到本机后才完成或退出页面；网页旧页面回调发起修改前核对owner，原生每次请求绑定owner。原生清空请求归应用级scope，页面消失不丢失已确认的本地提交。同步存储故障在生命周期边界报告并停止在线状态，不能让应用级任务因未捕获Room异常崩溃。

开发自测已完成：整仓49文件432条真实PG测试、格式/依赖边界/全仓类型/tokens通过；client-core4文件37条，19份原协议向量不变；用户端11组、后台7组真实浏览器全部通过；安卓70条JUnit零跳过、ktlint/detekt与debug APK通过，生成514定义/85操作/图标/tokens无差异。新增原生角色Compose两条、聊天信息Compose三条（清空取消/确认、二次确认永久删除与退出前持久同步、可访问置顶开关保存且保留正文）、实际Room/HTTP清空与换号/存储失败三条；两端迟到历史与较早快照清空保护各两条。网页新增真实HTTP清空确认→阻断更新日志请求→IndexedDB负覆盖/正文清除→刷新验证；永久删除确认交互与purge请求检查使用请求中断夹具，不能作为网页永久删除服务端整链路证明。原生仍是MockWebServer/Room，不冒充生产Node原生整链路。

证据：/tmp/weiban-t041-root-settings1.log、/tmp/weiban-t041-core-clear3.log、/tmp/weiban-t041-android-settings5.log及JUnit XML、/tmp/weiban-t041-web-settings1.log、/tmp/weiban-t041-admin-settings1.log、/tmp/weiban-t041-settings-generated.log。静态检查失败和新增测试构造参数编译失败的中间轮次不计通过；通过拆分模块/修正实际参数解决，未放宽阈值/断言。chat feature直接声明已有版本目录中的activity-compose 1.11.0，以支持系统返回，Gradle生成的该模块锁文件相应对齐既有应用使用的版本，许可证仍为AndroidX Apache-2.0。

这些是开发自测，不是独立QA；新检查点发布后须另读CI。

默认头像/私有头像设置、完整首次引导、联系人索引/自建角色与后续分期、原生推送和管理员通知跨站点击继续；仍不表示T041或整个产品完成，也不是独立QA。真机/WorkManager系统调度与厂商投递、无障碍和跨端时延需实机验证。


联系人/聊天信息与持久清空保护检查点已发布并核验：本机19f6167a0654cf8c64f1d0b7f25620a2c4442d74，远端df3546beec1554573c477deda82e8774371a3ef0，同tree a9c1800b2f25b3e18f51f582b2bdb9a4e0b1da1c。push37573530919与PR37573535193以及各自check/Android job均最终success、结果已读取；push CI的新源码生产构建、14迁移、加密备份/空目标恢复通过。后续头像代码是另一个尚未验证/发布的继续开发工作树，不能借用这些CI。


## T041 默认头像与私有图片显示检查点（2026-10-07）

两端使用相同名字取字、31倍UTF-16哈希/12色编号及应援色对比度规则；新增共享黄金样本，备注不参与取字/颜色。修正Kotlin令牌生成中JS整数键枚举导致10/11/12排在01之前的问题，保留原颜色与字号令牌。网页和安卓在会话列表、通讯录、角色广场和资料页接入默认头像/官方图片/个人私有图片优先级，图片加载中或失败保留默认绘制，圆角0.12、40以上显示图案、图片淡入。网页角色资料可实际裁剪上传contact_avatar、仅修改本人联系人头像、恢复官方或默认；资料页面账号切换时重建。原生角色及用户图片元数据/下载始终绑定同一owner，旧图片授权不能使用新账号令牌；旧角色图片及名称在换号时立即隐藏。

开发自测：整仓50文件451条真实PG测试，格式/lint/依赖边界/完整类型/tokens通过；client-core5文件56条（含19份原协议向量）；原生76条JUnit零跳过，完整ktlint/detekt/testDebugUnitTest/assembleDebug通过，514定义/85操作/图标/tokens检查通过；Web生产构建与12组、后台7组真实浏览器通过。新增浏览器验证实际contact_avatar上传/512像素裁剪/私有图片展示、阻断图片请求后回退、恢复默认，以及备注改变后默认字和颜色不变。原生新增默认头像黄金样本/实际生成调色板、旧owner图片下载零请求、Compose私有图片优先级及延迟元数据换号隔离；使用MockWebServer/Room，不冒充真实Node到原生整链路或像素级视觉验收。

证据：/tmp/weiban-t041-avatar-root1.log、/tmp/weiban-t041-avatar-core1.log、/tmp/weiban-t041-avatar-native-all2.log及JUnit XML、/tmp/weiban-t041-avatar-generated1.log、/tmp/weiban-t041-avatar-web-build1.log、/tmp/weiban-t041-avatar-web1.log、/tmp/weiban-t041-avatar-admin1.log。中途MatchingDeclarationName/LongMethod静态失败经重命名和拆分解决，没有放宽阈值。新源码CI须发布后另行读取，不能借用前一提交的成功。

待继续：原生联系人私有头像选择/裁剪/上传/恢复、聊天内头像及其余出现头像的场景、符合设计的拍照与手势裁剪、通知PNG、首次引导、原生推送与管理通知跨站点击，随后L2–L7。当前是开发自测，T041与产品尚未完成；真实设备/厂商推送/独立QA仍待验。


头像显示/网页私有编辑检查点已发布：本机f4dcf7e107d20fc3d1fac353202751e4099dc545，远端f22725ebbdbe7e75a40cbaa1157c8612919a1b4b，同tree cd62658092e77537561c869aa366a4a441f768a4。push37594560940、PR37594570076以及各自check/Android job均最终success、结果已读取；push新源码生产构建、14迁移、加密备份和空目标恢复通过。后续原生私有头像编辑属于新工作树，不借用上述CI。


## T041 原生联系人私有头像编辑（2026-10-07）

从角色资料进入设置头像，使用共用PhotoCropper选图、正方形裁剪、缩放/位置调整、上传contact_avatar及恢复默认。原有本人头像复用同一裁剪代码，已有真实图片几何测试仍验证同一实现；元数据写入只提交customAvatarMediaId，保留备注和称呼。所有图片上传和资料/联系人保存绑定打开裁剪器时的owner，换号即卸载旧裁剪状态。成功提示前等待联系人更新日志已持久保存到Room。

新增两条实际Compose/Room/MockWebServer测试：系统选图结果由Robolectric提供，之后执行真实512像素裁剪、multipart上传、头像字段PATCH、日志补拉/Room持久保存和恢复；第二条在打开裁剪窗口后切换账号，窗口/旧设置消失且无上传或PATCH。这是开发自测，不是真实系统相册/设备或Node服务端到原生整链路证明。共78条JUnit零跳过，完整原生静态检查/测试/APK构建通过；生成检查仍为514定义/85操作且图标/tokens无差异。Web/服务端源码本轮不变，其整仓451/core56/Web12+后台7以及f22725eb两套CI证据仍按上一检查点登记，不重复计为本轮新增验收。

构建依赖使用已有版本目录activity-compose1.11.0（AndroidX Apache-2.0）；共用设计模块新增直接声明，Gradle生成该模块及依赖它的auth模块锁文件，版本与应用/聊天原有1.11.0一致。证据/tmp/weiban-t041-avatar-edit-native3.log（生成锁）与/tmp/weiban-t041-avatar-edit-native4.log（正常锁定模式全部检查通过）及JUnit XML、/tmp/weiban-t041-avatar-edit-generated1.log、/tmp/weiban-t041-avatar-edit-format-root1.log。初轮运行目录错误、手动中断轮次和移动解码函数后的遗漏导入编译失败不计为通过，均已纠正；没有放宽阈值或删除原测试。

继续首次引导、聊天内头像/其余头像场景、拍照与手势裁剪、通知PNG、原生推送及管理员跨站点击；随后L2–L7。独立QA与真实设备/厂商验证仍待执行，产品未完成。
