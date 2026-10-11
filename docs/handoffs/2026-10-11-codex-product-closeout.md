# Codex 产品收口活动断点

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
