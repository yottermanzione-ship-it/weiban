# 微伴当前进度

更新：2026-10-12 18:52。快速状态以本文为准，详细历史证据见 T-102、T-103 和活动交接。

| 项目 | 当前状态 |
|---|---|
| 本机运行 | http://localhost:8080 用户端；http://localhost:8081 管理后台；新版双端登录/刷新/健康通过 |
| 已部署业务 | f8d5673bde1f41e9e26bd99ef6f9bb9d5668ada9；部署源码2485bc1993064096ec6d27c4f2c961ecb661ecf2，含群聊安全转开及停止接话 |
| AI接入 | 18:51实际上游0条；后台URL/密码字段/价格/目录及成人内容检查复选框可用，用户自行填写 |
| 完整PR CI | 38217389396：check成功，87文件665项、网页27/后台8及生产加密恢复通过；安卓失败 |
| 同源push CI | 38217385274：安卓成功；网页头像主题颜色失败（26通过/1失败），并非全轮通过 |
| Windows全量 | 87文件665项中664通过/1失败；推送回执2002ms超2000ms目标2ms，未放宽目标 |
| 当前开发 | 群聊f8两轮完整CI成功且本机升级/实查通过；安卓目录快照2485bc1已推送，新CI待终态，完整聊天25项和APK通过 |

全部为开发自测；项目尚未完成，不等同于独立验收。

## 可恢复断点

- 副本 C:\wb-dev\codex-closeout，分支 codex/product-closeout。续接基线cb285ed36c082218a22832a39f0a7d46fce1f65a。新群聊业务尚未部署；共享main未修改。最新提交SHA通过git及PR19确认，不能把旧CI当新提交完整通过。
- 首次设置/替换检查默认模型发布事务内 adult_checker_configured 事件，真实事件分发入队恢复任务；同一等待回复计划保留ID并递增retryEpoch。缺配置不发送未经检查内容。专用复核删除safetyPriority，不能继承关怀透支；原白名单保留。最新665项CI覆盖正确空capabilities夹具和新断言。
- 本机镜像 app sha256:1debba53f08f4d89795679396fee28711e8243e86ebe9b4738b50e15e678c5c0；edge sha256:bd3b11eb5de19fcf0425b9ea848a447b87aa079acb76fb3de174e388bc0410c7。版本记录 C:\wb-local\deployment-version.txt；旧a5另存deployment-history/pre-group-deflection-20261012.json。升级前加密备份20261012-184759-5ee1cb8c44444773af1e62b0a5495bae。
- 升级证据 adult-checker-local-upgrade-round1.log、adult-checker-local-login-round1.log、adult-checker-local-config-round1.log，位于 C:\wb-dev\closeout-logs。原账号、卷、密钥保留；未创建模型/供应商、未调用真实AI。
- Windows完整回归已终态1447.32s，失败是回执耗时断言，非未收到回执；同断言被waitFor重复等待至超时。Linux CI同用例通过；仍保留本机失败，不算满足全部时延验收。
- 安卓PR失败XML证实列表宽320/高78、有下一页按钮且请求2条，但无角色子节点，先前补宽不能算全部关闭。另有旧19c联系人打开超时；两类原因仍待验证。当前cleanup修正只是消除代码中确定的关闭顺序/协程生命周期风险，不提前归因为全部超时根因。
- role-fixture-lifetime-round1 因缺空行ktlint失败，未执行测试。round2真实终态成功2m4；fresh XML 4项零失败/错误/跳过，30.54s。网页profile-theme-persist-round1实际1项通过7.2s/整轮1.6m，仍核对精确颜色/64px尺寸/圆角。两句柄均已结束，不复用。
- role-fixture-lifetime-full-round1实际BUILD SUCCESSFUL 2m9，完整聊天8套24项零失败/错误/跳过，ktlint/detekt通过；fresh XML已复制到同名-xml目录。不是全安卓126项或真机验证。句柄57744已结束。
- 推送诊断改动不放宽2000ms或取消厂商HTTP/重复发送断言，只将已落库且不会变化的回执时延移出waitFor，避免固定数值失败被伪装成等待超时。push-latency-diagnostic-round1实际5项通过20.22s；直接读取本条回执为1975ms，仅剩25ms余量，保留此前2002ms失败和时延稳定性待验，不能凭这次通过关闭。服务端类型及改动eslint/格式通过。句柄34967已结束。
- cb285ed PR38234744815完整success：87文件665项、网页27/后台8及生产恢复通过，安卓BUILD SUCCESSFUL4m9。日志ci-cb285ed-pr-full.log。同源push38234740229 check成功但安卓首角色等待再次失败，24项中23通过；日志ci-cb285ed-push-failed.log。清理修正未彻底解决首屏问题，不关闭或用PR绿色覆盖失败；新XML待读。
- 新群聊专项：实际HTTP创建2个合格角色的群、切成人/日常模式、发送消息、真实事件分发入队，再显式运行真实GroupChatService处理器；没有替换policy/聊天写入/角色发布/加密，没有宣称pg-boss自动消费。网关、成人模型可用性及发布评测受控，不是真实供应商效果。
- 首轮新角色夹具误用响应头像结构，被契约拒绝，14项均未执行（adult-group-boundaries-round1）；改复用合法创建输入后14项通过68.47s。最初只验证不发未检查内容，随后按eval-plan3.12 A1补安全转开要求，before专项实际1失败/13因过滤未执行：群角色消息0，证实沉默不满足回复要求。
- GroupChatService仅在成人content_rejected时使用角色安全转开文本（先以普通输出规则校验，无效则固定安全回复），发送一条后终止接话链；检查不可用仍不发未检查内容，普通/正常成年生成不统一拒绝。输出复核最多重生成一次沿用共用边界入口。after14项通过；最终regression-round1成人16项+关怀8项共24通过110.62s，含普通chat路由、成年adult路由、输出两次生成/两次检查后单条安全转开。类型、全仓lint/依赖341模块1486依赖通过，无契约/API变动。
- f8d5673bde1f41e9e26bd99ef6f9bb9d5668ada9的PR38236906027与push38236901408均实际completed/success。PR完整日志ci-f8d5673-pr-full.log：87文件670项、网页27/后台8、安卓BUILD SUCCESSFUL3m52及生产镜像/迁移/加密恢复通过；不覆盖随后安卓目录快照修改，不关闭旧cb失败。
- cb失败XML已下载到ci-cb285ed-android-artifacts：仍是请求2条、下一页可见、列表宽320/高78且无首角色，支持继续查响应到达后的列表更新，但不能据此唯一归因。
- 新750ms延迟目录响应用例保持原10秒和assertIsDisplayed，无点击/滚动才显示。首轮ktlint链调用格式失败、未执行测试；修正后的before-round2在原业务代码上1项通过1m8，因此未复现CI，不能宣称确定根因。保存对应XML。
- 目录列表内容与分页按钮改为在组合时读取同一catalog响应，避免列表构建时再次读取可变holder；仅是降低不同步风险的结构调整，不宣称原数据观察机制必然错误或间歇性已修复。role-catalog-snapshot-full-round1实际BUILD SUCCESSFUL2m50，ktlint/detekt及assembleDebug通过；fresh XML8套25项零失败/错误/跳过。
- 开发APK C:\wb-dev\closeout-logs\weiban-catalog-response-20261012.apk，SHA256 3A7EFCBC33A9D84C0E49084D61EDB99992E322200E94BD368DF1B1C02BFFDA3C。含目录快照和最新生成资源，未真机安装或证明全部安卓功能验收。
- 2485bc1993064096ec6d27c4f2c961ecb661ecf2已提交/推送安卓修改。push38238552326实际completed/success；PR38238558450实际completed/failure，check成功，安卓失败为actualContactsSearchUsesCanonicalNamesAndPendingCannotOpenChat第281行等待打开回调，25项中24通过，目录首屏/新增延迟用例均通过。日志ci-2485bc1-pr-full.log、ci-2485bc1-android-failed.log及ci-2485bc1-android-artifacts/XML已下载。不能把本次联系人失败误记为目录失败或把两类一起关闭。
- group-deflection-pre-upgrade-backup-round1、local-upgrade-round1、local-login-round1、local-config-round1、local-binary-round1均终态成功：真实双端健康/登录/刷新与配置页无异常，18:51实际上游0条；容器dist/main.js含本次唯一新增stopChain逻辑，结合真实HTTP专项和完整f8 CI确认新代码送达。没有生产注入测试角色或模型、没有实际模型调用。原账号、数据卷、密钥保留。
- 无存活数据库/Gradle/部署句柄。下一步联系人点击失败补点击前/后bounds和语义树诊断，再用实际证据定位。CharacterAction对已有conversationId直接调用onOpen，没有异步等待或loaded禁用；资料、熟悉度内容异步插入导致点击期间布局变化只是待证实线索，不能先断言根因。补主动/成人通话及群检查故障恢复，再推进完整材料/执行路径。群故障后的自动恢复尚未验证。安卓新结构调整不证明全部间歇性根因已确定，不反复重跑无变化全量。

仍待完成：上述回归失败定位；群聊/主动/成人通话专项；完整19类AI材料、执行器与真实模型质量/费用；安卓真机及厂商推送；异机离线密钥保管；另一位审查者独立验收。现有287题/18套和模拟判分不证明这些事项完成。
