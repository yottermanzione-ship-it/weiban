# 微伴组件规范

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-006（v1.0）、T-012（v2.0）、T-021（v2.1） |
| 版本 | v2.1 |
| 日期 | 2026-10-05 |

> v2.1 变更（T-021，PRD v1.3）：新增 1.5 TabSwitch 顶部分页；4.2 新增信件卡片 `LetterCard`、QuickReplyMessage 放宽到 3 个按钮（宠物起名）；4.4 新增会话内提示用途（宠物、专注、慢信、成人模式模型不可用）；5.3「+」面板新增「写信」「陪我专注」；5.6 成人模式与「健康」消息不能生成分享图（EXP-01 第 6 条）；8.2 成人模式「先选模型」提示（MODE-03 第 3 条）；9.6 成就增至 30 枚、新增分组色 `achievement.play`；15.6 收藏卡的「不能生成分享图」标记；16.1、16.3、16.4 余额为负数的显示（安全优先透支，上限见 `billing.md` 6.6）；16.4 新增「安全」「行为规划」类型图标；新增第 18 节「人设广场」、第 19 节「互动玩法」、第 20 节「管理后台」组件。
>
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

### 1.5 TabSwitch 顶部分页（v2.1）

- **用途**：同一个页面里两到三个**并列的内容区**切换，例如「角色广场」的「预设角色 | 人设广场」（PLZ-01 第 1 条）、「信箱」的「收到的 | 寄出的」。与 SegmentedControl（6.5）的区别：TabSwitch 切换的是整页内容、放在 NavBar 正下方；SegmentedControl 是页面内的筛选。
- **结构**：NavBar 下方一条高 44px 的栏，背景 `bg.navBar`（与 NavBar 连成一体），底部 0.5px `border.hairline`；2–3 个等宽文字标签（`fontSize.callout`）；未选中 `text.secondary`、选中 `text.primary` + `fontWeight.semibold`；选中标签文字下方一条指示条：宽 24px、高 3px、`radius.full`、`brand.primary`，距栏底 4px。
- **角标**：标签文字右上角可带 Badge 红点（例如人设广场有新的举报处理结果时不在这里显示，红点只放在「我发布的」入口，见 `pages/persona-plaza.md`）。
- **交互**：点标签切换；内容区左右滑动也可切换（安卓、iPhone 网页都支持，跟手 translateX）。指示条移动用 M-17。切换时内容区不做淡入，直接替换（与参照产品一致）。
- **状态**：每个分页各自记住滚动位置；离开页面再回来停在上次的分页。
- **只能放 2–3 个标签**；更多分类用 SegmentedControl 或横向滚动 Tag。

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
| 带快捷按钮的消息 | `QuickReplyMessage` | 普通角色文字气泡 + 气泡下方一行按钮（Button sm tonal，最多 3 个，间距 `space.3`；3 个放不下一行时折成两行，行数在消息到达时就确定）；按钮区高度随消息一起固定。用于：「以后可以给你打电话吗？」（MED-07，2 个）、角色提议领养宠物「去看看」（PLAY-02 第 2 条，1 个）、「让 TA 起名」的 3 个候选名（PLAY-02 第 3 条，3 个）、角色提议加入心愿清单「加进去 / 先不了」（PLAY-04，2 个） | 每组按钮只能点一次；点后按钮区替换为灰字「你选择了：可以」（`fontSize.caption1`、`text.tertiary`，高度不变）。「去看看」类跳转按钮点后不替换，可重复点 | MED-07、PLAY-02、PLAY-04 |
| 信件 | `LetterCard` | 固定 240×96，无尖角，`bubble.otherBg`（自己寄出的为 `bubble.selfBg`），`radius.md`；左侧 48px 信封插画（静态 SVG，`brand.md` 第 6 节风格），右侧上行「杨幂 给你寄来了一封信」/「你给 杨幂 寄了一封信」（`fontSize.subhead`、`fontWeight.medium`），下行信的第一句（`fontSize.caption1`、`text.secondary`，单行省略）；未读的来信右上角 8px 红点 | 点击 → 读信页（`pages/play.md` 第 4 节）；长按：收藏、删除（无复制、无引用） | PLAY-05 |
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
| 成人模式模型不可用（v2.1） | 「成人模式模型已不可用，已回到日常模式」 | — | MODE-03 第 6 条 |
| 共同领养（v2.1） | 「你和 杨幂 一起领养了团子」+ 下一行「去看看团子 ›」 | 「去看看」→ 宠物页 | PLAY-02 第 3 条 |
| 宠物长大（v2.1） | 「团子长成少年啦 · 获得瞬间卡 ›」 | → 卡片详情 | PLAY-02 第 11 条 |
| 慢信在路上（v2.1） | 「信已寄出，TA 的回信在路上」 | — | PLAY-05 |
| 专注开始 / 结束（v2.1） | 「开始专注 25 分钟」/「专注结束 · 25 分钟」/「专注提前结束」 | — | PLAY-06 |
| 心愿完成（v2.1） | 「一起去看海 已完成 · 获得瞬间卡 ›」 | → 卡片详情 | PLAY-04 |
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
- 项目：相册、拍摄、语音通话；v2.1 增加「写信」（信封图标，PLAY-05 → 写信页）、「陪我专注」（沙漏图标，PLAY-06 → 专注设置弹层）。只在私聊出现，群聊没有这两项。功能所在开发层未上线时不显示（SVC-01 第 6 条同一做法）。
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
- **不可选的消息**：撤回提示、会话内提示 → 不显示勾选框（它们不是消息）。
- **不能生成分享图的消息**（v2.1，EXP-01 第 6 条、MODE-05 第 4 条、PLAY-01 第 7 条）：成人模式中的消息、带「健康」标记的消息。它们**照常显示勾选框**（因为收藏、删除不受限）；选中的消息里只要有一条这类消息，「分享图」按钮显示为禁用态，点击 Toast 文字型「成人模式 / 健康相关的消息不能生成分享图」（PRD 要求说明原因，不静默丢掉）。从「分享图」入口进入的多选（例如收藏页「选择」）中，这类消息**不显示勾选框**。判断依据是服务器下发的消息标记（`scope`、`labels`，`docs/architecture/health-data.md` 第 5 节），客户端不自行猜测；服务器的拒绝才是真正的闸门。
- 选择超过 P-24 条时：「分享图」按钮禁用，点击轻提示「一张分享图最多 30 条消息」（数值引用 P-24，界面文案由前端读取参数）。两种禁用原因同时存在时，提示成人模式 / 健康的原因。

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
- 用于：角色广场分类（明星 / 虚构角色 / 历史人物）、花费统计页按天 / 角色 / 用途；v2.1 增加：「我发布的」作品 / 消息。（「可以不选」的选项组，如经期记录的流量、痛感，用 ChoiceChip 19.3，不用本组件：本组件总有一项被选中。）

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
- 只用于需要用户明确确认的事：删除角色、换模型提醒（MDL-06）、注销、删除并退出群聊、「全部改为默认值」（SVC-01 第 4 条）、拨打时余额不足（MDL-10 第 5 条，这是用户主动拨打后的反馈，不是聊天中主动弹出）。v2.1 增加：成人模式「先选模型」（8.2）、经期日记授权确认与清空（`pages/period-diary.md`）、送养宠物（`pages/pet.md`）、广场「替换补充设定」「保留疑似私人信息」「删除作品」（`pages/persona-plaza.md`）、管理后台导出与下架（`pages/admin.md`）。**聊天过程中不主动弹出**。（v2.0 删除成人模式年龄确认，MODE-03 第 2 条。）

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
- **选择即生效**（MODE-03 第 2 条）：没有年龄确认。
- **成人模式的功能前提**（v2.1，MODE-03 第 3 条）：用户还没有在「服务 › 模型」设置成人模式模型时，点「成人」**不切换**（✓ 不移动、不出现切换提示），弹出 Dialog：标题「先选择成人模式模型」，正文「开启成人模式前，请先在『服务 › 模型』中选择成人模式模型」，按钮「取消」「去选择」（主操作）。点「去选择」推入成人模式模型选择页（`pages/billing.md` 6.1）；选好后返回原页面，用户再点一次「成人」即开启。这是用户主动操作后的反馈，不属于「聊天中主动弹窗」。
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

- 成就清单（v1.3 为 30 个）的唯一定义在 PRD GRW-06；每枚徽章的插画题材见 `pages/cards-familiarity.md` 第 5.2 节。
- **结构**：64px 圆形底座（`radius.full`）+ 内部 40px 物件插画；下方成就名（`fontSize.footnote`，最多 2 行）+ 获得日期或进度（`fontSize.caption2`、`text.tertiary`）。
- **底座颜色按分组**（`achievement.*`，两个主题相同）：相识 `meet`、聊天与通话 `chat`、群聊与朋友圈 `social`、收藏与卡片 `collect`、纪念日与熟悉度 `memorial`、互动玩法 `play`（v2.1）。
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
- **不能生成分享图的收藏**（v2.1，成人模式消息、「健康」消息，EXP-01 第 6 条）：顶部行右侧加 Tag 中性型「不能生成分享图」（前置 12px 锁形图标）；长按 ActionSheet 不出现「生成分享图」；收藏页「选择」（为生成分享图而多选）时不显示勾选框。卡片内容照常显示（收藏是给自己看的）。

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
- **余额为负数**（v2.1，安全优先透支，MDL-10 第 6 条；透支上限的唯一定义在 `docs/architecture/billing.md` 6.6 节）：值显示为「−¥ 0.03」——负号用数学减号「−」（U+2212，与等宽数字同宽，避免短横线「-」太细看不清），紧贴「¥」前；颜色、字号不变（仍为 `text.onBrand`，**不用红色**，不制造焦虑）；同时满足「低于 P-32」，所以照常显示「余额不足」和红点。最长形态「−¥ 2.15」在 320px 宽屏幕的半格内放得下（title3 约 7 个字宽）。
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
- 金额保留 2 位小数；余额为负（安全优先情况，MDL-10 第 6 条）显示「−¥ 0.03」（负号规则同 16.1），颜色仍为 `text.primary`；Tag「余额不足」照常显示；说明文字改为两行：「如需增加余额，请联系管理员」+「余额为负数时，下次加余额会先补上这部分」（`fontSize.footnote`、`text.tertiary`）。**不出现**「透支」「安全」等字样：负数只在用户发出高危信号时才可能出现，界面不能让人联想到安全关怀被触发（SAFE-06「界面无任何变化」）。

### 16.4 LedgerRow 余额明细行（MDL-08）

```
[类型图标]  杨幂 · 聊天                       −0.4120
            共 46 次 · 模型 X                余额 12.3400
```

- 左：40px 圆形底（类型对应 `tint.*` 16% 叠加）+ 20px 类型图标（同色）：聊天 = 气泡（blue）、后台 = 月亮（lilac）、识图 = 眼睛（teal）、语音 = 声波（orange）、图片 = 画框（pink）、导入 = 文档（gray）、管理员加余额 = 加号（teal）、管理员扣减 = 减号（gray）、退还 = 回旋箭头（teal）；v2.1 增加：安全 = 盾牌（gray，用途分组 `safety`）、行为规划 = 路线（`path` 图标，blue，用途分组 `planning`，PLAN-03 第 4 条）。分组对照以 `docs/architecture/billing.md` 5.2 节为准。
- 「安全」类记录的文字只写「安全」，第二行「共 N 次」，不显示是否动用了透支（透支标记只在管理后台可见，`billing.md` 6.6 第 4 条）。
- 中：第一行标题（`fontSize.body`，单行）：「角色名 · 类型」，无角色时只写类型（「管理员加余额」）；第二行（`fontSize.caption1`、`text.secondary`）：合并行写「共 N 次 · 模型名」，管理员记录写备注，退还写「调用失败退还」。
- 右：金额（`fontSize.body`、`fontFamily.numeric`、等宽）：「+」用 `amount.income`，「−」用 `amount.expense`；下方「余额 12.3400」（`fontSize.caption1`、`text.tertiary`）。单条最多 4 位小数，不足 0.0001 显示「< 0.0001」。变动后余额为负时写「余额 −0.0300」（同色，不标红）。
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

## 18. 人设广场（v2.1，PLZ-01～PLZ-07）

页面怎么组合见 `pages/persona-plaza.md`。

### 18.1 WorkRow 作品行（PLZ-01 第 2 条）

```
[头像48] 更黏人的杨幂  [预设改版 · 基于 杨幂]
         下雨天会给你打电话的那种黏人            ← 一句话介绍
         小鱼 · 赞 128 · 添加 56            已添加
```

- 由 CharacterRow（9.1）扩展：头像 48（显示规则见 `pages/persona-plaza.md` 第 2.3 节）；第一行名字（`fontSize.body`、`fontWeight.medium`，单行省略）+ 类型 Tag（中性型：「原创」「虚构」「真人」；品牌型：「预设改版 · 基于 XX」，XX 超过 4 字省略）；第二行一句话介绍（`fontSize.footnote`、`text.secondary`，单行）；第三行元信息（`fontSize.caption1`、`text.tertiary`）：作者广场昵称 · 赞 N · 添加 N（数字过万写「1.2 万」）。
- 右侧：我已添加或应用过时显示「已添加」（`text.tertiary` 文字），否则不显示按钮（广场作品必须进作品页看完内容再拿走，不提供行内「添加」）。
- **行高固定 88**（三行文字），便于虚拟滚动；改编作品不在行内显示「改编自」，只在作品页显示。
- 「我发布的」列表中的变体：右侧换成状态 Tag（「展示中」品牌型 / 「已下架」中性型 / 「被管理员下架」`status.warningSoft` 底 + `status.warningText` 字）+ 有新点赞、评论时 Badge 红点。

### 18.2 WorkHeader 作品页头部

- 居中：头像 64 → 名字（`fontSize.title2`、`fontWeight.semibold`）→ 类型 Tag 行 → 一句话介绍（`fontSize.subhead`、`text.secondary`）→ 作者行「[头像 20] 小鱼 ›」（`fontSize.footnote`、`text.link`，点击 → 作者页）→ 「版本 3 · 10 月 5 日更新」（`fontSize.caption1`、`text.tertiary`，点击 → 版本记录弹层）。
- 改编作品：作者行下方加一行「改编自《原作品名》· 原作者 XX」（`fontSize.caption1`、`text.secondary`，原作品仍在广场时可点，不可删除，PLZ-04 第 6 条）。
- `bg.surface` 白块，上下内边距 `space.7`。

### 18.3 ContentPreview 发布内容预览

- 用于作品页「将要复制给你的内容」和发布确认页。分组列表：每组一个小标题（SectionHeader）+ 正文块（`bg.surface`、内边距 `space.5`、`fontSize.callout`、`lineHeight.relaxed`）。
- 长文本（人设描述、改版设定）默认显示 6 行，超出显示「展开」文字按钮（用户主动操作，允许改变高度）。
- 示例对话：每句一行「角色：……」「用户：……」，说话人 `fontWeight.medium`。
- 被遮盖的私人信息片段显示为 PrivacyMask（18.4）的「已遮盖」态。

### 18.4 PrivacyMask 疑似私人信息片段（PLZ-02 第 6 条）

- **已遮盖**（默认，也是其他用户看到的样子）：片段替换为「▢▢▢」（方块数 = 原文字数，最多 6 个），`bubble.quoteBg` 底、`radius.xs`、`text.tertiary` 色，行内显示。
- **作者在确认页看到的待处理态**：原文照常显示但加 `status.warningSoft` 底 + 1px `status.warning` 下划线（静态），右上角小号序号「①」；同一片段在确认页顶部的「需要你确认」列表里有对应一行（见 `pages/persona-plaza.md` 4.4）。
- **作者已确认保留**：去掉底色，只留 1px 虚线下划线 `border.strong`，表示「这处是我确认过的」。
- 只在发布流程和作品页出现；聊天、资料页等其他地方没有这个样式。

### 18.5 CommentItem 广场评论（PLZ-03）

- 结构：头像 32（评论者广场头像）→ 右侧：第一行广场昵称（`fontSize.footnote`、`text.nameInMoments`）+ 作者本人加 Tag 品牌型「作者」；第二行内容（`fontSize.callout`）；回复显示为「回复 XX：内容」，「XX」用 `text.nameInMoments`（一层，与朋友圈评论一致，C 10.1）；第三行时间（`fontSize.caption1`、`text.tertiary`）。
- 评论之间 0.5px `border.hairline`（从文字起始处开始）。
- 点评论 → 底部输入栏占位变为「回复 XX」；长按 → ActionSheet：回复、复制、删除（自己的评论，或作者在自己作品下）、举报（别人的评论；已举报过显示禁用的「已举报」）。
- 被删除的评论直接消失，不留「该评论已删除」。
- **没有**点评论者头像进入任何个人页的交互（PLZ-03 第 6 条：用户之间只有点赞和评论）。头像点击无反应。

### 18.6 WorkActionBar 作品页底部操作栏

- 固定在页面底部（吃掉安全区），`bg.surface` + 顶部 0.5px `border.hairline`，高 56 + 安全区。
- 左：点赞按钮（Phosphor `thumbs-up`，24px；未赞 `text.secondary`、已赞 `brand.primary` 填充图标 + 数字，`fontSize.subhead`、等宽）；点赞动效 M-18。**不用爱心**（与成就 18 号「不用爱心」同理，避免恋爱联想）。
- 中：评论按钮（`chat-circle` + 数字），点击滚动到评论区并聚焦评论输入。
- 右：动作按钮，按作品类型：
  - 自定义角色：主按钮 md「添加为我的角色」；
  - 预设改版：主按钮 md「应用到我的 杨幂」（未添加该预设角色时为「添加 杨幂 并应用」）+ 左侧次级按钮 md「添加为新角色」。
  - 我自己的作品：主按钮换为次级按钮「管理」→ ActionSheet（`pages/persona-plaza.md` 第 5 节）。
- 已添加过：按钮文字不变，点击时先给提示（PLZ-04 第 5 条，见页面说明）。

### 18.7 SourceNote 来源标注（PLZ-04 第 4 条）

- 一行 ListCell 只读变体：左 16 图标（`storefront`，`text.secondary`）+「来自人设广场 · 作者 小鱼 · 版本 3」（`fontSize.footnote`、`text.secondary`）+ 右侧 ›（作品仍在广场时）。作品已下架 / 删除：没有 ›，不可点；作者已注销：作者显示「已注销用户」（PLZ-06 第 4 条）。
- 改编作品发布后，自己作品页的「改编自」同样用 18.2 的那一行，不用本组件。

---

## 19. 互动玩法（v2.1，PLAY-01～PLAY-07）

页面怎么组合见 `pages/period-diary.md`、`pages/pet.md`、`pages/play.md`。

### 19.1 PeriodCalendar 经期日历（PLAY-01 第 3 条）

- 月视图，7 列（周一开头），每格宽 = 内容宽 / 7、高 44；顶部「2026 年 10 月」+ 左右切月箭头（`fontSize.headline`）；星期行 `fontSize.caption1`、`text.tertiary`。
- 日期数字 `fontSize.subhead`、等宽，居中在 32px 圆内：

  | 状态 | 样式 |
  |---|---|
  | 已记录的经期日 | 32 圆实心，`tint.pink`，数字 `text.onBrand` |
  | 预测的经期日 | 32 圆，1.5px **虚线**描边 `tint.pink`，数字 `tint.pink`（静态虚线，不做动画） |
  | 有当天记录（痛感、症状） | 数字下方 4px 圆点，`text.tertiary` |
  | 今天 | 数字 `fontWeight.bold` + 下方「今天」（`fontSize.caption2`） |
  | 未来日期 | 数字 `text.placeholder`，不可点 |

- 日历下方固定图例一行：「● 已记录  ◌ 预测（仅供参考）」（`fontSize.caption1`、`text.secondary`）。**「仅供参考」必须出现在每处预测旁**（PLAY-01 验收）。
- 用 `tint.pink` 而不用红色：红色在本系统只表示「需要注意」（`brand.md` 3.3）；`tint.pink` 两个主题相同。
- 点某一天 → 推入该天的记录页。切月：左右滑动或点箭头，月份内容 translateX 切换（`duration.base`）。

### 19.2 PeriodStatusCard 经期状态卡

- `bg.surface`、`radius.md`、内边距 `space.6`，页面左右外边距 `space.3`；无阴影。
- 内容三种：
  - 经期中：大字「经期第 2 天」（`fontSize.title2`、`fontWeight.semibold`）+「预计还有 3 天 · 仅供参考」（`fontSize.footnote`、`text.secondary`）+ 按钮行：主按钮 md「记录今天」、次级按钮 md「经期结束了」。
  - 不在经期：「距下次预计还有 12 天」+「预计 10 月 17 日开始 · 仅供参考」+ 按钮行：主按钮 md「经期开始了」、次级按钮 md「记录今天」。
  - 记录不足 / 不规律：第二行改为「记录较少 / 不规律，预测可能不准」（PLAY-01 边界情况）。
- 不使用倒计时动画、不用进度环（不制造期待焦虑，同 `cards-familiarity.md` 第 4 节）。

### 19.3 ChoiceChip 选项片

- 高 32、`radius.full`、左右内边距 `space.4`、`fontSize.subhead`；未选：`bg.page` 底 + `text.primary`；选中：`brand.soft` 底 + `brand.onSoft` 字 + `fontWeight.medium`（瞬间切换）。
- 一组横排，自动换行，间距 `space.3`。分单选组（再点一次已选的 = 取消选择，可以不选）和多选组两种。
- 用于：经期记录的流量、痛感（单选）、症状标签（多选）；TA 的提醒的重复方式；心愿、提醒的快捷文案；专注时长；人设广场举报原因不用它（用 ListCell 选择型）。

### 19.4 PetStage 宠物形象区（PLAY-02 第 5 条）

- 宽 = 页面宽，高 = 宽 × 0.75；背景为宠物图鉴提供的**静态场景图**（无场景图时 `brand.soft` 纯色 + 品牌星星纹样）；宠物图片居中偏下，边长 = 宽 × 0.56，透明底 PNG / WebP（规格见 `pages/pet.md` 第 7 节）。
- 右上角 Tag 品牌型「幼年 / 少年 / 成年」。
- 互动反应：宠物图片 M-19；反应小字气泡（`bg.elevated` + `shadow.sm`、`radius.md`、`fontSize.footnote`，如「呼噜呼噜～」，文案为预置随机，不调用模型）出现在宠物右上方 1.5 秒后淡出。
- 只放一张静态图，不做逐帧动画、不做呼吸循环（R7：循环动画越少越好）。

### 19.5 PetActionButton 照顾按钮

- 三个等宽按钮一行（喂食 / 玩耍 / 摸摸）：每个 = 56px 圆（`bg.surface` + 0.5px `border.strong`）内 28 图标（Phosphor `fish`、`tennis-ball`、`hand-palm`；不用带爱心的图标）+ 下方文字（`fontSize.caption1`）。
- 按下：圆 scale 0.92（`duration.instant`），松开回弹；触发 PetStage 的 M-19。
- 每次点击都有反应；当天计亲密值的次数用完后（P-39）照常有反应，只是数字不再增加，**界面不提示「今天已达上限」「明天再来」**（不催促、不打卡，PLAY-02 第 8 条）。

### 19.6 GrowthSteps 成长阶段

- 三段横向步骤：幼年 · 少年 · 成年；圆点 12px，已到达 `brand.primary` 实心，未到达 `border.strong` 描边；圆点间连线 2px（已走过 `brand.primary`、未走过 `border.strong`，静态）。
- 下方说明（`fontSize.caption1`、`text.secondary`）：「第 30 天长成少年 · 第 100 天长成成年」（数字读 P-39），已到成年为「已经长大啦」。只是信息，不是倒计时。

### 19.7 WishItem 心愿行（PLAY-04）

- 左：22px 圆形勾选框（同 5.6 样式，选中 = 已完成）；中：心愿文字（`fontSize.body`，完成后 `text.tertiary` + 静态删除线）+ 可选第二行（`fontSize.caption1`）：日期 Tag 品牌型「10 月 20 日 · 约定」、来源「TA 提议」（`text.tertiary`）；右：›。
- 行高最小 `size.settingRow`。点勾选框 = 完成 / 取消完成；点其他区域 → 编辑弹层。
- 完成时勾选框 scale 0.6 → 1（`duration.fast`，`easing.spring`）；文字变灰和删除线**瞬间**切换（不做颜色过渡，R3）。

### 19.8 QuestionCard 每日一问（PLAY-03）

- `bg.surface`、`radius.md`、内边距 `space.6`：顶部「10 月 5 日 · 今天的问题」（`fontSize.caption1`、`text.tertiary`）→ 问题（`fontSize.title3`、`fontWeight.semibold`，最多 3 行）。
- 下方两个答案块（`bubble.quoteBg` 底、`radius.sm`、内边距 `space.4`）：「我的回答」「杨幂 的回答」。
- TA 的答案在我答完之前：显示锁形图标 +「你答完就能看到 TA 的答案」（`fontSize.footnote`、`text.secondary`），**不用模糊遮住真实答案**（R4，且答案此时还没生成）。答完揭晓：答案块 opacity 0 → 1 + translateY 8 → 0（M-07 同参数）。

### 19.9 FocusTimer 专注计时（PLAY-06）

- 全屏覆盖页中央：TA 头像 64 → 「杨幂 陪你专注中」（`fontSize.subhead`、`text.secondary`）→ 剩余时间「18:24」（`fontSize.display`、`fontFamily.numeric`、等宽）→ 进度条（同 FamiliarityMeter 进度条规格，宽 200，填充 `brand.primary`，scaleX，每秒更新一次、不做补间）→ 说明「这段时间所有角色都不会打扰你」（`fontSize.footnote`、`text.tertiary`）。
- **没有失败态**：没有「专注失败」「中断」字样、没有红色、没有掉落类动画（PLAY-06 规则要点）。
- 离开专注页后，所有页面 NavBar 上方出现 FocusCapsule：样式同 CallCapsule（12.2），背景改 `brand.primary`，文字「专注中 18:24 · 点击返回」。通话中时 CallCapsule 优先，FocusCapsule 隐藏。

### 19.10 ReminderRow 提醒行（PLAY-07）

- 左：时间「22:30」（`fontSize.title3`、`fontFamily.numeric`）；中：第一行提醒内容（`fontSize.body`）+ 健康类加 Tag 中性型「健康」；第二行「[头像 20] 杨幂 提醒 · 每天」（`fontSize.caption1`、`text.secondary`）；右：Switch（开 / 关这条提醒）。
- 行高 72；点行（开关以外）→ 编辑页；左滑 → 删除（SwipeActions 危险色）。

---

## 20. 管理后台（v2.1，ADM-08、ADM-09，电脑浏览器）

管理后台是**电脑浏览器使用的独立网页**（`docs/architecture/prd-answers.md` 第 5 节），页面怎么组合见 `pages/admin.md`。用同一份令牌：固定**默认主题**（`data-theme` 不设），深浅模式跟随系统；不做手机布局（最小宽度 1200px，窄于此时横向滚动）。下列组件只在管理后台使用；按钮、输入框、开关、Dialog、Toast、Tag、Badge 复用前文组件。

### 20.1 AdminShell 后台框架

- 左侧导航栏宽 `size.sidebarWidth` × 0.6（216px）、`bg.surface`、右侧 0.5px `border.hairline`；顶部 56px 区放 logo（`share.logo`）+「微伴管理后台」（`fontSize.headline`）；下方菜单项高 40、左右内边距 `space.5`、24 图标 + 文字（`fontSize.subhead`）；选中项 `brand.soft` 底 + `brand.onSoft` 字；菜单分组标题 SectionHeader 样式。
- 右侧内容区背景 `bg.page`；顶部 56px 页头（`bg.surface`、底部 hairline）：左页面标题（`fontSize.title3`、`fontWeight.semibold`）、右侧管理员名字 + 退出。内容区内边距 `space.7`，内容最大宽 1440px。
- 菜单（按 ADM 章节）：角色库、关系网、公开动态、素材库、模型与价目、用户与余额、**用量与费用**（ADM-08）、**人设广场**（ADM-09，右侧 Badge 数字 = 待处理举报数）、审计记录。

### 20.2 FilterPanel 筛选面板

- `bg.surface`、`radius.md`、内边距 `space.5`；一行或两行排列的筛选项，每项 = 标签（`fontSize.footnote`、`text.secondary`）+ 控件（高 36，`bg.inputField`，0.5px `border.strong`，`radius.sm`，`fontSize.subhead`）。
- 控件类型：时间范围（快捷 ChoiceChip「今天 / 近 7 天 / 近 30 天 / 本月」+ 起止日期时间选择，精确到小时）、可搜索多选（输入名字出候选，已选项为可删除的 Tag 品牌型）、下拉单选 / 多选。
- 右下角：次级按钮 md「重置」+ 主按钮 md「查询」。筛选条件写进页面网址（便于收藏和回到原状态），**网址里只有 ID，不放用户名**。

### 20.3 StatTile 汇总数字块

- 一行 4–6 个等宽块，间距 `space.4`；每块 `bg.surface`、`radius.md`、内边距 `space.5`：标签（`fontSize.footnote`、`text.secondary`）→ 数值（`fontSize.title2`、`fontFamily.numeric`、等宽、`fontWeight.semibold`）→ 可选副行（`fontSize.caption1`、`text.tertiary`，如「其中估算 3.2%」）。
- 不做环比箭头、不做红绿涨跌色（这是对账工具，不是运营看板）。

### 20.4 DataTable 数据表

- `bg.surface`、`radius.md`；表头行高 40、`fontSize.footnote`、`text.secondary`、`fontWeight.medium`，**吸顶**；数据行高 44、`fontSize.subhead`；行间 0.5px `border.hairline`；悬停行叠加 `bg.pressed`。
- 数字列右对齐、`fontFamily.numeric` 等宽；金额列统一 4 位小数（与 LedgerRow 一致）、token 列千分位。文字列左对齐，超长省略，悬停显示完整内容。
- 可排序列表头带 ↕，当前排序列显示 ↑ / ↓（`brand.primary`）。
- **合计行**：固定在表格底部（吸底），`bg.page` 底、`fontWeight.semibold`，左侧写「合计（筛选范围内）」。
- 分页：底部右侧「共 1,234 条 · 每页 50 · ‹ 1 2 3 … ›」；也支持「加载更多」。列表超过 200 行时用虚拟滚动。
- 空：表格区域内居中 EmptyState（无插画）「没有符合条件的记录」；加载：行内 Skeleton（同 6.13）；出错：表格区域内一行 `status.dangerSoft` 横条「查询失败：原因」+「重试」文字按钮。
- 可点击的行右侧带 ›，整行可点。

### 20.5 TrendChart 趋势折线图

- 高 240，`bg.surface`、`radius.md`、内边距 `space.5`；**一次只画一条线**：右上角 SegmentedControl「费用 | token」切换（费用视图可再选「用户扣费 / 平台成本」）。
- 线 2px `brand.primary`；数据点 4px 圆，只在悬停时显示；网格线 0.5px `border.hairline`，只画水平线；坐标文字 `fontSize.caption2`、`text.tertiary`；横轴按天（北京时间，标注「北京时间」）。
- 悬停：竖向参考线 + 提示框（`bg.elevated` + `shadow.sm`、`radius.sm`）显示当天数值。
- 只有一组数据，不做图例；切换视图时线条直接重画，不做过渡动画。
- 实现前由 Web 负责人按 `dataviz` 等图表规范核对可读性；本节只定外观约束。

### 20.6 RankList 排行小表

- 三列并排的小卡片（`bg.surface`、`radius.md`），标题「费用最高的用户 / 角色 / 模型」；每行：名次（`fontFamily.numeric`、`text.tertiary`）+ 名字 + 右侧金额（等宽、右对齐）+ 同色系占比条（高 4、`brand.soft` 底、`brand.primary` 填充，scaleX 静态）。最多 10 行。点行 = 把该项加入筛选。

### 20.7 DetailDrawer 详情抽屉

- 从右侧滑入的面板，宽 560，`bg.elevated` + `shadow.lg`，背后 `bg.scrim`；translateX 100% → 0（`duration.base`，M-03 的横向版本）。
- 顶部标题 + × 关闭；内容为只读字段列表（标签 `fontSize.footnote`、`text.secondary`，值 `fontSize.subhead`），可含一个 DataTable。
- 用于：用量明细中某一次调用的完整字段、广场作品的某个版本内容、举报详情。

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
| 成就徽章（v2.1 为 30 枚） | 9.6、`pages/cards-familiarity.md` 5.2 |
| 情景模式标识 | 8.1 |
| 服务页顶部卡片、服务宫格 | 16.1、16.2 |
| 余额、明细、价目、档位、后台预算 | 16.3–16.8 |
| 总览行、主题预览卡 | 16.9、16.10 |
| 聊天信息页（私聊、群聊） | 17 |
| 「我」页菜单行 | 3.6 |
| 顶部分页（v2.1） | 1.5 |
| 人设广场：作品行、作品页头部、内容预览、隐私遮盖、评论、操作栏、来源标注（v2.1） | 18 |
| 经期日历与状态卡、选项片、宠物形象区与照顾按钮、成长阶段、心愿行、每日一问卡、专注计时、提醒行（v2.1） | 19 |
| 信件消息、带 3 个快捷按钮的消息（v2.1） | 4.2 |
| 管理后台框架、筛选面板、汇总数字、数据表、趋势图、排行小表、详情抽屉（v2.1） | 20 |
