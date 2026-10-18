# 搜索一致性覆盖矩阵（2026-10-18，源码已核，GUI待核）

基线59037fb7772a1b96c9fbf1954e7eee0714f06664，断点59abfb2、业务WIP41bd314。**9个SearchField调用点、7个调用文件**全部阅读；只修共用容器/CSS与3个真实提交表单，不重做整站。CUA本轮getState仍`apps:[]/browsers:[]`，下表是待点按清单，未登记任何GUI通过。

| 当前入口 | 实际组件/位置 | 本轮修改与理由 | 待GUI步骤 |
| --- | --- | --- | --- |
| 会话列表搜索入口 /chat → /search | conversation-list.tsx的Link.search-entry | 保留Link及原shell样式，不能随输入组件CSS清理误伤导航 | 轻点进入；Tab可达；返回不循环 |
| 全局搜索 /search | search.tsx GlobalSearchPage | 复用SearchField；旧label包input/范围/清除三个控件不合法，现div；保留autoFocus、inputRef、已有范围/清除后聚焦与返回 | 320/390px宽输入长字，范围和清除不压输入；点图标/空白聚焦；范围/清除/取消及Tab焦点；清空无旧结果 |
| 单聊/群聊记录 /chat/:id/search | search.tsx ChatSearchPage | 共用容器/CSS生效，原NavBar/back与发送者/日期筛选保持 | 从聊天信息进，输入/Enter/取消/返回；群发送者筛选不误操作 |
| 通讯录本地筛选 | contacts.tsx ContactsPage | 输入实时筛选不需提交，保持现状；共用组件获得新语义/CSS | 输入、清空、进入角色后返回保行为 |
| 添加朋友/新手角色列表 | contacts.tsx RolePlazaPage | 已有可见submit；实际原setSearch(query)未trim，现trim；清空恢复推荐并重置分页 | 空白按钮禁用；带空格名字搜索；清空恢复推荐；Enter与点击一致，旧分页不残留 |
| 新建/邀请群聊成员 | groups.tsx CharacterSelect | 纯客户端filter，无表单提交需求，保持；共用容器/CSS生效 | 输入、点选择、清空、取消已选项不触发输入聚焦 |
| 转发最近/通讯录接收目标 | chat-forward.tsx picker | 纯本地filter，原冻结目标/幂等逻辑不改；共用容器/CSS生效 | 两tab输入、清空、选目标；不会把按钮点击当空白聚焦 |
| 小程序独立列表 | miniapps.tsx MiniAppsHomePage | 本地filter保持；与下拉二楼宫格区分，未给二楼重新加搜索 | 输入筛选、清空回列表、整理按钮不受影响 |
| 官方微伴角色广场 | role-plaza.tsx OfficialList | 原只有输入；补可见submit/空白禁用，沿原trim端点参数，清空恢复全量 | 点击搜索、Enter、空白禁用、长placeholder不挤按钮，清空保留排序/分类 |
| 自定义角色广场 | plaza.tsx PlazaTab | 实际也只有输入，纠正“已有submit”旧声明；补同款按钮，沿原trim，清空恢复全量 | 与官方同宽搜索操作；切tab/筛选/清空后列表正常 |
| G3.5陪你专注 | play.tsx FocusPage、FocusCapsule /play/focus | 原图“被我专注UI.png”是时长chips/事项/开始按钮，无搜索；现源码结构相同，不强塞SearchField，未动其布局 | 原图与当前专注表单/胶囊的间距、滚动、按钮样式仍需浏览器目视；不记G3.5已解决 |

## CSS实际叠加与收口

生产main.tsx先导tokens/styles/media/l6/l6b/plaza/play，再shell/old-ui/chat-old/pages-old/ecology，App模块再导common-fixes。旧SearchField同时匹配l6的.search-entry、shell的.search-entry/label限定、pages-old的label.wx-search-box/input、末尾common-fixes的label限定。改变容器标签若只改JSX会漏掉限定规则。

现输入组件专用几何、颜色、placeholder、输入focus、范围/清除/取消统一在common-fixes的`.search-entry.wx-search-box`及其子选择器。删除pages-old对应重复块与shell仅输入/label规则；shell保留搜索strip和会话列表Link基础样式，l6 legacy规则不扩做重构。沿既有surface/page主题配色，36px高度、无边框圆角，未新增主题/费率/视觉体系；16px全局输入防Safari缩放规则保留，不重复添加。

容器为div，不再将两个button放进label；input的aria-label/placeholder兜底与props保留。内部ref经useImperativeHandle转接inputRef；点容器空白/搜索图标显式聚焦，已有input和按钮/链接等交互目标不被截获。没有给静态容器加多余Tab位；键盘仍走input和真实按钮。

清除点击区从18px扩大到36px，图标保持12px；范围按钮36px高并限制最大宽度/省略，保留完整aria名称；取消和提交至少44px宽/36px高、无压缩。默认button focus-visible仍有品牌焦点，输入键盘焦点采用底线，不恢复旧图整框绿色边。实际CSS计算/触摸/Safari都尚未验证，不能用样式声明代替视觉证据。

## 提交与恢复全量的边界

官方/自定义原onSubmit本来trim，本轮补按钮；添加朋友补trim。三个按钮仅禁用空白提交，Enter仍沿既有form处理；onChange检测清空/纯空格会恢复空search，添加朋友同时清游标/旧分页，避免用户因按钮禁用回不了全量。没有改API、候选引擎、列表授权/会员/计费或旧模型入口待核分支。
