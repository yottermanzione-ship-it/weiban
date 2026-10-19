# 全站逐路由浏览器覆盖（进行中）

从 `apps/web/src/app/app.tsx` 的 path 属性提取，共 104 个路由项。记录当前分支的开发自测，不代表独立验收。截图和具体操作见 coverage.md；当前没有任何“全页验收通过”结论。

2026-10-19 接续说明：下面逐项表为早期快照，后续分批记录补充它，不应用早期“未点按”推算最新总数。最新有证据的变化见 [阻塞修复与手势记录](blocking-bugs-1019.md)：会话三角色实际可见；长按、左滑、气泡六项、复制提示、双击拍一拍已复点；全局惯性与动画仍未完全核验。作品详情发布检查失败、真实通话缺条件，继续保留待核。

| 路由 | 当前证据 |
|---|---|
| `/` | 已完成账号登录；欢迎/登录页已看 |
| `/me` | 已打开；底栏切换已点 |
| `/profile` | 未点按；源码/原批注待逐页核对 |
| `/settings` | 已打开；子页入口已点，开关未改 |
| `/services` | 未点按；源码/原批注待逐页核对 |
| `/wallet` | 未点按；源码/原批注待逐页核对 |
| `/wallet/recharge` | 未点按；源码/原批注待逐页核对 |
| `/ledger` | 未点按；源码/原批注待逐页核对 |
| `/prices` | 未点按；源码/原批注待逐页核对 |
| `/models` | 未点按；源码/原批注待逐页核对 |
| `/leaderboard` | 未点按；源码/原批注待逐页核对 |
| `/usage` | 未点按；源码/原批注待逐页核对 |
| `/characters/custom/new` | 未点按；源码/原批注待逐页核对 |
| `/characters/custom/:characterId/edit` | 未点按；源码/原批注待逐页核对 |
| `/settings/security` | 已点修改密码提示、下线确认并取消；外层DIV且无嵌套按钮；连续两次reload正常 |
| `/settings/privacy` | 未点按；源码/原批注待逐页核对 |
| `/settings/general` | 10-19 实点深色/特大字号，在320px复看；已恢复跟随系统/标准 |
| `/services/proactive` | 未点按；源码/原批注待逐页核对 |
| `/services/ecology` | 已点总开关展开/收起、滚动；模型行禁用且示例文案可见；动作开关标签待补 |
| `/services/period` | 已看首次隐私说明/开始记录入口及导航；未开启/写入健康数据 |
| `/services/period/day/:date` | 未点按；源码/原批注待逐页核对 |
| `/services/period/history` | 未点按；源码/原批注待逐页核对 |
| `/services/period/authorization` | 未点按；源码/原批注待逐页核对 |
| `/services/period/settings` | 未点按；源码/原批注待逐页核对 |
| `/chat` | 已看空态及3角色好友会话/未读；无AI气泡长按证据 |
| `/chat/:conversationId` | 程澈会话已看；内置/商店/个人3类表情切换可见；未发消息/验证角色回复；Bai路由暂停提示可见 |
| `/chat/:conversationId/settings` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/memories` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/timeline` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/moments` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/relations` | 未点按；源码/原批注待逐页核对 |
| `/contacts/new` | 未点按；源码/原批注待逐页核对 |
| `/contacts/groups` | 未点按；源码/原批注待逐页核对 |
| `/groups/new` | 10-19 实际选择程澈/温言并创建三人预览群，设置内改名；添加苏乔后取消；没有发送消息或验证 AI 群聊 |
| `/chat/:conversationId/group` | 未点按；源码/原批注待逐页核对 |
| `/moments` | 已看空态；相机菜单/取消、换封面面板/退出；修复后700ms长按直接发表 |
| `/moments/new` | 已点输入计数、公开/部分可见、无好友禁发表、有内容取消确认/继续编辑/不保留、空内容取消；未发表 |
| `/moments/notifications` | 未点按；源码/原批注待逐页核对 |
| `/moments/posts/:postId` | 10-19 样例详情已打开；通栏/赞评论操作条，实际点赞、点评论回复、长按自己的评论并取消；深色特大字号已看 |
| `/me/moments` | 10-19 有样例动态，实际从列表点进动态详情；早期空态不再代表当前数据 |
| `/characters/:characterId/anniversaries` | 未点按；源码/原批注待逐页核对 |
| `/sticker-store` | 已看空态/真实包；补封面和数量，已添加状态正常；整理入口已点 |
| `/sticker-store/:packId` | 已看3张表情；点开大图/Esc退出、免费添加成功变为移除；未移除 |
| `/support` | 已看加载→空列表 |
| `/support/new` | 已看；空值禁用、输入后启用；未提交 |
| `/support/tickets/:ticketId` | 10-19 实际打开已有预览工单并提交补充，忙态/时间/正文可见；support-detail-reply-verified-1019.png |
| `/me/status` | 已点自定义空值/输入/保存/清除；开发自测 |
| `/settings/plugins` | 未点按；源码/原批注待逐页核对 |
| `/me/stickers` | 已看3张；预览打开/关闭、整理选择/移到最前/完成；一次DB超时500重试恢复；未删除 |
| `/me/favorites` | 10-19 有数据复看通栏来源/正文；取消收藏确认→取消，未删除；favorites-fullwidth-refined-1019.png |
| `/me/favorites/:favoriteId` | 未点按；源码/原批注待逐页核对 |
| `/services/cards` | 10-19 实见3角色/1张卡；进程澈卡册，胶囊关闭正常回小程序首页 |
| `/services/achievements` | 10-19 1/34 有数据复看、打开详情；修 Esc 后实际关闭；320px 三列白卡/8px 间距，未横向撑出宫格 |
| `/services/familiarity` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/cards` | 10-19 实见1张团子瞬间卡；长标题单行、好感度解锁文案已改；实际开卡/翻面/Esc关闭 |
| `/search` | 从chat进入、输入、取消回chat，重复两轮未出现返回循环 |
| `/search/:conversationId` | 未点按；源码/原批注待逐页核对 |
| `/chat/:conversationId/search` | 未点按；源码/原批注待逐页核对 |
| `/share` | 10-19 实际从团子卡进入；修切消息模板导致空正文，卡片入口仅支持卡片风并解释；本机素材经同源代理后卡面完整/缺图提示消失；未保存相册/系统分享 |
| `/imports` | 未点按；源码/原批注待逐页核对 |
| `/imports/new` | 未点按；源码/原批注待逐页核对 |
| `/imports/:jobId` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/supplement` | 未点按；源码/原批注待逐页核对 |
| `/settings/delete-account` | 未点按；源码/原批注待逐页核对 |
| `/services/pets` | 10-19 已看在养团子，有数据阶段标签收窄；点击进入详情。早期空态记录保留，不再当当前限制 |
| `/pets/adopt` | 已看好友选择/名称输入/未选好友禁提交；返回正常；素材初载未等完，未领养 |
| `/pets/:petId` | 10-19 已看团子主页/成长记录/空相册/设置，320px实滚到底部；喂食反馈与亲密值0→1；未上传/送养 |
| `/play/daily` | 已看题目/好友选择；输入计数/按钮启用、换好友清旧输入/加载、回答按钮整行；未提交 |
| `/play/daily/history` | 已看历史空态；返回每日一问正常；补初次加载提示 |
| `/play/wishlists` | 已看3好友心愿入口；进入程澈/返回正常 |
| `/play/wishlists/:characterId` | 10-19 实际新增预览心愿、编辑保存、再次打开 Esc 关闭；添加未提交文字后取消；没有完成/删除/设日期 |
| `/play/letters` | 10-19 实际选人、查看草稿列表并重开恢复；一次连接超时重试后恢复，未寄出 |
| `/play/letters/new` | 10-19 实际输入三段62字，取消→继续写保留→保存草稿→重开恢复；修读取前禁用和保存忙态；未寄出 |
| `/play/letters/:letterId` | 未点按；源码/原批注待逐页核对 |
| `/play/focus` | 10-19 320px深色特大字号实点选择角色/开始25分钟样例/计时/提前结束确认/取消/最终结束；样例已结束，未等自然结束或验证AI鼓励 |
| `/play/reminders` | 10-19 实际空列表→新建→选喝水/程澈/自定义星期，空星期禁保存、选周五启用，返回仍空；未保存/触发提醒；320px七天与右侧开关已复看 |
| `/play/reminders/:reminderId` | 未点按；源码/原批注待逐页核对 |
| `/plaza/works/:workId` | 未点按；源码/原批注待逐页核对 |
| `/plaza/authors/:authorId` | 未点按；源码/原批注待逐页核对 |
| `/plaza/me` | 未点按；源码/原批注待逐页核对 |
| `/plaza/profile` | 未点按；源码/原批注待逐页核对 |
| `/plaza/publish` | 未点按；源码/原批注待逐页核对 |
| `/plaza/report` | 未点按；源码/原批注待逐页核对 |
| `/characters/:characterId/voice` | 未点按；源码/原批注待逐页核对 |
| `/calls/:callId` | 未点按；源码/原批注待逐页核对 |
| `/coming-soon/:feature` | 未点按；源码/原批注待逐页核对 |
| `/miniapps` | 已看；图标长按→菜单→Esc退出；搜索→清除已点 |
| `/discover/plaza` | 未点按；源码/原批注待逐页核对 |
| `/contacts/add` | 已看推荐加载与滚动；角色资料入口已点 |
| `/plaza` | 未点按；源码/原批注待逐页核对 |
| `/plaza/official/:characterId` | 10-19 程澈有数据正文/评论已看，实际提交两行预览评论，320px 回复输入后取消；错误重试仅源码核对 |
| `/roles/create` | 未点按；源码/原批注待逐页核对 |
| `/role-requests` | 未点按；源码/原批注待逐页核对 |
| `/role-requests/new` | 未点按；源码/原批注待逐页核对 |
| `/role-requests/:requestId` | 未点按；源码/原批注待逐页核对 |
| `/pets/with/:characterId` | 10-19 按程澈实际进入，最终替换到团子详情；没宠物时的领养分支本轮未再核 |
| `/characters/:characterId/model` | 未点按；源码/原批注待逐页核对 |
| `/settings/about` | 未点按；源码/原批注待逐页核对 |
| `/settings/announcements` | 未点按；源码/原批注待逐页核对 |
| `/settings/release-notes` | 未点按；源码/原批注待逐页核对 |
| `/contacts` | 已打开；搜索输入/清除已点 |
| `/discover` | 已打开；底栏切换已点 |
| `/characters/:characterId` | 已看程澈资料；申请弹层打开/取消；其他角色待核 |
| `*` | 未点按；源码/原批注待逐页核对 |

## 2026-10-19 批量打开（46 条，390×844 全页截图）

本轮用本机 Edge（Playwright，390×844、2x、触屏模拟）登录后逐条打开，截图在
`C:/wb-dev/logs/ui-routes-1019/`（未入库）。**打开 ≠ 验收**：手势、长按、滚动惯性仍未复点。

| 分组 | 已打开 | 结论 |
|---|---|---|
| 我 / 服务 / 钱包 | `/profile` `/services` `/wallet` `/wallet/recharge` `/ledger` `/prices` `/models` `/leaderboard` `/usage` | 布局正常；余额与档位要等接口（跨境隧道约 3–9 秒），不是布局问题 |
| 设置 | `/settings/privacy` `/settings/general` `/settings/plugins` `/settings/about` `/services/proactive` | 插件页原本整页空白，已改为固定列出微信/QQ/微博三行 |
| 角色子页 | `/characters/:id/memories` `/timeline` `/moments` `/relations` `/voice` `/cards` `/model` `/supplement` `/anniversaries` | 全部改成共用 NavBar；记忆/聊天信息深链接不再误报「不存在」 |
| 创建与申请 | `/characters/custom/new` `/roles/create` `/role-requests` `/role-requests/new` | 创建页「角色分类」三个选项原本挤成一行互相压字，补 fieldset/radio 样式后恢复 |
| 群与通讯录 | `/contacts/new` `/contacts/groups` `/groups/new` | 正常 |
| 小程序 | `/services/cards` `/services/achievements` `/services/familiarity` `/services/period/*` `/imports` `/pets/adopt` | 卡册/成就/熟悉度/周期/导入原本没有标题栏，已统一 |
| 朋友圈与广场 | `/moments/notifications` `/plaza` `/plaza/me` `/plaza/profile` `/plaza/publish` | 广场页 tab、搜索、筛选正常；`plaza/me`、`plaza/profile`、`timeline` 三条接口在本机环境偶发 500（连接池超时），非页面问题 |
| 玩法 | `/play/letters` `/play/letters/new` `/play/reminders` | 正常 |
| 其他 | `/chat/:id/search` `/coming-soon/:feature` | 正常 |

上述“仍未打开”是当时批次的历史快照，后续实际操作以上方逐路由条目及 visual-pass-1019.md 为准。该批次尚未打开：`/plaza/works/:workId`、`/plaza/authors/:authorId`、`/plaza/report`、`/plaza/official/:characterId`、
`/characters/:id/supplement` 的提交态、`/settings/delete-account`、`/share`、`/calls/:callId`、`/pets/:petId`、`/pets/with/:characterId`、`/moments/posts/:postId`、`/support/tickets/:id`、`/me/favorites/:id`、`/search/:conversationId`。
