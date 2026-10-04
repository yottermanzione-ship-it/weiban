# 动效规范与性能符合性

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-006（v1.0）、T-012（v2.0：补安卓 Compose 对应写法） |
| 日期 | 2026-10-04 |
| 依据 | ADR-0001 第 5 条（动画只用 transform 和 opacity，聊天列表虚拟滚动，限制大面积模糊与阴影） |

> 时长、曲线的数值只在 `tokens.json` 的 `motion` 中定义，本文引用令牌名。

## 1. 结论

- **所有动画只改两样东西：位置/缩放（transform）和透明度（opacity）**。这两样浏览器可以交给显卡单独处理，不需要重新排版和重新上色，所以在中低端手机浏览器上也能稳定 60 帧。安卓原生客户端（Compose）遵守同一条规则，写法见第 6 节。
- 不做的事：动画改宽高、改位置坐标（top/left）、改颜色、改阴影、改模糊（filter / backdrop-filter）。
- 共 16 个动效（M-01～M-16），每个都在第 3 节逐项写了「改了什么属性、为什么不卡」。
- 系统开启「减少动态效果」时，所有位移动画改为 120ms 的淡入淡出。

通俗解释：浏览器画一帧有三步——「排版」（算每个东西多大、在哪）、「上色」（把像素画出来）、「合成」（把画好的图层叠起来）。只改 transform 和 opacity 时，只需要做最后一步「合成」，最省力；改宽高要从第一步重来，最费力。

## 2. 总规则

| # | 规则 | 理由 |
|---|---|---|
| R1 | 只动画 `transform`（translate / scale / rotate）和 `opacity` | 只触发合成 |
| R2 | 不动画 `width`、`height`、`top`、`left`、`margin`、`padding`、`font-size` | 会触发重新排版，聊天列表里一条变化会连带整列重排 |
| R3 | 不动画 `color`、`background-color`、`box-shadow`、`border` | 会触发重新上色。按下态改用「叠加一层半透明遮罩，改遮罩透明度」，或直接瞬间切换（不加过渡） |
| R4 | 不使用 `backdrop-filter`（毛玻璃）；`filter: blur()` 只允许用在**静态**、面积 ≤ 96×96px 的元素上 | 毛玻璃每帧都要重算背后所有像素，滚动时最容易掉帧 |
| R5 | 阴影只用 `shadow.sm/md/lg` 三档（模糊半径最大 24px），只给浮层用（菜单、弹层、对话框、悬浮摘要卡）；列表行、气泡、普通卡片不加阴影 | 大面积阴影上色成本高，且滚动时反复重绘 |
| R6 | `will-change: transform` 只在动画开始前加、结束后移除；同时存在的不超过 5 个 | 每个 will-change 元素占一块显存，常驻太多反而更卡 |
| R7 | 同一时刻最多 1 个「大动画」（页面推入、弹层、全屏）在跑；循环动画（正在输入、来电光圈）在元素离开屏幕或页面隐藏时暂停 | 控制合成层数量；隐藏页不浪费电 |
| R8 | 动画不改变元素占位：进入/离开动画期间，元素的布局尺寸始终是最终尺寸（用 transform 做出「从小变大」的效果） | 虚拟滚动依赖每条消息的高度稳定，高度一变就会跳动 |
| R9 | 所有过渡时长 ≤ `motion.duration.slow`；循环动画除外 | 动效是辅助，不让用户等 |
| R10 | 列表滚动本身不加任何动画；不做视差滚动 | 滚动是最频繁的操作，越干净越流畅 |

## 3. 动效清单（逐项性能说明）

| 编号 | 动效 | 表现 | 时长 / 曲线 | 改变的属性 | 符合性说明 |
|---|---|---|---|---|---|
| M-01 | 页面推入 / 返回 | 新页从右向左滑入（translateX 100% → 0）；旧页同时向左移 30% 并被一层黑色遮罩盖暗（遮罩 opacity 0 → 0.08）。返回反向 | `duration.page` / 进入 `easing.decelerate`，返回 `easing.standard` | 新页、旧页 transform；遮罩 opacity | 只合成；遮罩是独立元素，不给旧页加 filter 变暗。旧页向左移而不是缩放，避免文字缩放时的重新栅格化 |
| M-02 | iPhone 左边缘右滑返回 | 手指拖动时页面跟手 translateX；松手后超过 1/3 宽度或速度够快则完成返回，否则弹回 | 跟手无曲线；松手后 `duration.base` / `easing.standard` | transform、遮罩 opacity | 同 M-01；拖动中用 requestAnimationFrame 更新，不触发排版 |
| M-03 | 底部弹层 | 弹层 translateY 100% → 0；遮罩 opacity 0 → 1。关闭反向，关闭用 `easing.accelerate` | `duration.base` / `easing.decelerate` | transform、opacity | 遮罩是纯色半透明（`bg.scrim`），**不用毛玻璃** |
| M-04 | 对话框 | scale 0.94 → 1 + opacity 0 → 1；遮罩淡入 | `duration.base` / `easing.decelerate` | transform、opacity | 同上 |
| M-05 | 长按消息菜单 | 菜单从气泡方向 scale 0.9 → 1 + opacity 0 → 1，变换原点在箭头处；被长按的气泡上叠一层遮罩 opacity 0 → 1（表示选中） | `duration.fast` / `easing.decelerate` | transform、opacity | 气泡本身不变色，选中效果靠叠加层透明度 |
| M-06 | 轻提示（Toast） | 中部轻提示：opacity 0 → 1 + scale 0.96 → 1，停留 2 秒后淡出；成就提示：从顶部 translateY(-100%) → 0 | 进 `duration.fast`，出 `duration.fast` / `easing.standard` | transform、opacity | 浮层，只合成 |
| M-07 | 新消息气泡出现 | opacity 0 → 1 + translateY 8px → 0 + scale 0.98 → 1；自己的消息从右下、角色的从左下（变换原点在头像一侧）。拆条时每条依次出现 | `duration.fast` / `easing.decelerate` | transform、opacity | 气泡一开始就以最终尺寸占位（R8），虚拟列表高度不跳动；历史消息、翻页加载的消息**不播放**此动画 |
| M-08 | 正在输入 | 标题下方小字「对方正在输入…」中三个点依次上下跳（translateY 0 → -2px → 0）并改透明度（0.4 → 1） | `duration.typingCycle` 一轮 / `easing.linear` 循环 | transform、opacity | 标题文字切换「角色名 ↔ 正在输入」用 opacity 交叉淡入，两段文字叠放在同一位置，不改布局 |
| M-09 | 发送中 / 失败 | 发送中：气泡左侧小圈 rotate 360° 循环；失败：红色感叹号 scale 0.6 → 1 | 转圈 800ms 线性循环；感叹号 `duration.fast` / `easing.spring` | transform | 转圈元素 16px，开销可忽略；发送超过 1 秒才显示转圈（避免一闪而过） |
| M-10 | 拍一拍 | 被拍的头像 rotate -8° → 8° → 0 抖一下（两次）；系统提示「你拍了拍 XX」按 M-07 出现 | 360ms / `easing.spring` | transform | 头像独立合成；只在当前可见时播放 |
| M-11 | 「你不在时」摘要卡 | 进入私聊时从导航栏下方 translateY(-12px) → 0 + opacity 0 → 1；收起时缩为右上角小胶囊：卡片 scale 向右上角缩小 + 淡出，同时小胶囊淡入 | `duration.base` / 进 `easing.decelerate`，收 `easing.accelerate` | transform、opacity | 摘要卡是**悬浮层**，不在消息列表里，收起时消息列表不重排（详见 `pages/while-away-timeline.md`） |
| M-12 | 系统横条出现 / 消失 | 横条 opacity 0 → 1 + translateY(-8px) → 0 | `duration.fast` / `easing.standard` | transform、opacity | 横条为**悬浮在消息区顶部**的层，不推挤消息列表（消息列表顶部预留横条高度的内边距，在横条出现时**瞬间**设置，不做动画） |
| M-13 | 获得卡片 / 熟悉度升级 | 卡片从中心 scale 0.6 → 1.04 → 1 + opacity 0 → 1，同时卡片背后 6–8 个小星星向外 translate + 淡出（一次性，不循环） | `duration.slow` / `easing.spring` | transform、opacity | 星星是预先画好的小 SVG（≤ 12px），共不超过 8 个；**不用**光晕模糊和流光渐变动画 |
| M-14 | 熟悉度进度条 | 进度变化时：进度条内层 scaleX 从旧值过渡到新值（变换原点在左侧） | `duration.slow` / `easing.standard` | transform | 用 scaleX 代替改宽度；圆形熟悉度环用 SVG `stroke-dashoffset`——**例外说明**：它会触发重绘，但只限 64px 的小 SVG、只在资料页打开和升级时播放一次，可接受 |
| M-15 | 来电光圈 | 头像周围 3 圈同心圆依次 scale 1 → 1.6 + opacity 0.5 → 0，循环 | `duration.ringCycle` 一轮 / `easing.decelerate` 循环 | transform、opacity | 通话页背景是**静态渐变**（`call.bgTop` → `call.bgBottom`），不用头像模糊做背景；离开来电页立即停止 |
| M-16 | 会话行左滑 | 行内容跟手 translateX，露出右侧按钮；松手吸附到打开（-按钮总宽）或关闭（0） | 跟手；吸附 `duration.base` / `easing.standard` | transform | 按钮区固定在行底层，不随滑动改变宽度 |

### 不做的动效（及原因）

| 不做 | 原因 |
|---|---|
| 毛玻璃导航栏 / 弹层 | 违反 R4；导航栏用实色 `bg.navBar` |
| 气泡背景渐变流动、霓虹光效 | 违反 R3，且风格过于喧闹 |
| 列表项入场依次飞入 | 虚拟滚动下会让新进入可视区的行反复播放，造成闪烁 |
| 下拉刷新弹性橡皮筋（自定义） | 使用浏览器 / 系统原生的回弹即可 |
| 卡片 3D 翻转（rotateY） | 卡片正反面切换改为交叉淡入：3D 翻转需要两面同时保持合成层，且在部分低端机浏览器上有闪烁问题 |
| 全屏飘落爱心、彩带 | 低端机掉帧；也和「不恋爱化」「克制」冲突 |

## 4. 减少动态效果（无障碍）

系统设置开启「减少动态效果」时（CSS 媒体查询 `prefers-reduced-motion: reduce`，`tokens.css` 已处理时长）：
- 所有 translate、scale、rotate 动画改为纯透明度淡入淡出，时长 120ms；
- 循环动画：正在输入改为静态「…」文字，来电光圈改为静态的两圈细线；
- M-13 获得卡片：只淡入卡片，不放小星星。

## 5. 给 Web 负责人的检查方法

1. Chrome 开发者工具 → Performance 面板录制每个动效，确认没有紫色「Layout（排版）」块、绿色「Paint（上色）」块极少（M-14 圆环除外）。
2. 打开 Rendering → Paint flashing，滚动聊天列表和会话列表，屏幕上不应大面积闪绿。
3. 在一台中低端手机（建议 2020 年前后的千元机）的浏览器中，滚动 1000 条消息的私聊和 100 个会话的列表，帧率记录在 `docs/web/` 的性能检查记录中。

## 6. 安卓 Compose 的对应写法（给 Android 负责人）

规则 R1–R10 对安卓同样适用。Compose 里「只合成、不重排、不重画」的对应做法：

| 网页 | Compose | 不要这样做 |
|---|---|---|
| `transform: translate / scale / rotate` | `Modifier.graphicsLayer { translationX / scaleX / rotationZ }`，配合 `animateFloatAsState` / `Animatable` | 用 `Modifier.offset(x = 动画值.dp)`、`Modifier.size(动画值)`、`padding(动画值)`：会触发重新测量和布局 |
| `opacity` | `graphicsLayer { alpha = … }` | `Modifier.alpha` 在动画中可以用（内部也是图层），但不要在列表每一行常驻 |
| 不动画颜色（R3） | 两层叠放、改上层 alpha；或瞬间切换 | `animateColorAsState` 用于大面积背景、按钮底色 |
| 不用毛玻璃（R4） | 不用 `Modifier.blur` 做背景模糊 | `RenderEffect` 模糊 |
| 阴影只给浮层（R5） | `Modifier.shadow(WbElevation.*)` 只用于菜单、弹层、对话框、悬浮摘要卡 | 列表行、气泡加 elevation |
| 虚拟滚动、高度稳定（R8） | `LazyColumn` + 稳定 `key` + `contentType`；新消息出现动画用 `graphicsLayer`，不用 `animateItem` 的高度动画 | `AnimatedVisibility` 的 expand / shrink（会改高度）用在消息列表里 |
| 曲线、时长 | `WbMotion.Standard` 等 `CubicBezierEasing`、`WbMotion.FastMs` 等（`tokens-android.md`） | 自己写数值 |
| 页面推入（M-01） | 导航动画用 slide（`slideInHorizontally` 本质是图层位移）+ 遮罩 alpha | 用 `AnimatedContent` 的 `SizeTransform` |
| 减少动态效果 | 读取系统「移除动画」设置（`Settings.Global.ANIMATOR_DURATION_SCALE == 0`），改为 120ms 淡入淡出 | — |

检查方法：Android Studio 的 Layout Inspector 看重组次数（动画期间列表行不应持续重组）；开发者选项「GPU 呈现模式分析」滚动 1000 条消息的私聊和 100 个会话的列表，帧率记录在 `docs/android/`。
