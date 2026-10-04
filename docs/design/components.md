# 微伴组件规范

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-006（v1.0）、T-012（v2.0） |
| 版本 | v2.0 |
| 日期 | 2026-10-04 |

> v2.0 变更（T-012）：规范同时适用于网页和安卓 Compose（第 0 节新增两端实现规则）；气泡改为小圆角 + 小尖角、头像圆角变小（更像参照产品）；删除密钥输入框、供应商密钥卡（原 6.7 后半、13.1）；系统横条改为「模型服务不可用」「余额不足」等变体；删除成人模式消息不可多选、会话摘要「[消息]」、年龄确认弹窗；群聊也显示情景模式；新增 3.6 MenuCell、第 16 节「服务与计费」组件、第 17 节「聊天信息页」组件、9.6 成就徽章按 28 枚定稿。

## 0. 使用规则

1. **所有页面只能由本文件里的组件拼成**；需要新组件时，先向设计负责人提出，加进本文件后再用。页面里不允许写本文件以外的样式。
2. 数值一律用令牌。本文写令牌名时省略 `theme.<主题>.<模式>` 和 `semantic.<模式>` 前缀，例如 `bubble.selfBg` 对应 CSS 变量 `--wb-color-bubble-self-bg`、Kotlin `WbThemeColors.bubbleSelfBg`。**组件里不写任何主题判断**：换主题只是换了令牌的值，组件代码不变。
3. 动效编号（M-xx）见 `motion.md`；页面如何组合这些组件见 `pages/`。
4. 每个组件写明：用途、结构、尺寸与令牌、状态、交互、对应需求。
5. 组件名用英文（网页组件和 Compose 函数用同一个名字，如网页 `<ConversationItem>`、安卓 `@Composable fun ConversationItem()`），中文名给人看。

### 0.1 两端实现规则（网页 + 安卓 Compose）

本文每个组件的规格**两端都要满足**；下表是同一规格在两端的对应写法，组件里不再重复。

| 规格写法 | 网页 | 安卓 Compose |
|---|---|---|
| 尺寸 px | CSS px | dp（`WbSpace` / `WbSize` / `WbRadius`） |
| 字号 | CSS 变量（已乘字体缩放） | sp × 应用字体缩放（`tokens-android.md` 3.6） |
| 0.5px 分隔线 | `0.5px solid border.hairline` | `HorizontalDivider(thickness = Dp.Hairline)`（一个物理像素） |
| 按下态 | 叠加 `bg.pressed` 层 | 自定义 `Indication` 叠加 `bgPressed`，**关闭水波纹** |
| 阴影 `shadow.sm/md/lg` | box-shadow | `Modifier.shadow(WbElevation.Sm/Md/Lg)`，只用于浮层 |
| 底部弹层 | 自绘（M-03） | `ModalBottomSheet`，换上令牌颜色和顶部圆角 `radius.lg` |
| 对话框 | 自绘（M-04） | `Dialog` + 自绘内容（不用 M3 默认 AlertDialog 样式） |
| 开关 | 自绘 Switch（6.2） | 自绘或改色的 `Switch`，尺寸和颜色按 6.2 |
| 长列表 | 虚拟滚动，行高固定或预先可算 | `LazyColumn`，每项给稳定 `key` 和 `contentType`；消息高度预先可算 |
| 动画 | transform / opacity（`motion.md`） | `graphicsLayer` 的位移 / 缩放 / 旋转 / 透明度（`motion.md` 第 6 节） |
| 安全区 | `env(safe-area-inset-*)` | `WindowInsets`（`systemBars`、`ime`） |
| 图标 | Phosphor SVG | 同一套 SVG 转 Vector Drawable |

通用状态的统一表现（各组件不再重复）：

| 状态 | 表现 |
|---|---|
| 按下 | 叠加 `bg.pressed` 遮罩，瞬间出现，松手 `duration.instant` 淡出（只改遮罩透明度）；安卓同样不用水波纹 |
| 禁用 | 整体透明度 `opacity.disabled`，不响应点击 |
| 加载中 | 内容替换为 16px 转圈（M-09 的转圈），保持原尺寸 |
| 键盘焦点 | 2px `border.focus` 外描边（电脑浏览器用键盘操作时） |

---

## 1. 导航与框架

### 1.1 NavBar 导航栏

- **结构**：左：返回按钮（‹ 图标 + 未读总数，如「‹ 3」，与参照产品一致；一级页面无返回）；中：标题（`fontSize.headline`、`fontWeight.semibold`），可有第二行副标题（`fontSize.caption1`）；右：最多 2 个图标按钮。
- **尺寸**：高 `size.navBar` + 顶部安全区；背景 `bg.navBar` 实色（**不用毛玻璃**，motion.md R4）；底部无分隔线，内容滚动后出现 0.5px `border.hairline`（瞬间切换）。
- **副标题**（只在私聊 / 群聊）：优先级 正在输入 > 情景模式标识 > 无。两者叠放在同一位置用透明度切换（M-08），标题区高度不变。
- **标题对齐**：两端都居中（与参照产品一致；安卓不用 M3 默认的左对齐标题栏）。
- **交互**：点返回 = 返回上一页；双击标题栏 = 消息列表滚动到顶部（会话列表、聊天页）。

### 1.2 TabBar 底部标签栏

- **结构**：4 个等宽标签：**微伴**、通讯录、发现、我。每个 = 图标（24px，未选中线性 / 选中填充）+ 文字（`fontSize.caption2`）。
- **颜色**：未选中 `text.primary`，选中 `brand.primary`（跟随主题：默认主题为绿，微伴粉主题为粉）。
- **角标**：「微伴」标签显示所有非免打扰会话的未读总数（Badge 数字型）；通讯录有「新的朋友」时红点；发现有朋友圈新动态时红点；**「我」标签只在余额低于 P-32 时显示红点**（SVC-01 第 5 条；新卡片、新成就不在「我」标签显示红点）。
- **尺寸**：高 `size.tabBar` + 底部安全区；背景 `bg.tabBar`；顶部 0.5px `border.hairline`。
- **交互**：点击切换（无动画，瞬间切换，与参照产品一致）；在当前标签再点一次 = 滚动到顶部；消息标签双击 = 跳到下一个有未读的会话。
- **≥ 900px 宽屏**：变为左侧竖排图标栏（宽 64px），见 `02-interaction-flows.md` 第 6 节。

### 1.3 PageFrame 页面骨架

- 规定所有页面的安全区处理：顶部 `env(safe-area-inset-top)` 由 NavBar 吃掉；底部 `env(safe-area-inset-bottom)` 由 TabBar / InputBar / 底部按钮区吃掉；左右在横屏时由内容区内边距吃掉。
- 页面左右边距 `space.5`（16px）。分组列表的组间距 `space.3`（8px，与参照产品一致）。
- 背景：一级页面和设置类页面 `bg.page`；聊天页 `bg.chat`。

### 1.4 SearchBar 搜索框

- **结构**：放大镜图标 + 占位文字「搜索」，居中显示；聚焦后图标和占位文字移到左侧，右侧出现「取消」。
- **尺寸**：高 36px，圆角 `radius.sm`，背景 `bg.surface`（在 `bg.page` 上）。
- **交互**：会话列表顶部的搜索框点击后推入全局搜索页（CHAT-12）；通讯录、广场内的搜索框就地过滤。

---

## 2. 头像

### 2.1 Avatar 头像

- 规则全文见 `default-avatar.md`（显示优先级：用户上传 > 管理员上传 > 默认头像；默认头像如何生成）。
- **尺寸**：`size.avatar.xs`～`xxl`；圆角 = 边长 × `radius.avatarRatio`。
- **状态**：图片加载中显示默认头像；加载失败保持默认头像；角色已退出 / 已删除时透明度 `opacity.muted`。
- **交互**（聊天页中）：点击 → 角色资料页；双击 → 拍一拍（M-10）；群聊中长按 → 输入框插入「@名字 」。
- **附加角标**：右上角可叠加 Badge（未读数或红点），偏移 -4px。

### 2.2 GroupAvatar 群头像

- 九宫格规则见 `default-avatar.md` 第 5 节。尺寸与 Avatar 一致。

---

## 3. 列表

### 3.1 ListCell 通用列表行（设置、资料页信息行）

- **结构**：左（可选）：图标 24px 或头像 32px；中：标题（`fontSize.body`）+ 可选说明（`fontSize.footnote`，`text.secondary`）；右：值文字（`text.secondary`）/ 开关 / 箭头 › / 角标。
- **尺寸**：最小高 `size.settingRow`；左右内边距 `space.5`；行之间 0.5px `border.hairline`，左侧从文字起始处开始（不贯穿图标）。
- **变体**：
  - 导航型（带 ›）：点击推入下一页。
  - 开关型（带 Switch）：点击整行 = 切换开关。
  - 选择型（带 ✓）：单选列表，选中项右侧 ✓（`brand.primary`）。
  - 危险型：标题居中，`text.danger`（如「删除角色」「清空聊天记录」）。
  - 居中动作型：标题居中，左侧可带 20 图标，颜色 `text.link`（资料页「发消息」「语音通话」「添加到通讯录」）或 `text.primary`（设置页「退出登录」），与参照产品资料页底部样式一致。
- **分组**：多行放在一个 `bg.surface` 块中，组与组之间 `space.3` 间隔；组上方可有分组标题（`fontSize.footnote`，`text.secondary`）、组下方可有说明文字。

### 3.2 ConversationItem 会话行（CHAT-01）

- **结构**：
  ```
  [头像48] 名字（或备注）                 时间
           [摘要：最后一条消息]       [免打扰图标]
  ```
  - 名字：`fontSize.body`、`fontWeight.medium`，单行省略。
  - 摘要：`fontSize.subhead`、`text.secondary`，单行省略。前缀规则：群聊中「名字：」；有人 @ 我时红色前缀「[有人@我]」；有草稿时红色前缀「[草稿]」；被撤回显示「XX 撤回了一条消息」；图片「[图片]」、语音「[语音]」、表情包「[动画表情]」、链接「[链接] 标题」、名片「[名片] 角色名」、通话「[语音通话]」。（v2.0 删除「成人模式消息显示『[消息]』」：内容隔离已取消，SAFE-07 删除。）
  - 时间：`fontSize.caption1`、`text.tertiary`；今天显示「14:05」，昨天「昨天」，一周内「星期三」，更早「9/28」，跨年「2025/9/28」。
  - 未读：头像右上角 Badge 数字；免打扰会话改为灰色小点（`badge.muted`），摘要前加「[3 条]」，右下角显示免打扰图标（铃铛划线）。
- **尺寸**：高 `size.listRow`；头像左边距 `space.5`，头像与文字间距 `space.4`；分隔线从文字起始处开始。
- **状态**：普通 / 置顶（底色 `bg.surfacePinned`）/ 按下 / 左滑打开。
- **交互**：点击进入会话；左滑（M-16）露出「标为未读」（灰色）「删除」（红色）；长按弹出 ActionSheet：置顶 / 取消置顶、标为未读、消息免打扰、删除该聊天。删除该聊天的确认说明（ActionSheet 标题）：「只从列表中移除，聊天记录会保留；TA 再发消息时会重新出现」（CHAT-01 第 2 条：删除会话只删入口，不删角色和记录）。

### 3.3 ContactItem 通讯录行（CHR-05）

- **结构**：头像 40 + 名字（备注优先，`fontSize.body`）。可选右侧小字：「新」（新添加 24 小时内）。
- **尺寸**：高 `size.contactRow`。
- **分组**：按名字首字母（汉字取拼音首字母，备注优先）分组，分组标题 `fontSize.footnote`、`text.secondary`、背景 `bg.page`，滚动时吸顶。
- **字母索引条**：右侧竖排 A–Z 和 #，`fontSize.caption2`；按住滑动时中央显示当前字母的大号浮层（56px 圆角方块，`bg.elevated` + `shadow.md`），列表跳转到对应分组。
- **顶部固定行**：「新的朋友」（图标：带 + 的人形，`brand.primary` 底）、「群聊」（图标：两个气泡）。

### 3.4 SwipeActions 左滑操作

- 按钮宽 72px，全高；文字 `fontSize.body`、白色；颜色：中性 `tint.gray`、警告 `status.warning`、危险 `status.danger`。
- 同一时刻只有一行处于打开状态；滚动列表或点其他地方自动关闭。动画见 M-16。

### 3.5 SectionHeader 分组标题

- `fontSize.footnote`、`text.secondary`；上 `space.5` 下 `space.3`；左边距 `space.5`。

### 3.6 MenuCell 带彩色图标的菜单行（「我」页、设置首页）

- 参照产品「我」页的列表样式：ListCell 导航型 + 左侧 `size.listIcon`（24）线性图标，图标颜色取 `tint.*` 或 `brand.primary`（各行颜色在页面说明里指定）；标题 `fontSize.body`；右侧可带值文字、Badge 红点、›。
- 行高 `size.settingRow`；分隔线从标题起始处开始。
- 分组之间 `space.3` 间隔（`bg.page` 色）。
- 红点位置：标题右侧 `space.2` 处（「服务」行余额不足时），或 › 左侧。

---

## 4. 消息（聊天页）

### 4.1 MessageRow 消息行（所有消息类型的外框）

- **布局**（与参照产品一致：每条消息都带头像）：
  - 角色消息：左侧头像 40 → 间距 `space.3` → 气泡；
  - 自己的消息：气泡 → 间距 `space.3` → 右侧头像 40；
  - 行与行垂直间距 `space.5`（16px）；页面左右边距 `space.4`（12px）。
- **气泡**：最大宽度 = 消息区宽度 × `size.bubbleMaxWidthRatio`；内边距 上下 `space.3`（8px）+ 1px，左右 `space.4`（12px）；圆角 `radius.bubble`（6px）；**靠近头像一侧有一个小尖角**：宽 `size.bubbleTail`（6）、高 12 的三角，尖角中心距气泡顶 20px（与 40px 头像中线对齐），颜色同气泡。尖角是静态图形（网页用伪元素，安卓用 `GenericShape` 把尖角并进气泡外形），不参与动画、不影响气泡高度。表情包、图片、纯 emoji 没有尖角。
- **颜色**：角色 `bubble.otherBg` / `bubble.otherText`；自己 `bubble.selfBg` / `bubble.selfText`。
- **文字**：`fontSize.body`、`lineHeight.normal`；网址、电话自动识别为链接（`text.link`）。
- **群聊**：角色头像上方显示发送者名字（`fontSize.caption1`、`text.secondary`），气泡下移 `space.1`。
- **高度稳定**（虚拟滚动要求）：除「转文字」「展开全文」这类用户主动操作外，一条消息渲染后高度不再变化。发送状态、已读标记都放在气泡**侧面**，不占额外高度。
- **长按**：弹出 LongPressMenu（6.8），选中的气泡叠加遮罩（M-05）。
- **出现动画**：M-07，只用于实时新到的消息。

### 4.2 消息类型

| 类型 | 组件名 | 规格 | 交互 | 需求 |
|---|---|---|---|---|
| 文字 | `TextBubble` | 见 4.1。角色「打错字更正」就是一条以「*」开头的普通文字气泡，不做特殊样式 | 长按菜单：复制、收藏、引用、多选、删除（自己的另有「撤回」，限 P-23 内） | CHAT-02、CHAT-08 |
| 纯 emoji | `EmojiOnly` | 1–3 个 emoji 且无其他文字时：不显示气泡底，字号 `fontSize.emojiOnly` | 同文字 | MED-01 |
| 表情包 | `StickerMessage` | 无气泡底；长边最大 120px，按原图比例；动图自动播放，离开屏幕暂停 | 长按另有「添加到表情」 | MED-01 |
| 图片 | `ImageMessage` | 无气泡底，圆角 `radius.sm`；长边最大 `size.imageMessageMax`，短边最小 80px（超出比例的居中裁切）；**用接口给出的宽高先占位**，加载中显示 `bg.skeleton` 色块，加载完成淡入 | 点击 → 全屏图片查看；长按另有「保存图片」 | MED-02、MED-04 |
| 语音 | `VoiceMessage` | 气泡宽度 = 80px + 每秒 4px，最大不超过气泡最大宽度；内容：声波图标（颜色 = 所在气泡的文字色）+ 时长「12″」（`fontSize.subhead`）；角色的未播放语音在气泡外侧显示 8px 红点 | 点击播放 / 暂停，播放时声波三段透明度轮流变化；连续多条角色语音自动连播（MED-03）；长按另有「转文字」：在气泡**下方**出现一个 `bubble.otherBg` 的转写块（这是用户主动操作，允许改变高度） | MED-03 |
| 链接卡片 | `LinkCard` | 固定宽 240px，气泡底色同发送方；上：标题（`fontSize.callout`，最多 2 行）；下：摘要或来源（`fontSize.caption1`、`text.secondary`），右侧 48px 方形封面（有则显示）；底部一行来源（如「网易云音乐」） | 点击 → 能识别的音乐 / 视频平台尝试唤起 App，否则浏览器打开 | MED-05 |
| 名片 | `ContactCard` | 固定宽 240px，`bubble.otherBg`；上：头像 40 + 角色名（`fontSize.body`）+ 一句话简介（`fontSize.caption1`）；分隔线；下：「角色名片」（`fontSize.caption2`、`text.tertiary`） | 点击 → 该角色资料页（未添加态，底部「添加」「不感兴趣」） | CHR-04 |
| 通话记录 | `CallRecord` | 气泡样式；内容：电话图标 + 文字：「通话时长 05:23」/「已取消」/「对方已拒绝」/「未接来电」（`text.danger`）/「XX 给你打过电话」（iPhone） | 点击 → 回拨（发起语音通话） | MED-06、MED-07 |
| 带快捷按钮的消息 | `QuickReplyMessage` | 普通角色文字气泡 + 气泡下方一行按钮（Button sm，最多 2 个，间距 `space.3`）；按钮区高度随消息一起固定。目前只用于「以后可以给你打电话吗？」 | 每个按钮只能点一次；点后按钮区替换为灰字「你选择了：可以」（`fontSize.caption1`、`text.tertiary`，高度不变） | MED-07 |
| 引用 | `QuoteBlock` | 跟在被回复消息的气泡**下方**，与气泡左（或右）对齐，间距 `space.2`；背景 `bubble.quoteBg`，圆角 `radius.xs`，内边距 `space.2` `space.3`；内容「名字：被引用内容」（`fontSize.caption1`、`bubble.quoteText`），最多 2 行省略；被引用的是图片时显示 32px 缩略图 | 点击 → 滚动定位到原消息并闪一下（原消息叠加遮罩 opacity 0→1→0） | CHAT-02 |

### 4.3 发送状态（CHAT-03）

| 状态 | 表现（显示在自己气泡的**左侧**，垂直底部对齐） |
|---|---|
| 发送中 | 超过 1 秒仍未送达才显示 16px 转圈（M-09），避免一闪而过 |
| 已送达 | 不显示任何标记（与参照产品一致） |
| 已读（仅私聊） | 「已读」小字（`fontSize.caption2`、`text.tertiary`）。只在**最近一条**已读的自己消息旁显示，更早的不重复显示，减少干扰 |
| 发送失败 | 20px 红色圆形感叹号（`status.danger`），M-09 弹出；点击 → ActionSheet「重新发送 / 删除」 |
| 待发送（断网） | 同「发送中」转圈；顶部有网络横条（7.4）；联网后自动按顺序发出 |

### 4.4 会话内提示（灰色小字）

所有会话内提示共用一个组件 `SystemTip`：居中，`fontSize.caption1`，`text.tertiary`，最大宽度 80%，背景 `bubble.quoteBg` 的胶囊（`radius.xs`，内边距 `space.1` `space.3`）；上下间距 `space.5`。可以包含一个可点击片段（`text.link`）。

| 用途 | 文案示例 | 可点击 | 需求 |
|---|---|---|---|
| 时间分隔 | 「14:05」「昨天 23:10」「星期三 09:12」 | — | 与参照产品一致：同一会话中距上一条消息超过 5 分钟才插入；**时间分隔不加胶囊背景** |
| 添加通过 | 「XX 通过了你的好友申请，现在可以开始聊天了」 | — | CHR-03 |
| 撤回 | 「你撤回了一条消息 重新编辑」/「XX 撤回了一条消息」 | 「重新编辑」（仅自己的、文字消息、2 分钟内） | CHAT-02、CHAT-08 |
| 拍一拍 | 「你拍了拍 XX」/「XX 拍了拍你」 | — | CHAT-02 |
| 情景模式切换 | 「已切换到傲娇模式」 | — | MODE-02 |
| 熟悉度升级 | 「你和 XX 的熟悉度升到了 L3 熟络」+ 下一行「获得熟悉度卡 No.003 ›」 | 「获得熟悉度卡」→ 卡片详情 | GRW-03、GRW-05 |
| 获得卡片 | 「获得纪念卡 · 认识第 100 天 ›」 | → 卡片详情 | GRW-05 |
| 群邀请 | 「XX 邀请你和 YY、ZZ 加入了群聊」 | 名字 → 资料页 | SOC-06 |
| 群成员变动 | 「你将 XX 移出了群聊」「XX 退出了群聊」 | — | SOC-03、CHR-06 |
| 删除说明 | 本地删除消息后不留提示（与参照产品一致） | — | CHAT-02 |
| 模式下架 | 「「温柔」模式已下架，已回到日常模式」 | — | MODE-04 |
| 群聊模式失效 | 「XX 加入后，群聊已回到日常模式」 | — | SOC-03 第 4 条 |
| 模型下架 | 「原模型已停止提供，已改用 XX，TA 的说话风格可能有变化」（每次下架只出现一次） | — | MDL-04 |
| 通话因余额结束 | 「余额不足，通话已结束」 | 「查看余额」→ 余额页 | MDL-10 第 5 条 |
| 等待通过 | 「已发送好友申请」 | — | CHR-03 |

**禁止**：在会话内插入 AI 身份提示、安全关怀官方文案、广告式提示（SAFE-06、G12）。

### 4.5 TypingIndicator 正在输入（CHAT-06）

- 位置：NavBar 副标题，**不在消息列表里**（与参照产品一致，也避免列表高度变化）。
- 文案：私聊「对方正在输入…」；群聊「XX 正在输入…」/「XX 等 2 人正在输入…」。
- 动效：M-08。模型故障重试期间不显示（MDL-04）。

### 4.6 群聊 @ 提及（SOC-04）

- 气泡中「@名字」显示为 `text.link` 颜色；@我 的消息在会话列表摘要前显示「[有人@我]」。
- 输入框输入「@」→ 底部弹层列出群成员（头像 + 名字），点选后插入「@名字 」。

---

## 5. 输入

### 5.1 InputBar 输入栏（CHAT-02）

- **结构**（从左到右）：语音 / 键盘切换按钮（28px 图标）→ 输入框（或「按住 说话」按钮）→ 表情按钮（28px）→「+」按钮（28px）；输入框有内容时「+」变为「发送」按钮（Button 小号、主色）。
- **尺寸**：最小高 `size.inputBarMin`；背景 `bg.inputBar`；顶部 0.5px `border.hairline`；底部吃掉安全区。输入框背景 `bg.inputField`，圆角 `radius.sm`，最小高 40px，`fontSize.body`。
- **多行**：输入框随内容增高，最多 5 行，之后内部滚动。输入栏增高时消息列表底部内边距同步增加（这是布局变化，但只发生在用户打字换行时，不做动画）。
- **状态**：
  - 角色无法回复（模型服务不可用、余额不足）：输入栏照常可用（用户消息照常送达，MDL-04、MDL-10）。
  - 群聊被移出 / 群已解散：输入栏替换为一行灰字「你已不在该群聊中」。
  - 多选模式：替换为 MultiSelectBar（5.6）。
- **草稿**：离开会话时自动保存草稿，会话列表显示「[草稿]」。

### 5.2 EmojiPanel 表情面板

- 高度 = 上次键盘高度（默认 280px），在键盘和面板之间切换时栏位不跳动。
- 顶部标签：emoji / 我的表情（用户添加的）/ 内置表情包。底部右侧固定「发送」和删除键。
- emoji 网格：每行 8 个，每格 44px。表情包网格：每行 4 个。
- 面板内长按表情包 → 放大预览浮层。

### 5.3 PlusPanel「+」面板

- 网格每行 4 个，每项：56px 圆角方块（`bg.surface`、`radius.md`）内 28px 图标 + 下方文字（`fontSize.caption1`）。
- 项目：相册、拍摄、语音通话。
- 语音通话在 iPhone 网页版不支持时：图标照常显示，点击弹出 Dialog「iPhone 网页版暂不支持语音通话」（MED-06：不能点了没反应）。

### 5.4 VoiceRecordOverlay 按住说话浮层（MED-03）

- 按住「按住 说话」后，屏幕中央出现 160×160 浮层（`overlay.menu` 底 90% 不透明、`radius.lg`），内有音量波形（5 根竖条，按音量做 scaleY）和提示「手指上滑，取消发送」。
- 手指上滑超过 80px：浮层切换为取消态（图标变为撤销箭头，提示「松开手指，取消发送」，按钮底变 `status.danger`——瞬间切换，不做颜色过渡）。
- 录音少于 1 秒：轻提示「说话时间太短」。最长 60 秒，最后 10 秒显示倒计时。

### 5.5 QuotePreview 引用预览

- 选择「引用」后，在输入框上方出现一行：「名字：内容」（`fontSize.caption1`、`text.secondary`，单行省略）+ 右侧 × 关闭。背景 `bubble.quoteBg`。

### 5.6 MultiSelectBar 多选操作栏（CHAT-02、CHAT-11、EXP-01）

- 进入多选后：每条消息左侧出现 22px 圆形勾选框（未选：`border.strong` 描边；选中：`brand.primary` 实心 + 白色 ✓）；NavBar 左侧变为「取消」，标题显示「已选择 3 条」。
- 底部栏替换输入栏，3 个等宽按钮（图标 + 文字）：收藏、分享图、删除。
- **不可选的消息**：撤回提示、会话内提示 → 不显示勾选框（它们不是消息）。（v2.0 删除「成人模式消息不可选」，EXP-01 第 6 条。）
- 选择超过 P-24 条时：「分享图」按钮禁用，点击轻提示「一张分享图最多 30 条消息」（数值引用 P-24，界面文案由前端读取参数）。

---

## 6. 通用控件

### 6.1 Button 按钮

| 变体 | 外观 | 用途 |
|---|---|---|
| 主按钮 `primary` | 背景 `brand.primary`，文字 `text.onBrand`，`fontWeight.semibold` | 每页最多 1 个：添加、发消息、保存、发表 |
| 柔和按钮 `tonal` | 背景 `brand.soft`，文字 `brand.onSoft` | 次要操作：语音通话、生成分享图 |
| 次级按钮 `secondary` | 背景 `bg.surface`，0.5px `border.strong` 描边，文字 `text.primary` | 取消、不感兴趣 |
| 文字按钮 `text` | 无背景，文字 `text.link` | 行内操作：去处理、问问 TA、去设置 |
| 危险按钮 `danger` | 背景 `bg.surface`，文字 `text.danger` | 删除、注销、解散群聊 |

| 尺寸 | 高 | 圆角 | 字号 |
|---|---|---|---|
| 大 `lg` | 48px | `radius.md` | `fontSize.body` |
| 中 `md` | 36px | `radius.full` | `fontSize.callout` |
| 小 `sm` | 28px | `radius.full` | `fontSize.subhead` |

状态：按下（主按钮背景瞬间切换为 `brand.primaryPressed`）、禁用、加载中（宽度不变）。页面底部固定的大按钮左右边距 `space.5`，下方吃掉安全区。

### 6.2 Switch 开关

- 51×31px；关：轨道 `border.strong`；开：轨道 `brand.primary`；圆钮 27px 白色 + `shadow.sm`。
- 动效：圆钮 translateX；**轨道颜色不做颜色过渡**——实现为两层轨道叠放，「开」层用 opacity 淡入（遵守 motion.md R3）。时长 `duration.fast`。

### 6.3 Badge 角标

| 类型 | 外观 |
|---|---|
| 数字 | 高 18px、最小宽 18px、左右内边距 5px、`radius.full`；背景 `badge.unread`，文字 `badge.onUnread`、`fontSize.caption2`、`fontWeight.semibold`；超过 99 显示「99+」 |
| 红点 | 8px 圆点 `badge.unread` |
| 灰点（免打扰） | 8px 圆点 `badge.muted` |
| 「新」字 | 同数字型，内容「新」 |

### 6.4 Tag 标签

- 高 20px，`radius.xs`，内边距 0 `space.2`，`fontSize.caption2`、`fontWeight.medium`。
- 变体：中性（`bg.page` 底 + `text.secondary`）、品牌（`brand.soft` + `brand.onSoft`）、熟悉度（熟悉度色 12% 底 + 熟悉度色文字）、情景模式（模式色 12% 底 + 模式色文字）、公开资料（`status.infoSoft` + `status.info`）。
- 「12% 底」实现为同色 + 透明度叠加层，不新增颜色令牌。

### 6.5 SegmentedControl 分段选择

- 高 32px，外框 `bg.page`、`radius.sm`；选中段 `bg.surface` + `shadow.sm`、`fontWeight.semibold`；选中块切换用 translateX（`duration.fast`）。
- 用于：角色广场分类（明星 / 虚构角色 / 历史人物）、花费统计页按天 / 角色 / 用途。

### 6.6 StepSlider 五档滑杆（人设贴合度 CHAT-09）

- **结构**：上方居中显示当前档名（`fontSize.headline`）+ 下方一行该档的含义说明（`fontSize.footnote`、`text.secondary`，文案取自 CHAT-09 表）；中间滑轨（高 4px，`familiarity.track` 色）上 5 个刻度点；两端标签：左「更顺从」、右「更贴合人设」（`fontSize.caption1`）。
- **滑块**：28px 白色圆钮 + `shadow.sm`，只能停在 5 个刻度上；已选部分轨道 `brand.primary`（scaleX 实现）。
- **默认第 3 档**，第 3 档刻度下方标「默认」。
- **交互**：拖动或点击刻度；松手吸附（`duration.fast`）；安卓原生客户端可触发轻微震动（可选）。
- 改档后底部轻提示「下一条回复开始生效」（CHAT-09 第 4 条）。

### 6.7 TextField 输入框

- 高 44px（多行时自适应），背景 `bg.inputField`，`radius.sm`，内边距 `space.4`；占位 `text.placeholder`；聚焦时 1px `border.focus` 描边（瞬间切换）；错误时下方显示红色说明（`fontSize.caption1`、`text.danger`）；有字数上限时右下角显示「12/50」。
- **金额输入变体**（后台预算上限）：左侧固定「¥」，数字键盘，最多 2 位小数，右对齐，`fontFamily.numeric`。
- （v2.0 删除 KeyField 密钥输入框：用户端不再有任何密钥，MDL-01 删除。）

### 6.8 LongPressMenu 长按菜单（CHAT-02）

- 深色圆角浮层（`overlay.menu` 底、白色图标文字，与参照产品一致），`radius.md`，`shadow.md`。
- 每项：24px 图标 + 文字（`fontSize.caption1`），每项 56px 宽，一行最多 5 项，超过换行。
- 位置：优先显示在气泡上方，空间不够时显示在下方；带一个 8px 小三角指向气泡。
- 项目顺序：复制、收藏、引用、多选、撤回（仅自己且在 P-23 内）、删除、（语音）转文字、（图片）保存、（表情包）添加到表情。
- 删除时弹出 ActionSheet，说明「只从你的设备上删除，TA 的记忆不受影响」（CHAT-02 第 2 条）。
- 动效：M-05。

### 6.9 ActionSheet 操作列表

- 底部弹层（M-03）；可选标题说明（`fontSize.footnote`、`text.secondary`，居中）；每项高 56px、文字居中 `fontSize.body`；危险项 `text.danger`；最下方「取消」与其他项间隔 `space.3`（`bg.page` 色缝隙）。背景 `bg.elevated`，顶部圆角 `radius.lg`。

### 6.10 Dialog 对话框

- 宽 `min(320px, 屏幕宽 - 64px)`，`bg.elevated`，`radius.lg`，`shadow.lg`。
- 结构：标题（`fontSize.headline`，可省）→ 正文（`fontSize.subhead`、`text.secondary`，居中）→ 底部按钮区：两个按钮左右排列，中间 0.5px 分隔线；主操作在右侧、`fontWeight.semibold`；危险操作文字 `text.danger`。
- 只用于需要用户明确确认的事：删除角色、换模型提醒（MDL-06）、注销、删除并退出群聊、「全部改为默认值」（SVC-01 第 4 条）、拨打时余额不足（MDL-10 第 5 条，这是用户主动拨打后的反馈，不是聊天中主动弹出）。**聊天过程中不主动弹出**。（v2.0 删除成人模式年龄确认，MODE-03 第 2 条。）

### 6.11 Toast 轻提示

| 类型 | 外观 | 用途 |
|---|---|---|
| 图标型 | 中央 120×120，`overlay.menu` 底 90% 不透明、`radius.md`，白色 32px 图标 + 文字 | 已收藏、已保存到相册 |
| 文字型 | 中央胶囊，最长 2 行 | 说话时间太短、这条消息不能选择 |
| 成就型 | 顶部横幅：成就徽章缩略 32px + 「获得成就「第一次通话」」，`bg.elevated` + `shadow.md`、`radius.md`，停留 3 秒 | GRW-06（不打断聊天：不遮挡输入栏、不需要点击关闭；点击可进入成就页） |

动效：M-06。同时最多一个，新提示替换旧提示。

### 6.12 EmptyState 空状态

- 居中：插画 120px（`brand.md` 第 6 节：画物不画人）→ 标题（`fontSize.callout`、`text.primary`）→ 说明（`fontSize.footnote`、`text.secondary`）→ 可选按钮（Button md tonal）。
- 文案示例：会话列表空「还没有聊天 · 去加一个你喜欢的 TA 吧」；收藏空「长按 TA 的消息，就可以收藏」；卡册空「和 TA 认识满 7 天，会收到第一张纪念卡」。

### 6.13 Skeleton 骨架屏

- 色块 `bg.skeleton`，圆角与真实内容一致。
- 加载动画：整体透明度在 0.6 和 1 之间往复（1.2 秒），**不用**左右流光（流光会触发重绘）。
- 加载超过 300ms 才显示骨架屏，避免闪一下。

---

## 7. 提示类

### 7.1 SystemBanner 系统横条（MDL-04、MDL-10）

工具层面的问题提示，**不是角色口吻**，也**不是弹窗**。这是与参照产品的有意差异之一（PRD 原则 8）。

- **位置**：聊天页（私聊、群聊）NavBar 正下方，悬浮在消息区之上（M-12）；会话列表顶部只显示「网络不可用」。
- **结构**：左：20px 图标；中：一行文字（`fontSize.footnote`），最多 2 行；右：文字按钮。
- **尺寸**：最小高 44px，左右内边距 `space.4`；无圆角（通栏）；无阴影，底部 0.5px `border.hairline`。
- **文字里不出现**「API」「token」「密钥」等技术词；不出现金额。
- **变体**：

| 变体 | 背景 / 文字 | 文案 | 按钮 |
|---|---|---|---|
| 网络不可用 | `status.dangerSoft` / `text.danger` | 「当前网络不可用，请检查网络设置」 | 无（联网后自动消失） |
| 余额不足 | `status.warningSoft` / `status.warningText` | 「余额不足，角色暂时无法回复」 | 「查看余额」→ 余额页（MDL-10 第 2 条） |
| 模型服务不可用 | `status.warningSoft` / `status.warningText` | 「模型服务暂时不可用，角色暂时无法回复」 | 无；**该角色单独设置的模型**出问题而默认模型正常时，按钮「临时改用默认模型」（MDL-04 边界情况） |

- **交互**：不能手动关闭（问题解决后自动消失）；有按钮时点整条 = 点按钮。
- **优先级**：同时有多个问题时只显示一条：网络不可用 > 余额不足 > 模型服务不可用。
- 横条出现期间，NavBar 副标题不显示「正在输入」（MDL-04 第 4 条）。
- （v2.0 删除「未配置模型」「密钥失效」「额度已用完」变体。）

### 7.2 InlineTip 一次性提示条

- 用于「想和 TA 是什么关系？」（GRW-02、CHR-03 第 5 条）这类可关闭、只出现一次的引导。
- 位置与 SystemBanner 相同（两者同时存在时 SystemBanner 在上）。背景 `brand.soft`，文字 `brand.onSoft`，右侧「去设置」文字按钮 + × 关闭。
- 关闭后不再出现。
- **警告变体**：背景 `status.warningSoft`、文字 `status.warningText`、无 × 按钮，用于表单里的规则提醒（如角色编辑器中「人设中有未成年特征，这个角色不能开启成人模式」，SAFE-03 第 4 条）。

### 7.3 WhileAwayCard「你不在时」摘要卡

见 `pages/while-away-timeline.md` 第 2 节（组件规格与页面强相关，只在那里定义）。

### 7.4 网络状态

断网时使用 SystemBanner「网络不可用」变体；会话列表 NavBar 标题变为「微伴（未连接）」，重连中为「收取中…」（与参照产品一致）。

---

## 8. 情景模式

### 8.1 ModeIndicator 情景模式标识（MODE-01 第 5 条）

- **位置**：私聊和群聊的 NavBar 副标题（日常模式不显示）。v2.0 起群聊也有情景模式（SOC-03 第 4 条）。
- **外观**：6px 圆点（模式色）+ 模式名（`fontSize.caption1`、模式色），例：「● 傲娇模式」。
- **颜色**：傲娇 `mode.tsundere`、恋爱 `mode.romance`、成人 `mode.adult`、管理员新增的模式 `mode.custom`。三个颜色两个主题共用。
- **成人模式**：文字为「成人模式」+ 12px 锁形图标，刻意使用低调的中性色——避免旁人瞄到屏幕时过于醒目（这是视觉选择，不是内容隔离）。
- **交互**：点击副标题 → 打开 ModePicker。

### 8.2 ModePicker 情景模式选择

- 两种容器，内容相同：底部弹层（点 NavBar 副标题快捷进入）和推入页面（聊天信息 › 情景模式；服务 › 情景模式总览 › 点某个角色）。
- 每项：ListCell 选择型：模式名 + 一行说明（MODE-01 表中的说明）+ 右侧 ✓。
- **只列出有资格的模式**；没资格的**不出现**（不是置灰，MODE-01 第 4 条）。私聊看该角色的资格；群聊看所有成员都具备的资格（SOC-03 第 4 条）。
- **选择即生效**（MODE-03 第 2 条）：没有年龄确认、没有模型配置引导。
- 选择后弹层关闭（页面形式则 ✓ 移动，留在本页），会话中出现 SystemTip「已切换到 XX 模式」。

---

## 9. 角色与养成

### 9.1 CharacterRow 广场角色行（CHR-01）

- ListCell 变体：头像 48 + 名字（`fontSize.body`、`fontWeight.medium`）+ 一句话简介（`fontSize.footnote`、`text.secondary`，单行）+ 标签行（最多 3 个 Tag 中性型，如「演员」「《大圣归来》」）；右侧：未添加「添加」（Button sm tonal）/ 已添加「已添加」（`text.tertiary` 文字，无按钮）。
- 点击整行 → 资料页；点「添加」→ 直接弹出打招呼弹层（不进资料页）。

### 9.2 ProfileHeader 资料页头部（CHR-02）

见 `pages/character-profile.md` 第 2 节。

### 9.3 DaysCounter 认识天数（GRW-04）

| 变体 | 外观 | 用在 |
|---|---|---|
| 大号 | 上：「认识第」（`fontSize.footnote`、`text.secondary`）；中：数字（`fontSize.display`、`fontFamily.numeric`、`fontWeight.bold`、`brand.primary`、等宽数字）；下：「天」 | 资料页 |
| 小号 | 文字「认识第 128 天」（`fontSize.subhead`、`text.secondary`），或 Tag 品牌型 | 资料页头部副信息、分享图角标 |

- 关系类型为「恋人」且用户选择了「显示在一起第 N 天」时，文案改为「在一起第 N 天」；其他情况**绝不**出现「在一起」字样（GRW-04 第 5 条）。
- 纪念日当天：大号数字旁出现一枚 16px 小星星（静态，不闪烁）。

### 9.4 FamiliarityMeter 熟悉度（GRW-03）

- **等级徽记**：用**月相**表示 5 个等级——L1 新月、L2 眉月、L3 上弦月、L4 盈凸月、L5 满月。寓意「越来越圆满」，不使用爱心等恋爱符号（GRW 设计思路：熟悉度与恋爱无关）。图标为自定义 SVG，颜色取 `familiarity.l1`～`l5`。
- **变体**：
  - 徽章：Tag 熟悉度型「◐ L3 熟络」。
  - 进度条：高 6px、`radius.full`，轨道 `familiarity.track`，填充为当前等级色（scaleX 实现，M-14）；下方说明「距 L4 老友还差 120 点」（`fontSize.caption1`、`text.secondary`）；L5 满级显示「已经是知己啦」，进度条填满。
  - 圆环：64px，用在资料页大号展示，环宽 4px，中心是月相徽记（M-14 例外说明）。
- **不显示**每日获得点数的倒计时、排行、与其他用户比较（不操纵）。

### 9.5 CollectibleCard 收藏卡片（GRW-05）

- **比例 3:4**；网格中宽 = (屏幕宽 - 16×2 - 12×2) / 3；详情中宽 280px。圆角 `radius.lg`；网格中无阴影，详情中 `shadow.lg`。
- **正面结构**：
  ```
  ┌──────────────────┐
  │ [类型色角标]  No.012 │  ← 左上角 6px 宽竖色条 + 类型名（纪念卡 / 熟悉度卡 / 节日卡 / 瞬间卡）
  │                    │
  │   卡面画面（约 62%）  │  ← 卡面模板：场景 / 物件 / 应援色图案；真人角色不含任何肖像（SAFE-01）
  │                    │
  │「角色写给你的一句话」 │  ← fontFamily.serif，fontSize.subhead（网格中隐藏，只在详情显示）
  │ 2026.10.04  角色名  │  ← fontSize.caption1，等宽数字
  └──────────────────┘
  ```
- **类型色**：`card.memorial`、`card.familiarity`、`card.festival`、`card.moment`。
- **卡面模板**（交给管理员素材库 ADM-04 维护，这里定规格）：画面区域 3:2.2；风格遵守 `brand.md` 第 6 节插画方向；每张模板必须提供浅色、深色两种可读性检查截图；真人角色模板以应援色为主色，可包含该角色的公开元素（如麦克风、剧本、片场场记板），**不含人物**。
- **未获得**（只限纪念卡、熟悉度卡，瞬间卡不显示未获得项）：整张为 `card.silhouette` 色块 + 中央 32px 线性锁形图标 + 获得条件（「认识第 200 天获得」「升到 L4 老友获得」，`fontSize.caption1`）。不做模糊处理（motion.md R4）。
- **背面**（详情中点击卡片切换，交叉淡入，不做 3D 翻转）：完整的一句话 + 获得原因（「我们认识的第 100 天」）+ 日期。
- **新获得**：网格中卡片右上角红点，查看后消失；获得瞬间的动画 M-13。

### 9.6 AchievementBadge 成就徽章（GRW-06）

- 成就清单（28 个）的唯一定义在 PRD GRW-06；每枚徽章的插画题材见 `pages/cards-familiarity.md` 第 5.2 节。
- **结构**：64px 圆形底座（`radius.full`）+ 内部 40px 物件插画；下方成就名（`fontSize.footnote`，最多 2 行）+ 获得日期或进度（`fontSize.caption2`、`text.tertiary`）。
- **底座颜色按分组**（`achievement.*`，两个主题相同）：相识 `meet`、聊天与通话 `chat`、群聊与朋友圈 `social`、收藏与卡片 `collect`、纪念日与熟悉度 `memorial`。
- **已获得**：底座 = 分组色 16% 透明叠加在 `bg.surface` 上（与 Tag「12% 底」同一做法，不新增颜色），外圈 2px 分组色描边；插画彩色。
- **未获得**：底座 `bg.page`，无描边；插画用 `achievement.locked` 单色线稿（单独一套灰色 SVG，不用滤镜）；累计型显示进度「3/5」。
- **新获得**：右上角 8px 红点，查看成就页后消失（SVC-01 第 5 条）。
- 点击 → 底部弹层：大徽章（96px）+ 名称 + 获得条件 + 获得日期 / 当前进度。
- 插画规格：40px 画布，1.5px 线宽，最多 3 色（分组色 + 墨色 + 1 个点缀色），画物不画人（`brand.md` 第 6 节），SVG 单个 ≤ 6KB。网页和安卓用同一份 SVG。

### 9.7 成就提示

使用 Toast 成就型（6.11）。

---

## 10. 朋友圈

### 10.1 MomentCard 朋友圈卡片（SOC-07～09）

- **布局**（与参照产品一致）：
  ```
  [头像40]  名字（text.nameInMoments, semibold, callout）
            正文（callout，最多 6 行，超出显示「全文」）
            [图片网格 / 链接卡片]
            2 小时前                           [··]
            ┌───────────────────────────┐
            │ ♡ 名字A，名字B，我            │  ← 点赞行
            │ ─────────────────────────── │
            │ 名字A：评论内容               │  ← 评论
            │ 我 回复 名字A：内容            │
            └───────────────────────────┘
  ```
- **尺寸**：左右边距 `space.5`；头像与内容间距 `space.4`；条目之间 0.5px `border.hairline` 通栏分隔，上下内边距 `space.5`。
- **点赞评论区**：背景 `bg.page`（深色 `bg.elevated`），`radius.xs`，顶部左侧 8px 小三角；名字 `text.nameInMoments`，正文 `fontSize.subhead`。
- **「··」按钮**：点击后从按钮左侧展开深色胶囊（`overlay.menu`），含「赞」「评论」两项（scaleX 从右向左展开 + opacity，`duration.fast`）；角色朋友圈的「··」长按或卡片右上「…」另有：收藏、生成分享图（EXP-01）。
- **评论输入**：点「评论」或点某条评论 → 底部出现单行输入栏（同 InputBar 简化版：输入框 + 表情 + 发送），占位「评论」或「回复 名字」。
- **可见性**：只显示通讯录中角色的点赞和评论（SOC-08 第 3 条），这是数据规则，界面不做额外标识。

### 10.2 ImageGrid 图片网格

| 图片数 | 布局 |
|---|---|
| 1 | 按原图比例，长边最大 180px，短边最小 90px |
| 2、3 | 一行，每张正方形，边长 = (内容宽 - 4×2) / 3 |
| 4 | 2×2 正方形（与参照产品一致） |
| 5–9 | 3 列正方形网格 |

- 间距 4px（`space.2`）；圆角 0（与参照产品一致，网格整体外角 `radius.xs`）；先用 `bg.skeleton` 占位。
- 点击 → 全屏图片查看，左右滑动切换。

### 10.3 MomentsCover 朋友圈封面

- 顶部封面图高 = 屏宽 × 0.75；右下角压着当前主人头像（64px，白色 2px 描边）和名字（白色，带 `shadow.sm` 字影）。
- 用户自己的朋友圈：用户上传封面；未上传时为品牌插画（星空 + 信封）。
- 角色的朋友圈：管理员配置的场景封面；**真人角色不得用人物照片**；未配置时为应援色渐变 + 品牌星星纹样。
- 顶部 NavBar 在封面上为透明背景 + 白色图标，下滑超过封面后切换为实色 `bg.navBar`（两层叠放，用 opacity 切换）。

---

## 11. 时间线

### 11.1 TimelineItem 时间线条目（SIM-11）

见 `pages/while-away-timeline.md` 第 3 节。

### 11.2 PublicInfoTag 公开资料标注

- Tag 公开资料型「公开资料」+ 右侧「来源」文字链接（`fontSize.caption2`、`text.link`），点击用浏览器打开来源链接。
- 用在：时间线中来自公开动态的条目、资料页「近期主线」中来自公开动态的条目（SIM-02、SIM-03）。推演产生的条目**不**显示任何来源标注。

---

## 12. 通话

见 `pages/call.md`（通话页是一整页，组件与页面一起定义）。共用组件：

### 12.1 CallButton 通话圆形按钮

- 64px 圆形；接听 `call.accept`、挂断 / 拒绝 `call.decline`、功能按钮（静音、扬声器）`call.control` 底 + 白色图标，开启时底变 `call.controlActive` + 深色图标（两层叠放，opacity 切换）。
- 下方文字 `fontSize.caption1`、`call.textSecondary`。
- 点击区 ≥ 64px；接听 / 挂断按钮按下时 scale 0.94（`duration.instant`）。

### 12.2 CallCapsule 通话中胶囊

- 通话页缩小后，出现在所有页面 NavBar 上方（安全区下方）：高 28px、`radius.full`、背景 `call.accept`、白字 `fontSize.caption1`「通话中 03:12 · 点击返回」，居中。
- 出现 / 消失：translateY + opacity（`duration.fast`）；点击回到通话页。

---

## 13. 模型

（v2.0 删除 13.1 ProviderKeyCard 供应商密钥卡：平台中转后用户不填密钥，MDL-01 删除。）

### 13.2 ModelRow 模型行（MDL-02）

- ListCell 选择型，两到三行：
  1. 模型名（`fontSize.body`）+ 供应商（`fontSize.caption1`、`text.secondary`）+ 排行榜名次（如有，Tag 中性型「榜 #3」）；
  2. 价格档位 PriceTier（16.6）+「约每条回复 ¥0.012」（`fontSize.caption1`、`text.secondary`，数值取自价目表 MDL-09，点击该行文字 → 价目表并定位到该模型）；
  3. 能力 Tag（中文好、长记忆、支持识图、允许成人内容，含义见 `docs/ai/model-catalog.md`）。
- 右侧 ✓（当前选中）。
- 模型列表只含已上架模型，**没有「不可用」状态**（v2.0 删除「去填写密钥」）。

### 13.3 LeaderboardRow 排行榜行（MDL-03）

- 左：名次（`fontSize.title3`、`fontFamily.numeric`；前三名 `brand.primary`，其余 `text.tertiary`）；中：模型名、供应商、综合评分（`fontWeight.semibold`）、PriceTier +「约每条回复 ¥X」、标签、一句话点评（`fontSize.footnote`、`text.secondary`，最多 2 行）；右：Button sm tonal「用这个模型」，当前已在用时改为灰字「使用中」。
- 点「用这个模型」：直接生效，Toast「已设为聊天模型」，没有任何跳转（MDL-03 第 5 条）。

---

## 14. 分享图

分享图编辑页与 4 套模板全文见 `share-templates.md`。

---

## 15. 其他通用组件

### 15.1 PopoverMenu 弹出菜单

- 用于会话列表右上角 ⊕（发起群聊、添加角色）。
- 样式同 LongPressMenu（`overlay.menu` 底、白字、`radius.md`、`shadow.md`），但为**竖排**列表：每项高 48px，左侧 24px 图标 + 文字（`fontSize.body`），宽 160px；右上角小三角指向按钮。
- 动效：从右上角 scale 0.9 → 1 + opacity（`duration.fast`）。

### 15.2 ImageViewer 全屏图片查看

- 黑色背景（`overlay.viewer`）；图片居中适配屏幕；双击 / 双指缩放（transform: scale）；左右滑动切换多图（translateX）；下滑关闭（图片跟手 translateY + 背景透明度降低）。
- 底部右侧「…」→ ActionSheet：保存图片、收藏、（表情包）添加到表情。
- 打开：从缩略图位置放大到全屏（transform 计算起止位置，`duration.base`）。

### 15.3 JumpPill 跳转胶囊

- 聊天页「↑ 12 条新消息」（右上，消息区顶部下方 `space.4`）和「↓」回到底部按钮（右下，输入栏上方 `space.4`，40px 圆形）。
- 背景 `bg.elevated` + `shadow.sm`；文字 / 图标 `brand.primary`；「↓」有新消息时右上角红点。出现 / 消失用 opacity + scale（`duration.fast`）。
- 朋友圈「1 条新消息」胶囊同样式，内含 24px 头像。

### 15.4 TimePickerSheet 时间选择

- 底部弹层，内含两列滚轮（时、分），选中行上下各一条 0.5px `border.hairline`；顶部左「取消」右「完成」（`brand.primary`）。滚轮滚动只用 transform。

### 15.5 MiniBarChart 迷你柱状图

- 用于花费统计页最近 7 天。高 120px；7 根柱子，宽 = (内容宽 - 6×8) / 7，圆角顶部 `radius.xs`；颜色 `brand.primary`，当天 `brand.accent`；柱下日期 `fontSize.caption2`、`text.tertiary`；点柱子在上方显示数值气泡（`bg.elevated` + `shadow.sm`）。
- 数值变化：柱子 scaleY（变换原点在底部，`duration.slow`）。
- 只表达一组数据，不做图例；需要更复杂的图表时另行提出。

### 15.6 FavoriteCard 收藏卡片

- `bg.surface`、`radius.lg`、内边距 `space.5`、卡片间距 `space.3`；无阴影。
- 顶部：头像 24 + 角色名（`fontSize.footnote`、`fontWeight.medium`）+「· 10 月 3 日」（`text.tertiary`）；朋友圈收藏右侧加 Tag 中性型「朋友圈」。
- 内容：文字（`fontSize.body`，最多 6 行）/ 图片缩略图（长边 120）/ 语音（语音条 + 转写）。
- 多选模式：左上角出现 22px 勾选框（同 5.6）。

### 15.7 EntryCard 入口大卡片

- 用于「创建自己的角色」的两种方式选择。`bg.surface`、`radius.md`、内边距 `space.6`；左侧 64px 插画，右侧标题（`fontSize.headline`）+ 说明（`fontSize.footnote`、`text.secondary`）；右侧 ›。整卡可点。

### 15.8 PromoBanner 引导横幅

- 用于「不知道选哪个？看排行榜」这类页面内的主动引导。`brand.soft` 底、`radius.md`、内边距 `space.4`；左侧 24px 图标（`brand.onSoft`）+ 文字（`fontSize.subhead`、`brand.onSoft`）+ 右侧 ›。不可关闭；每页最多 1 个。

---

## 16. 服务与计费（SVC-01、MDL-05～10）

页面怎么组合见 `pages/me-and-services.md`、`pages/billing.md`。

### 16.1 WalletCard 服务页顶部卡片（SVC-01 第 2 条，对应参照产品服务页顶部的钱包卡片）

```
┌──────────────────────────────────────┐
│     [钱包图标28]            [芯片图标28]    │
│        余额                   模型       │
│      ¥ 12.34              模型 X ›     │
│     （余额不足）                          │
└──────────────────────────────────────┘
```

- 左右等分两格，中间无分隔线；整卡背景 `brand.primary`（跟随主题），文字和图标 `text.onBrand`；`radius.md`；高 `size.walletCard`；左右外边距 `space.3`，上 `space.3`。
- 每格：图标 28（线性）→ 标签（`fontSize.subhead`）→ 值：余额用 `fontSize.title3`、`fontFamily.numeric`、`fontWeight.semibold`，模型名用 `fontSize.subhead`、单行省略。
- 白字在强调色上按大字 / 界面元素标准（≥ 3:1，`brand.md` 3.4），所以值文字不小于 `fontSize.subhead` 且为半粗。
- 余额低于 P-32：余额值下方加「余额不足」（`fontSize.caption1`）+ 余额格右上角红点（`badge.unread`，外加 1.5px 白色描边让红点在强调色上清晰）。
- 每格整格可点：左 → 余额页；右 → 模型页。按下态：格子叠加白色 12% 遮罩（不改底色）。

### 16.2 ServiceGrid 服务宫格（SVC-01 第 2 条）

- 一个分组 = `bg.surface` 白块（`radius.md`，左右外边距 `space.3`，组间距 `space.3`）；块内左上角分组标题（`fontSize.footnote`、`text.secondary`，内边距 `space.4`）。
- 每行 4 格，格宽 = 块宽 / 4，格高 `size.gridCell`；格内居中：图标 `size.gridIcon`（28，线性）→ 间距 `space.3` → 名称（`fontSize.caption1`、`text.primary`，居中，最多 2 行；「主动消息与免打扰」在窄屏会折成两行，格高不变）。不足 4 个时左对齐留空。
- 图标颜色：每个入口固定一个 `tint.*`（见 `pages/me-and-services.md` 第 2 节），两个主题相同。
- 红点：图标右上角 8px（新卡片、新成就）。
- 功能未上线时该格**不显示**，后面的格子前移（SVC-01 第 6 条）。

### 16.3 BalanceHero 余额大数字（MDL-07）

- 居中：钱包图标 48（`brand.primary`）→「余额」（`fontSize.subhead`、`text.secondary`）→ 金额「¥ 12.34」（`fontSize.display`、`fontFamily.numeric`、`fontWeight.bold`、等宽数字、`text.primary`）→ 说明「如需增加余额，请联系管理员」（`fontSize.footnote`、`text.tertiary`）。
- 低于 P-32 时金额下方加 Tag（`status.warningSoft` 底、`status.warningText` 字）「余额不足」。
- **没有充值按钮**（MDL-07 第 4 条）。
- 金额保留 2 位小数；余额为负（安全优先情况，MDL-10 第 6 条）显示「−¥ 0.03」，颜色仍为 `text.primary`。

### 16.4 LedgerRow 余额明细行（MDL-08）

```
[类型图标]  杨幂 · 聊天                       −0.4120
            共 46 次 · 模型 X                余额 12.3400
```

- 左：40px 圆形底（类型对应 `tint.*` 16% 叠加）+ 20px 类型图标（同色）：聊天 = 气泡（blue）、后台 = 月亮（lilac）、识图 = 眼睛（teal）、语音 = 声波（orange）、图片 = 画框（pink）、导入 = 文档（gray）、管理员加余额 = 加号（teal）、管理员扣减 = 减号（gray）、退还 = 回旋箭头（teal）。
- 中：第一行标题（`fontSize.body`，单行）：「角色名 · 类型」，无角色时只写类型（「管理员加余额」）；第二行（`fontSize.caption1`、`text.secondary`）：合并行写「共 N 次 · 模型名」，管理员记录写备注，退还写「调用失败退还」。
- 右：金额（`fontSize.body`、`fontFamily.numeric`、等宽）：「+」用 `amount.income`，「−」用 `amount.expense`；下方「余额 12.3400」（`fontSize.caption1`、`text.tertiary`）。单条最多 4 位小数，不足 0.0001 显示「< 0.0001」。
- 行高最小 64；合并行右侧有 ›，点击推入该组的每次调用列表（同一组件，标题改为时间「14:05」，第二行为模型名）。
- 管理员加余额、扣减、退还永远单独一行（MDL-08 第 4 条）。
- 按天分组：SectionHeader「10 月 4 日」，右侧当天合计「支出 ¥1.23  收入 ¥50.00」（`fontSize.caption1`、`text.tertiary`）。

### 16.5 FilterBar 筛选条

- 横排 3 个下拉胶囊：「日期 ▾」「类型 ▾」「角色 ▾」（高 32，`radius.full`，`bg.surface`，`fontSize.subhead`）；已筛选时胶囊变为 `brand.soft` 底 + `brand.onSoft` 字。点击打开底部弹层选择（日期为「今天 / 近 7 天 / 近 30 天 / 自定义」，类型和角色为多选 ListCell）。
- 吸顶在 NavBar 下方（`zIndex.sticky`）。用于余额明细、花费统计。

### 16.6 PriceTier 价格档位

- 1–3 个「¥」字符（`fontSize.caption1`、`fontWeight.semibold`）：便宜 = 1 个、中等 = 2 个、较贵 = 3 个；亮起的用 `text.primary`，其余用 `text.placeholder`（例：「¥¥¥」中前两个亮）。旁边可选文字「便宜 / 中等 / 较贵」。

### 16.7 PriceRow 价目行（MDL-09）

- 折叠态：标题（模型名 / 「语音消息」等，`fontSize.body`）+ PriceTier；第二行「约每条回复 ¥0.012 · 约每次后台推演 ¥0.003」（`fontSize.caption1`、`text.secondary`）；右侧 ⌄。
- 展开态（点击整行）：下方追加原始单价小表（`fontSize.caption1`、等宽数字），如「输入 每千字 ¥0.004 / 输出 每千字 ¥0.016」，单位以价目表数据为准（T-009）。展开只改变本行高度，是用户主动操作，允许。

### 16.8 BudgetMeter 今日后台花费（MDL-05）

- 「今日后台已用 ¥0.82 / 上限 ¥3.00」（`fontSize.subhead`，数字等宽）+ 进度条（同 FamiliarityMeter 进度条规格，填充色 `brand.primary`，达到上限时 `status.warning`）+ 说明「达到上限后，推演、朋友圈等后台功能今天暂停，聊天回复不受影响」（`fontSize.caption1`、`text.secondary`）。

### 16.9 OverviewRow 总览行（服务页里的熟悉度、情景模式、主动消息、聊天偏好总览）

- 头像 40 + 名字（`fontSize.body`）+ 第二行当前值（`fontSize.caption1`、`text.secondary`，如「傲娇模式」「主动消息：适中」「秒回关 · 拆条开 · 平衡」）；右侧 ›。熟悉度总览的第二行改为 FamiliarityMeter 进度条 + 「L3 熟络 · 距 L4 还差 120 点」。
- 点击 → 推入该角色对应的设置页，返回时本行即时刷新。
- 列表底部（聊天偏好、主动消息）：Button md secondary「全部改为默认值」→ Dialog 确认（SVC-01 第 4 条），文案「所有角色的这些设置都会改为当前默认值」。

### 16.10 ThemePreviewCard 主题预览卡（SVC-01 第 7 条）

- 两张并排卡片（各占一半宽，间距 `space.4`）：上部 3:4 的缩略界面（**用该主题自己的令牌静态绘制**：浅灰 / 暖白底 + 一条角色气泡 + 一条自己的气泡 + 底部一个强调色按钮），下方主题名（「默认」「微伴粉」，`fontSize.subhead`）+ 圆形单选（选中 `brand.primary` 实心 ✓）。
- 缩略图跟随当前深浅模式显示该主题的浅色或深色版本。
- 选中边框：2px `brand.primary`；未选中：0.5px `border.strong`。
- 点击即切换并立即全局生效（瞬间换色，不做颜色过渡，motion.md R3）。

---

## 17. 聊天信息页组件（CHAT-13、SOC-03）

### 17.1 MemberGrid 成员宫格

- `bg.surface` 白块；每行 5 格（私聊页同样按 5 列排，只用前两格），格内：头像 48 → 间距 `space.2` → 名字（`fontSize.caption1`、`text.secondary`，单行省略，最多 4 个字宽）。
- 「+」格：48 方块，0.5px 虚线 `border.strong` 描边，中间 24 加号（`text.tertiary`）；群聊另有「−」格（同样式）。
- 点成员头像 → 资料页；点「+」→ 选择角色页（私聊：选中的角色和当前角色一起建新群，CHAT-13；群聊：加入本群）；点「−」→ 成员进入删除态（头像左上角红色减号）。
- 群成员超过 14 个（含 +、−）时只显示前 3 行，下面一行「查看全部群成员 ›」。

### 17.2 GroupedSettings 分组设置

- 由 ListCell（3.1）、SectionHeader（3.5）组成的分组列表；微伴专属分组带分组标题（如「和 TA 的相处」「高级」），参照产品原有的分组不加标题，保持原样。

---

## 附：组件与需求覆盖检查

| 任务卡点名的组件 | 本文位置 |
|---|---|
| 消息气泡各类型 | 4.1、4.2 |
| 输入栏 | 5.1–5.6 |
| 会话列表项 | 3.2 |
| 通讯录项 | 3.3 |
| 朋友圈卡片 | 10.1 |
| 系统横条 | 7.1 |
| 来电界面 | 12、`pages/call.md` |
| 卡片 | 9.5 |
| 成就徽章（28 枚） | 9.6、`pages/cards-familiarity.md` 5.2 |
| 情景模式标识 | 8.1 |
| 服务页顶部卡片、服务宫格 | 16.1、16.2 |
| 余额、明细、价目、档位、后台预算 | 16.3–16.8 |
| 总览行、主题预览卡 | 16.9、16.10 |
| 聊天信息页（私聊、群聊） | 17 |
| 「我」页菜单行 | 3.6 |
