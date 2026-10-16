# q-features 接续最小方案（根会话已核准）

基线核实：专用旧worktree `C:\wb-dev\wb-qfeat` / `q-features`，原WIP `dde11b683e398af03999d4b01797b70ec20343ec`。已合入当时local/trunk（55e4a48），两处冲突逐条保留A4内容上下文、A5昵称和旧用户状态读取，契约保留主线3.14。保护合并提交 `6b60f35`。已删旧status.ts的重复CharacterStatus/CharacterStatusEndpoints，角色仅复用A7 TimelineEndpoints.getStatus。全批准备统一3.15，不恢复旧3.9。

## 实际剩余

- support后端/0092与制作收费链已在主线；网页/后台未找到已接完整工单入口，须补帮助反馈/资料投诉/用户回复查看/后台处理，复用SupportEndpoints，不重建表。
- 用户状态已有未迁移表定义、服务/控制器与reply-context注入，但本地日末算法是24h相减，DST不正确；无网页状态编辑。角色聊天标题未复用A7组件。
- 表情商店只有旧契约；现有MediaAssetService仅返回userVisible内置包，没有商店安装关系、商店上下架/排序实现或完整页面。沿原素材库/个人表情扩展，不导入线上16张素材，不做打赏。
- 插件仅旧契约，没有真实服务与页面；只实现微信/QQ/微博coming_soon与统一/settings/plugins入口，不作外部登录/接入。
- 申请目前全量按配置200先独立冻结再进plaza事务，无免费次数；主线没有真实会员表/端口。需下述最小基础，不得把常量/前端字段当PRO+。

## 会员最小基础（已核准最小基础）

归identity新增memberships：user_id主键/FK同schema users级联，pro_plus_until、updated_at、granted_by（仅审计来源ID，不复制账号资料）。只有Free/PRO+两档：不存在或服务端Clock到期=Free；有效期内=PRO+，不靠定时任务过期。最小IdentityMembershipReadPort.getMembership(userId, tx?)跨模块取档位/有效期（支持调用方事务快照），plaza不得读identity表。identity HTTP给本人只读、管理员按userId查询/设置到期日（null清除），管理员审计并发profile_updated(membership)同步；已有管理员用户列表详情增一个真实授予/撤销表单，不做用户支付按钮、会员权益页、赠分、双钱包、迁移补偿或会员模型放行。将来C8可在同基础上扩展。

## 申请免费次数/收费

依据11 C4：免费每月5，PRO+每周5，仅申请制作。推荐固定北京时间日历月（每月1日00:00）/周一00:00起自然周，服务器Clock判定，响应明确periodStart/End/timeZone，避免切设备时区刷新额度；不是滚动30/7天。状态日末仍按本人资料时区，二者区分。

推荐成功提交申请才占一次免费次数：同一userId+clientRequestId重试返回原申请，不再占；格式/媒体/未完成上限/事务失败/积分不足不占。拒绝/撤回不返还免费次数（已实际占用制作受理/审核，避免反复撤回刷新5次）；仅收费申请的冻结积分在拒绝/撤回退回。此项及自然周期、升降档计数已获根会话批准，属于PM工程解释，提交页必须明示，不冒称总经理逐字裁定。

plaza.role_requests新增free_quota_applied布尔默认false（历史不追溯计数），索引userId/createdAt。当前周期内已成功免费申请统一计数，不因会员升降档重复发一份额度；会员升级看本周所有已用免费次数，降档看本月所有已用免费次数。旧申请原积分状态不变，付费申请不冒充免费次数。免费名额用尽后每次固定200积分（现有配置pointsCost仅兼容展示/管理，按新固定规则收口，不再允许后台误设其它价）。

复用现有pg_advisory_xact_lock按user串行：同事务再查clientRequestId/未完成上限/真实会员档位/周期免费次数→确定0或200→创建申请。为了收费与建申请原子一致，给既有BillingServiceFeePort.hold增加可选Tx，ServiceFeeService可在同一事务锁账户/冻结，避免先冻结再改判免费，也避免独立hold成功但进程崩溃留下孤儿冻结；不另造收费表/冻结服务。现有完成settle/拒绝撤回release及对账继续复用。

用户配置接口附真实额度/下次重置/本次价格；提交带expectedPointsCost（0或200）确认预览，服务器算价变化时拒绝并要求刷新确认，不能并发吃完免费名额后悄悄扣200。旧请求不带该字段若需收费则拒绝要求更新/确认，不以客户端值决定计费。

## 状态与商店、共享时间工具

用户状态沿identity.user_statuses，一人一条，用户行锁内设/清，Clock在锁后取，读取到期返回null；提取billing/domain/local-time纯日历/DST工具到平台共享工具并保留billing再导出，identity不反向依赖billing。明确不声称DST实测，仅源码/编译；状态静默读取进入现有动态结尾，不新增模型/任务或“安静状态每天1条”未实现承诺。

media.sticker_packs加旧契约的商店元数据（in_store、store_order、description/author/cover等按实际所需），新增media.user_sticker_packs(user_id,pack_id,sort_order,added_at)用户安装关系，包FK限同schema。内置userVisible包仍直接可用；商店包须已添加，详情/安装核enabled/inStore，已添加后下架可移除但不可新装，发送资格复用同一检查。已发消息快照继续可读，不物理删除媒体。排序校验归属/去重，用户关系参与注销清单。后台复用现有素材包CRUD，加元数据与商店排序，不另造素材库。

## 需要统一分配4条迁移

1. 会员最小基础（identity.memberships）。
2. 制作免费次数标记/查询索引（plaza.role_requests）。
3. 已有WIP用户状态表（identity.user_statuses）。
4. 商店元数据/用户安装关系（media）。

根会话已分配0097_memberships、0098_role_request_free_quota、0099_user_statuses、0100_sticker_store（各含down/journal）。support/插件/聊天标题不需新迁移。所有新增及配套端点统一契约3.15、必要安卓生成，不改安卓UI或构建，不写/跑测试套件。不SSH/部署/GitHub/自行合主线，不新增代理。完整前端实际组件GUI含失败控制，冻结涵盖所有Vite依赖与格式化；真实DB/收费/会员到期等与样例证据分开登记。

旧独立冻结兼容已获根会话批准：BillingServiceFeePort增加受限getByKey(userId,key,tx?)及同Tx release。用户advisory锁内先查已存在申请并返回；expectedPointsCost确认变化先拒绝，无退款等提交副作用；无申请才查本人旧hold，active+免费则同事务退旧hold并建免费单，active+收费复用原hold。released孤儿不改变幂等语义，拒绝旧请求编号并在UI明确要求换新编号重新确认，绝不自动无限重试；settled孤儿拒绝并提示管理员人工核对，不重收/不重开。新路径冻结与申请同事务回滚，避免再产生孤儿，失败同键可再试。

计价边界补充（根会话批准）：会员读取在取得用户共享锁并读会员行后取唯一Clock.checkedAt，quota以同一时刻返回quotedAt，申请createdAt/history也用quotedAt。按服务器开始受理时间计入自然周期，不取客户端时钟，也不在账户冻结等待后另换周期。

商店安装管理与发送列表分离：GET /me/sticker-packs返回本人安装记录（包括已停用、已下架），提供移除/排序入口；GET /stickers/packs仍只返回可发送启用包。已安装下架但启用的包可继续发送；停用不可发送，已发快照保留。
