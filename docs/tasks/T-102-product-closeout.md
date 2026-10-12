# T-102 产品集成收口与开发验证

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
