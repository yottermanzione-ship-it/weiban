# q-features 接续交接（开发自查与真实环境验证边界）

> 2026-10-16主会话追加：浏览器连接已恢复，已完成实际组件点按、失败重试、长按和窄屏滚动，证据见 docs/web/q-features-2026-10-16/browser-check.md。初次浏览器阻塞已解除；真实API/PG/迁移/资金实测仍未执行。以下首次保护记录中的浏览器阻塞不再代表当前进度。

专用worktree：C:\wb-dev\wb-qfeat；分支q-features。原WIP dde11b683e398af03999d4b01797b70ec20343ec，经6b60f35合当时local/trunk 55e4a48。开发小块保护：bc785dc（会员/状态基础）、f9e23bf（申请额度与原子冻结）、5352429（商店/插件）、6cb11a8（网页/后台接线）、a37017d3662ed85ca655d0d821f6c2f6b3915952（旧键阻止重复提交与安装管理说明）。最终保护SHA以交接消息为准。

**此批为开发自查，不是独立验收：源码、编译和浏览器组件样例已有记录；真实API、PG及资金行为未执行。** 初次子代理交接仅在独立q分支开发，没有合主线、改共享main、SSH、部署、GitHub操作或额外代理，没有写/跑测试套件；后续合入以主会话状态登记为准。

## 已落实的源码

- 保留主线A4内容快照上下文、A5昵称规则、A7零模型TimelineEndpoints.getStatus、A9 alias/0096/SettingsService媒体注入。删除旧重复同URL异响应CharacterStatusEndpoints，统一契约3.15。
- identity最小真实会员来源：memberships有效期，服务端Clock判Free/PRO+，本人读取与管理员按不可变userId授予/撤销，用户锁、管理员审计与profile_updated(membership)。后台账号详情按userId key隔离草稿。此处没有支付、完整权益、赠分、会员模型放行或双钱包。
- 申请制作：Free北京时间自然月5次、PRO+周一开始自然周5次，成功提交占免费次数，拒绝/撤回不返次数，付费固定200冻结→完成扣→拒绝/撤回退。周期/计数与升降档规则为根会话批准的PM工程解释，非总经理逐字裁定；表单明示。
- 唯一checkedAt/quotedAt用于档位到期、周期报价、createdAt/history；按服务器受理时间计入周期，账户锁等待后不再换时刻。免费标志历史默认false、不追溯。expectedPointsCost防免费竞态后暗扣200；变价保输入并再次确认。
- 原用户advisory锁内先返回既有申请；BillingServiceFeePort增加可选同Tx hold/release及验证账户归属getByKey，建单/新冻结原子提交，移除旧catch无条件release风险。同键并发不释放成功单冻结。旧active孤儿按当前免费/收费同Tx释放或复用；released孤儿明确更换新编号后重新确认，不自动重试或改旧hold幂等；settled或金额异常需管理员人工核对且阻止继续提交。同一免费/收费确认失败不提交退款等副作用。
- 用户状态：一条当前状态、预设/20字补充、有效期/清除、真实接口；用户行锁串行，读取过期null。纯日历工具移至platform/time，billing兼容再导出，identity不反向依赖billing。UI首次回填与dirty保护，失败保草稿、expiresAt定时及focus/visibility恢复核对。状态只自然进入既有私聊动态结尾，没有新增模型或主动任务。
- 聊天标题复用A7 CharacterStatus，通过ChatHeading挂原Name链，active私聊才读，群不显示个人心情；保持typing和本地偏好。实际整chat尚未浏览器验证，样例仅标题独立组件。
- 商店：0100元数据inStore/storeOrder/intro/coverStickerId与本人安装关系；免费添加/移除/顺序和后台元数据/封面归属校验、审计，发送检查沿原素材服务。发送列表只启用包，另GET /me/sticker-packs管理已停用/下架安装记录；下架但启用的已安装包可继续用，停用不可发送但可管理。聊天面板订阅stickers变化刷新包与个人表情，+进入商店。个人表情CRUD与已发快照不变；没有线上导入旧16素材或物理删除素材。
- support复用既有0092/服务/API：设置红点入口、用户反馈/投诉/截图上传、列表/详情/补充，角色资料与广场作品投诉入口，后台回复/解决/重开。详情按ticketId key和itemId事件更新，不覆盖补充草稿。截图上传复用support_image，没有新存储或二次制作收费。
- 插件：服务端真实三项coming_soon，网页统一/settings/plugins，设置和服务入口可达，点击提示；没有外部渠道登录或接通。
- App ownHeader同步覆盖/sticker-store、/support、/me/status、/settings/plugins，避免新页NavBar与全局顶栏重复；此项仅源码核对。

## 已执行的开发检查

- server typecheck：会员基础、申请原子性、商店/插件块分别通过；server build通过。
- contracts typecheck通过；3.15 generate通过（406端点），安卓契约配套生成1377 named definitions；未做安卓UI/构建。
- web多轮typecheck通过（最终源码收尾检查亦退出0），生产build完整通过，构建号414630，含SW injectManifest 16 precache entries。
- admin typecheck、build通过；client-core typecheck通过。
- 所有本批相关TS/TSX eslint通过，lint:deps通过（386模块/1673依赖，无边界违规）。git diff --check通过。没有运行测试套件。
- web/admin生产构建都有既有大chunk提示，web SW工具有inlineDynamicImports废弃提示；构建退出0，不把提示当运行验收。

## 数据迁移与部署边界

0097_memberships、0098_role_request_free_quota、0099_user_statuses、0100_sticker_store的up/down及journal按97→98→99→100登记。全部未执行真实PG迁移。部署到有数据库的环境时先备份并按正式流程迁移；本地Git合入不执行数据库变更。旧0092工单与0096登录别名不覆盖、不重建。

## 初次浏览器阻塞与可恢复入口（阻塞已解除）

主会话实际尝试IAB创建（含真实5190入口）均notavailable；Codex打开为queued。故没有首屏目视、实际点按/长按/滑动、截图或组件交互通过结论。仅用HTTP读取Vite静态HTML/JS模块200，不等于业务HTTP或浏览器执行成功。

原4个apps/web/q-preview*临时文件保留未跟踪，5190开发服务当前保留（不能保证会话/电脑重启后仍运行，可依步骤重启）；文本快照、恢复脚本、入口与逐项GUI步骤在docs/web/q-features-2026-10-16/README.md。此目录不伪造截图。包括预置失败/申请报价场景和外置模拟请求记录。网页按生产完整CSS（含common-fixes）、后台按自身CSS加载；全局常量与相对client别名已配。样例未挂完整Auth/App/ChatProvider，申请成功页明确为样例回执，不能当真实详情验证；截图上传未mock不在样例验证范围。浏览器恢复后先确认首屏和console，再按清单操作。按主会话许可仅清理过时契约summary/端口注释及README版本并重新生成，未改UI语义或fixture；之后源与样例重新冻结直至主会话解除。生产构建在这次纯说明收口前完成，按主会话要求不重复整包构建，最终契约生成另行执行。

## 未执行与后续范围

真实HTTP鉴权/数据库读写、0097~0100迁移/回滚、PRO+到期与并发授予、周期跨界/升降档与并发计数、冻结/扣款/退款/进程崩溃恢复/旧孤儿、媒体真实上传/授权/清理、后台审计落库、多端实时同步/通知、模型实际上下文、Safari/触摸/长列表均未执行。源码核查不能替代这些实测。

全局积分上限冻结、平台承担场景、统一模型档位/角色生态总开关、完整会员付费权益与已确认迁移补偿、小V/搜索候选引擎等后续批次仍未完成，不能以此q批次冒称完成。赠分已否决，不实施。插件外部接入、通话域名/密钥、声音克隆、安卓仍遵循原暂停边界。
