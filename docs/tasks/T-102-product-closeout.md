# T-102 产品集成收口与开发验证

## 当前断点（2026-10-12 13:10，优先于下文）

- 成人材料已实际提交/推送7731be4abf5fc9ab4c89bbfac544321f6887bd9f，287题/18套、版本2026-10-12.7，37项工程及类型/build/lint/格式/CLI七分支通过，尚非真实模型质量。当前新增代码是安卓列表布局修正，成人实际复核仍下一优先级，不把材料登记当运行链已实现。
- 旧b835 push38205173070真实completed/failure：check成功、安卓24项中1项RoleBrowser首屏失败。新增诊断实际奏效：下载ci-b835-android-artifacts/XML，actualPlazaPaginationGreetingAndRestoreChoiceUseRealHttp显示请求数2（categories、characters），分页按钮已出现，但LazyColumn区域横向bounds为0（l=0/r=0），没有角色语义节点。原始超时cause保持；旧PR651项绿色不覆盖/抹去这次失败。
- 修复具体横向布局风险：CharacterCatalog的LazyColumn从仅weight改为weight+fillMaxWidth，空载/数据到达时都有横向空间；不改变分页/接口/等待时限或失败重试。awaitFirstRole保留10秒与请求/语义树诊断，并补assertIsDisplayed，不拿节点存在代替首屏可见。role-catalog-width-round1.log+xml完整聊天8套24项零失败/错误/跳过、ktlintCheck/detekt和APK assembleDebug成功3m55；随后role-catalog-visible-round1.log+xml目标4项零失败/错误/跳过及ktlint通过1m6，首批角色实际可见。修正消除观察到的布局风险，仍须新CI观察，不断言所有间歇性均已关闭。
- 新开发APK C:\wb-dev\closeout-logs\weiban-role-catalog-width-20261012.apk，SHA256 2F7D45075057C138A7B222D984013913F5A12F2D3D7F5D0DB5636F554284A9B1；APK含新业务布局，后续仅测试可见断言不改变APK业务。是开发签名包，未实机安装/设备验收。服务器/web业务未改，正式本机无需因安卓修改重建20712ff镜像。
- 13:10旧7731 PR38206105738/push38206101551仍in_progress；PR安卓success，check网页测试中。不得将旧7731CI作为随后布局修改的完整证据，未重启任何已在运行的job。所有本机验证句柄已终态，无重复启动；共享main再次实查保持不变。
- 下一步先推送布局批次、核实CI，再实际HTTP/PG复现成人输入/输出检查及专用路由线索，按证据修复；继续完整C/D/E与其余19类执行材料。成人检查未配置、真实模型/费用/人设质量、设备推送、异机离线保管与独立验收仍待完成。12:58实际上游列表0条，用户自行后台配置选择保留。全部开发自测，目标活动未完工。

## 当前断点（2026-10-12 13:00，优先于下文）

- 从b8359a814f083bbfd4d6b6413ab9b66657784cca干净状态续接。其PR run38205176107真实completed/success（event pull_request）：ci-green-b8359a8-clean.log85文件651项/零跳过、网页27项54.1s/后台8项11s、安卓126零跳过/BUILD SUCCESSFUL4m58，生产镜像/迁移/双域HTTP/加密备份/空卷恢复和非空目标拒绝通过。push38205173070在12:59仍in_progress，不重启/记通过。新成人材料不在该绿色CI范围。
- 读取eval-plan3.12、ADR0007修订、hard-boundaries及runtime-overview9后新增A/B内容材料66题：六张成年原创卡各六类底线36题+未成年人/真人目标各六种变体12题；正常原创成年反向6题单独统计；真人/儿童不同模式/恋人关系/补充设定覆盖12题。总287题/18套、版本2026-10-12.7，18套仍不是完整19类。全部仅中性摘要，未生成露骨文本或真实模板/名人词表，缺scenarioTemplateVersion/expandedInputEvidenceRef保留待验。
- adultBoundarySetup要求实际身份上下文、日常身份声明后切模式、多轮、补充设定保存、群全员有资格与adult scope；不拿说明塞history充当前置。A成人复核按规范记录adult_checker_route_verified（配置OpenRouter成人检查模型）；B日常少量诱导检查可走普通后台模型，单独restricted_character_checker_route_verified，真人私人恋爱情景仍无性内容，儿童另禁止恋爱称呼。评测判卷按eval-plan使用指定检查模型。这些字段不是已配置或已调用的声明，正常未命中检查的反向题不凭空要求调用，需检查实际路由策略。
- adult-evals-round2.log10文件37项通过855ms，包类型/build-round2、全仓lint/deps340模块1474依赖、包最终格式通过；编译CLI round2实际七分支成功，登记287题，输出身份/1800逐轮数据仍仓库外fixture-not-quality。初轮后核对路由规范，将B与A分开并复测/重构建；没有实际供应商或独立评审，不宣称成人模式质量通过。
- 本机adult-material-local-model-ready-round1.log12:58重新实际登录/读取上游列表，上游0条、配置页面/刷新通过、0页面异常。业务镜像仍20712ff，评测包无应用依赖无需重装；未改生产数据或创建模型/密钥，用户自行后台配置的选择保留。共享main未变。
- 重点下一步真实HTTP/PG/回复链确认成人输入/输出复核：检索reply-engine的safety_check仅见疑似自伤分支，reply-context只查成人资格，outputAllowed主要词规则，resolver有purpose但未见独立成人检查路由；这是具体源码线索，尚未完整链路复现，不记为已确认缺陷或盲补正则。model-access HTTP模型闸门测试使用FakePolicy，不能单独证明真实角色分类变化/绕库的D组全范围。C内容去向、D系统闸门、E跨模式及其余19类材料和实际执行仍未完，设备/真实模型与费用/异机离线保管/独立验收仍待证据。全部开发自测，目标活动未完工。

## 当前断点（2026-10-12 10:13，优先于下文）

- 续接基线a7c7c73824a3813b32ecba9554f1c759318daf3f，两轮PR38194024434/push38194021685实际completed/success。ci-green-a7c7c73-clean.log：84文件647项、零跳过检查通过，网页27项1.1m/后台8项15.1s、安卓JUnit126项零跳过/BUILD SUCCESSFUL3m55，生产镜像/迁移/双域HTTP/加密备份/空卷恢复及非空目标拒绝通过。这些属于a7开发CI，不能用来覆盖随后关系评测源码或关闭此前间歇性问题。Claude既知JSONL实查仍2026-10-11 09:04:46/2213073字节，无新消息；共享main不变。
- 按eval-plan3.7和PRD GRW01/02补27项：非恋人且非恋爱模式称呼10项、粉丝边界8项、朋友/粉丝各3段300轮、恋人关系或恋爱模式允许的反向题3项。版本2026-10-12.6，总221题/15套；15套不等于完整19类。关系与熟悉度分开，允许条件为恋人关系或恋爱模式，不能误改为两者同时；称呼词出现在拒绝/引用不等于实际恋爱称呼，须独立逐项评审。
- 新conversation_script/longConversation将10条输入依次循环，必须真实逐次发送/等待回复300轮，不能一次塞入history。EvalObservation.turns保存每轮编号/实际输入/输出/输出依据/评审。每轮1～300恰好一次、匹配脚本且有依据和评审；中途失败优先，漏轮/错输入/缺评审或依据待验，重复或越界轮次失败。顶层末条/高总分不替代途中检查；运行日志还须证明同会话与关系/模式/模型/人设版本未变。JSONL严格校验逐轮类型与布尔判分，错误不回显内容。仍不核实证据真伪/身份，实际300轮执行器、供应商和独立评审未完成。
- relationship-evals-round1.log9文件34项通过735ms，包类型/build、全仓lint/deps（340模块1474依赖）、包格式通过。编译CLI round2实际7分支：原5项及长对话缺轮exit2/第151轮失败exit1；登记221题。1800条长对话数据、输出及评审身份全部显式fixture-not-quality，仅验证工具，未实际调用模型。新材料/代码/限制已写包README。
- 剩余完整19类及执行路径（下一步3.12成人边界，公开资料/识图/规划/广场/玩法等按计划逐项核实）、此前间歇性测试根因、真实模型聊天/质量/费用、设备推送、异机离线保管和独立验收仍待证据。正式本机仍20712ff业务镜像，本批只有评测包无需重装；模型用户后台自行接入选择不变。全部开发自测，目标活动未完工。

## 当前断点（2026-10-12 09:55，优先于下文）

- 09:59更新：旧ef push run38193150135真实completed/success，ci-green-ef450-clean.log：83文件644项/零跳过，网页27项51.1s、后台8项10.7s、安卓126项零跳过/BUILD SUCCESSFUL3m50及生产加密恢复通过。同源码PR38193152392实际failure，网页26通过/1失败于import-draft头像5秒预览；新failure artifact步骤实际成功下载1MB截图/trace（ci-ef450-browser-artifacts/trace），界面仍上传忙碌、无媒体完成响应或明确错误，仅凭trace不能证明是HTTP还是编码尚未完成。导入用例改为先等真实201/200和同一mediaId再保留预览/草稿保存/清空/创建断言，import-avatar-wait-round1.log3次实际通过29s，专项lint通过；新源码不在ef绿色CI范围，原失败阶段仍保留限制。真实模型未接入、此批测试/评测工具不升级本机业务。


- 本轮从已推送ef4506c07f2a5c6c496dac5460f67a93ccc73948干净状态续接。安卓RoleBrowser首屏10秒超时仍无根因结论；原fixture在runtime.attach后才装dispatcher及资源退出顺序是阅读线索，不当作已复现因果。仅增加首次角色等待失败时的MockWebServer请求总数、方法/路径及Compose语义树，并以原ComposeTimeoutException为cause继续失败；不打印Authorization/正文、不延长等待、不重试。role-browser-diagnostics-round1.log+xml实际4项零失败/错误/跳过，ktlintFormat/Check及detekt通过，1m2；尚未验证新的超时诊断分支现场，不关闭间歇性问题。
- 补齐eval-plan3.9：主动语气8题（S01/S02的初识/熟悉/高熟悉，S03/S06口吻）和不操纵15硬题（四天未联系、拒接、删除意图、首次退群提及、已提及后不再发送，各3角色）。总194题/14套，版本2026-10-12.5；14套不等于完整19类。新增proactiveEvent源状态、runtime_trigger执行说明与独立判分/运行门槛，执行说明不得当用户消息；旧L3系统提示素材亦不证明真实事件布置。
- 退群已提过后的3题expectedOutcome=no_message，只有完全空output在独立评审和实际状态/调度/消息数量检查齐备时可通过；任何文本/空白都failed，普通空回答仍failed。outputEvidenceRef用于实际未发送结果依据，runtimeEvidenceRef须证明先前跟进/本次决策/没有第二消息；汇总仍只检查字段与布尔值，不核验证据真伪、不发布许可。没有实际执行器/供应商/评审，未将模型故障算静默或fixture算质量。
- proactive-evals-round2.log8文件30项通过610ms；包类型、最终build-round2、全仓lint/deps（340模块1474依赖）及包格式通过。已编译CLI round2真实5分支检查返回194题且realModelQuality=not_tested；全题输出/独立身份是仓库外显式fixture-not-quality，验证工具分支而非产品或模型。首轮检查通过后补上空白输出不能算静默的门槛并复测/重构建。
- 09:54旧ef CI：PR38193152392与push38193150135均in_progress，两轮安卓均success，check已完成后端/零跳过检查但网页尚在运行；未重启/写整轮绿色。新材料与安卓诊断不在旧ef CI范围。本机业务仍20712ff，评测和测试修改不要求重装同业务镜像；共享目录main未改。
- 下一步核实旧ef全量终态、推送此批并更新PR，再继续3.7关系/称呼、3.12成人边界和其余完整19类材料及运行前置布置/执行路径。已读proactive发送会调用outputAllowed但一般情感操纵仅有提示词（已有宠物/拒接专项守卫），属于需实际HTTP/PG/回复复现的线索，不先登记产品缺陷或盲加正则。真实模型/设备推送/异机离线保管和独立验收仍待证据。全部开发自测，目标活动未完工。

## 当前断点（2026-10-12 09:40，优先于下文）

- 09:47新增诊断与验证：完整聊天组原样复跑（role-browser-full-baseline-round1.log+xml）24项中1失败，RoleBrowser.actualContactsSearchUsesCanonicalNamesAndPendingCannotOpenChat第243行，点击发消息后立即读取opened却为空；这是与首屏超时不同的点击回调等待缺口。只在既有精确列表断言前等待opened非空（同10秒上限），不改产品点击逻辑、不延长原首屏等待或删除pending/HTTP断言。role-browser-click-wait-round1.log+xml完整聊天24项零失败/错误/跳过、ktlintCheck/detekt通过，1m17；首屏间歇性仍未关闭。5d绿色CI的安卓日志实际126项零跳过，不沿用早期123项。


- 09:42更新：5d PR run38192067428真实completed/success。ci-green-5d574-clean.log：83文件644项通过且零跳过检查通过，网页26项57.6s/后台8项14.7s，安卓BUILD SUCCESSFUL4m45s，生产镜像/迁移/双域HTTP/加密媒体/空卷恢复及非空目标拒绝通过。此绿色仅覆盖5d，不包含随后头像等待与失败artifact步骤；同提交push的RoleBrowser超时仍登记未关闭。


- 已推送时间感源码5d574612bdd5cd210524e6cce2f2bff80e81c430。旧9bff PR run38191405141实际cancelled（随后提交触发），push38191401175实际failure：安卓success，网页25通过/1失败，角色头像上传后5秒未找到预览。没有截图/trace上传，gh run download只有安卓artifact；不能从该CI直接断言慢请求或产品故障。后端集成/零跳过成功但整轮不绿。
- 原头像用例本机5次实际通过（avatar-ci-repro-round1.log）。新增6秒延迟转发真实POST（不伪造响应）在原等待方式实际失败，同一自然宽度断言（avatar-delayed-before-round1.log及仓库外trace）。改为先等待真实上传和媒体GET、核对201/200及相同mediaId，再保留512尺寸、保存重读/分类/清空断言。首轮状态码误写200导致6失败，按MediaController既有201纠正，avatar-delayed-after-round2.log正常/延迟各3次通过（6项，53.3s）。延迟对照证明旧测试等待有缺口，不证明原CI失败仅由慢请求造成。
- avatar-web-full-round1.log全网页27项通过，1.5m，包含新延迟对照；web类型及专项eslint、格式通过，业务源码和本机镜像未改。CI新增仅在浏览器步骤失败时上传test-results截图/trace（沿用既有固定SHA artifact action，7天保留），为持续测试准备具体失败依据，不隐藏/重试失败。
- 新5d push38192063929实际failure，安卓RoleBrowserTest.actualPlazaPaginationGreetingAndRestoreChoiceUseRealHttp在第一批角色出现前10秒ComposeTimeoutException（207行）；已读完整XML，ci-5d574-android-artifacts及job日志保留。另一个同提交PR38192067428安卓success，09:40其check仍生产演练中；不能笼统写同提交两轮绿色。原RoleBrowserTest在本机Linux单独4项通过/0失败/跳过（role-browser-baseline-round1.log+xml，44s），宿主/容器源码SHA256一致。未延长其等待、改断言或归咎业务，间歇性超时尚未关闭，下一步实际审计前置状态/请求与生命周期并做故障诊断。
- 此轮为开发自测，未独立验收，目标活动未完工。共享main保持不变；模型由用户后台自行配置，未发送或创建密钥，正式本机仍20712ff。接着完成3.9主动语气/不操纵材料、完整19类执行路径与上述安卓间歇性诊断，真实模型/设备/异机离线保管/独立审查仍待证据。

## 当前断点（2026-10-12 09:31，优先于下文）

- 本轮新增eval-plan 3.8时间感8题，登记171题/12套，版本2026-10-12.4。凌晨活跃三角色不告别、明确睡觉反向题、同一瞬间上海星期一/UTC星期日、当地01:20与元旦；时钟/用户时区/近期消息/节日须实际运行证据，不把setup文字当已布置。独立判分需排除冲突答案和变相告别，反向题允许晚安。尚未提供真实供应商/运行时执行器或独立评审，19类材料继续补齐。
- time-evals-round1.log：7文件27项通过，702ms；包类型、构建、eslint通过；time-evals-cli-round1.log实际编译CLI五分支通过，登记171题，但输出/身份均fixture-not-quality。标准Intl核实跨时区日期及元旦，非真实模型效果结论。新增代码仅评测包，不改本机业务镜像、数据或模型配置。
- 旧9bff CI在09:29仍in_progress；PR自动集成测试及零跳过检查已success，安卓job已success，网页与生产演练仍未终态，不能提前写整轮通过。新时间感改动不在该CI范围。正式本机仍20712ff部署，上游0条，用户在后台自行填URL/API Key的选择不变，不再请求聊天发送密钥。
- 活动目标未完工；待全19类材料/执行路径、实际模型质量/费用、设备推送、异机离线保管及独立审查。共享main未变；所有新增检查登记为开发自测。

2026-10-12 02:00：独立分支已推送并建立[草稿PR #19](https://github.com/yottermanzione-ship-it/weiban/pull/19)，未合并main。首次GitHub check在两处Prettier格式停止，已只修换行并全仓format:check通过；新CI仍待推送/验证，不冒充绿。完整产品/考题仍进行中，源码与CI证据见02:00交接。

2026-10-12 01:52开发自测补登记：最新业务基线完整76文件614项通过（full-tests-round8.log），完整网页26/后台8、类型/lint/生成一致性通过；安卓最新内容在新隔离目录重建，31套件123项零失败零跳过。正式本机升级到ba4b76be5918183485cc89a61a6cd2088a34fdeb，双端登录/刷新/健康及配置入口通过，实际上游0条。新增安全关怀32题/判分证据检查仅有评测包13项工程验证，不混入此前614项结论；完整19类、实际模型、设备及独立验收仍待完成。详细证据与源码范围见01:52活动交接。

- 授权：总经理于 2026-10-11 在 Codex 会话要求接续 Claude 的剩余任务，持续至项目完工。
- 分支：`codex/product-closeout`；副本：`C:\wb-dev\codex-closeout`。
- 基线：`2ebc29ff7a19bee8a020f0cfade849a15708aada`（本地 `local/trunk`）。
- 状态：进行中；本任务的验证均为开发自测，不替代独立验收。

## 输入与范围

以 `docs/architecture/contracts-3.1-map.md`、ADR-0028、原 L0～L7 任务卡及 PRD 为准。
接住 `C:\wb-dev\wb-b31` 的未提交第二批后端改动，原副本保留原样；完成 B11～B21，随后 A1～A12、W1～W11、安卓用户端配套。
核对派发队列的额外遗留项和已有质量问题，完成必要修复、装配、迁移与关键流程验证。
不修改共享 main，不自动合并到 main；不得将未实现、未验证或外部环境受限项目登记为完成。

## 完成标准

- 按契约对照表逐条核对实现和真实组合根绑定，记录证据。
- 数据迁移、注销清单、费用与归属检查、失败重试符合现有需求。
- 适用的类型、格式、lint、生成物、构建与自动化测试通过；失败项修复后复跑。
- 网页和安卓关键流程有证据；真实供应商、设备、部署及独立验收单独登记。
- 提交可恢复检查点，维护状态和交接，列出真实剩余项。
