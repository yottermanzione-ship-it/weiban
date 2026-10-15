# A9 最小改号、模型榜与充值方案（已核准）

根会话已批准按本最小方案实施，迁移0096、契约3.14。

当前账号 `identity.users.id` 是不可变业务/会话归属；`users.username` 既是原登录名又被CurrentUser显示为微伴号。登录经AccountService.findUserByUsername，密码、会话、恢复和业务数据都按userId。不直接覆盖原username。

建议仅一条迁移（根会话已分配0096）：users加currentAlias nullable、aliasChangedAt nullable；新增identity.login_aliases（lowercase alias主键、userId FK级联、createdAt），回填所有既有username。注册在同事务保留初始登录名；改号在user行锁内检查7×24小时、申请新alias唯一占用，历史alias永久归该user以保旧账号登录且不允许被他人抢走。本人复用旧alias仍受每周限制，完全未变则幂等不耗次数；唯一约束处理跨用户并发。全部按现有Username字符规则/大小写不敏感，不可改userId/密码/session。

新增GET/PATCH /me/alias返回当前别名、nextChangeAt；PATCH只收username（别名）。CurrentUser.username仍为可用于登录的名称，输出currentAlias??原username，旧客户端无新必填字段；原数据库username不变。登录先解析别名/原名到同一用户，限频使用该用户原username对应的旧账户限频键，防历史alias绕开账户限频；原用户名仍兼容。当前用户/重新登录/恢复/管理员目录均输出同一当前别名，管理员原名或历史名检索仍能定位同userId。注销级联清alias，管理员审计记录变更及原userId，不改业务关联。

模型：既有modelCatalog.leaderboardRank为管理员排序，继续复用；公开单一排行榜，不加角色扮演/成人筛选。来源说明放现有model_access.settings的leaderboard_source键（标签、官方https URL、更新日期），新增小型读/管理员写接口及现有后台配置入口，无需迁移。热门数统计已有selections.chatModelKey的当前选用人数（每user一行，排除平台默认null），诚实标注“当前全局聊天模型选择”，不当调用量/实时Arena排名。可并列后台配置榜/热门榜，普通选择仍只chat，不造新模型路由。

充值：现有支付恒false，只有联系管理员，没有用户支付/订单写入口。新增只读POST /billing/recharge-quote，body金额为整数分（500~1,000,000，5~10,000元），服务器验证精度/上下限并按既有MICROS_PER_POINT/POINTS_PER_YUAN换算返回金额/积分/管理员联系说明，不创建订单、不写积分、不接真实支付。客户端金额最多两位小数，报价成功只展示联系管理员，不称支付成功；新增方案无赠分。

参考核对（2026-10-15）：Arena官方文本榜 https://arena.ai/leaderboard/chat/text ，本项目排序由管理员配置，不抓取全榜或伪称自动同步。Apple官方Safari说明 https://support.apple.com/en-gb/guide/iphone/iph42ab2f3a7/ios ：页面菜单→Share→向下滚动→Add to Home Screen；找不到时Edit Actions，部分布局直接Share。引导按总经理“···→分享→下滑→更多/编辑操作→添加到主屏幕”配原生SVG示意，明确示意，不冒充系统截图/真机验收。

计划统一升契约3.14，模型榜/报价复用已有存储无需迁移。全局生态/档位/积分冻结、我的状态与会员留后续q/统一后端，不在本批伪接。
