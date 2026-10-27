# 用户端公共 UI 组件说明

> 2026-10-26 批 U1 建立、批 U2 补充表单选择框 / 页内二级页面 / 分段 Tab 与「确认与删除」统一规则，批 U5 补充看图 / 只读整页 / 贴键盘输入条 / 返回键只关一层 / 质感细节规则，批 U7 补充页签不加粗 / 通栏 / 白底页 / 名字与表情对齐（任务卡 `docs/tasks/2026-10-26-ui-quality.md`，规则来源 `docs/refactor/26-ui-quality-plan.md` §2 §5）。
> 新页面一律从 `apps/web/src/features/ui.ts` 引入这些组件，不再自己手写弹窗、确认块、原生日期框。
> 组件效果图（浅色 / 深色）：`C:\wb-dev\logs\ui-u1\after\gallery\`。

## 一、设计令牌

| 层 | 文件 | 谁改 |
|---|---|---|
| 全量令牌 | `docs/design/tokens.css`（由 `tokens.json` 生成） | 设计负责人，网页不手改 |
| 网页收口 + 补充 | `apps/web/src/app/tokens.css` | Web 负责人 |

样式文件只写 `var(--wb-*)` / `var(--ui-*)`，不写裸的圆角、颜色、字重；需要新数值先加进 `app/tokens.css`。

- **圆角只三档**：`--wb-radius-xs` 4px（标签、缩略图、输入框、头像、顶栏小按钮）、`--wb-radius-md` 8px（按钮、气泡、卡片里的块）、`--wb-radius-lg` 12px（卡片、弹层、底部面板顶边）；另有 `--wb-radius-full`（圆点、胶囊、角标）和品牌图标形状 `--ui-radius-app-icon`。旧名 `--wb-radius-sm`（原 6px）、`--wb-radius-xl`（原 14px）已收进 4 / 12，新样式不要再用。外圆角 = 内圆角 + 间距。
- **颜色**：沿用第 1 层语义色；网页补充了按钮语气（`--ui-button-*`、`--ui-text-action`）、浅灰分层（`--ui-fill-1/2/3`，深色自动换成白色半透明）、深色底上的白字层级（`--ui-on-dark-*`，状态页、下拉小程序、通话用）、固定色（`--ui-text-on-color` 等）。
- **间距 / 字号**：用第 1 层 `--wb-space-*`、`--wb-font-size-*`（字号令牌跟随「字体大小」设置缩放）。
- **字重**：`--wb-font-weight-*`。深色模式下中粗 500→400、粗 600→500、最粗 700→600（MiSans 只打包了 400 / 500 / 600 三个字形，正文 400 无法再细）。`<strong>` / `<b>` 也走中粗令牌（U5），深色一起降。不要在样式或行内 style 里写数字字重。
- **动效**：第 1 层 `--wb-motion-*`，网页补充 `--ui-motion-route`（整页推入 220ms）、`--ui-motion-dialog`（150ms）、`--ui-motion-spin`、`--ui-ease-out` / `--ui-ease-in-out`。
- **动效分性格（U5）**：新动效先归类，不另起数值——① 跟手：拖拽中不加过渡，松手吸附 / 回弹用 `--ui-motion-snap` + `--ui-ease-snap`（底部面板分档、左滑、看图下滑）；② 弹性：点赞、拍一拍、选中这类小回应用 `--ui-motion-pop` + `--ui-ease-spring`；③ 页面推入：路由与页内二级页面统一 `--ui-motion-route` + `--ui-ease-push`；④ 出现：新消息气泡 `--ui-motion-bubble`（120ms 淡入轻上移），「正在输入」三点一轮 `--wb-motion-duration-typing-cycle`（组件 `TypingDots`）。都在 `prefers-reduced-motion` 下关闭。
- **等宽数字（U5）**：积分、时间、计数、价格用等宽数字（`font-variant-numeric: tabular-nums`）。已有类名统一收在 `ui-components.css`「批 U5」开头的清单里，`<time>` 自动生效；新写的数字加 `className="numeric"`。
- **分层不用边框（U5）**：容器只一层；按钮、输入条、标签用浅灰底（`--ui-fill-0/1/2`，约 3% / 5% / 8%）或品牌浅底（`--wb-color-brand-soft`）区分，浮在内容上的小块用 `--ui-float-shadow`；不加类名的 `<button>` 默认浅灰底无边框。列表分隔用 0.5px 发丝线。
- **圆角同心（U5）**：外圆角 = 内圆角 + 间距（例：示例对话灰框 12 = 头像 4 + 间距 8；朋友圈「N 条新消息」12 = 头像 4 + 间距 8）。

## 二、按钮规则

| 语气 | 样子 | 写法 | 用在 |
|---|---|---|---|
| primary 主操作 | 绿底白字；不可点时灰底灰字 | `<button className="primary">` | 每屏最多一个：完成、创建角色、添加到通讯录 |
| danger 危险 | 只用红字，不用红底 | `className="danger"`；弹层里 `danger: true` / `tone: 'danger'` | 删除、清空、注销、退出登录 |
| default 普通 | 黑字 | 不加类名 | 取消、次要操作 |

- **全站没有蓝字按钮**。纯文字的肯定操作（确认框「保存草稿」、列表「加载更多」「重试」）用品牌绿字 `--ui-text-action`；蓝色只留给正文里的链接和朋友圈名字。
- 按钮文字写动作：「删除聊天」「清空聊天记录」，不写「是 / 确定」。「确定」只用于没有后果的设置确认（如滚轮选完日期）。

## 三、组件一览

| 名称 | 代码（`features/ui.ts` 导出名） | 长什么样 | 何时用 | 何时不用 |
|---|---|---|---|---|
| Toast 轻提示 | `showToast(text, ms?, kind?)`；`ToastHost` 已挂在应用里 | 屏幕正中黑底小块，默认 1.5 秒，可带 ✓ ! ✕ i | 操作后的短反馈：已保存、已复制 | 需要用户做选择、可以撤销（用 Snackbar）、表单错误（用 Inline Alert） |
| Snackbar 撤销条 | `showSnackbar({ text, onAction, onEnd, actionLabel?, durationMs? })`；`SnackbarHost` 已挂 | 底部深色条，右侧绿字「撤销」，5 秒消失；新的一条会顶掉旧的 | 能真正撤销的轻操作：不显示该聊天、取消收藏、移出分组。**用它代替二次确认** | 撤销不了的操作（用 Alert Dialog） |
| Inline Alert 行内提示 | `<InlineAlert id>{message}</InlineAlert>` | 输入框下的红色小字，改对传空即消失 | 表单校验 | 不要为校验弹窗或 Toast |
| Action Sheet 动作面板 | `<ActionSheet items title? onClose cancelLabel?>` | 微信式：底部白底通栏按钮、无边框，顶部可选灰字说明，隔一条灰缝的独立「取消」；危险项红字 | 一组操作：「…」更多、长按菜单的手机版、头像来源（拍照 / 从相册选择） | 选一个值（用 Choice Sheet）；只有一个确认动作且不可撤销（用 Alert Dialog） |
| Choice Sheet 底部单选 | `<ChoiceSheet options value onChange onClose title?>` | 同 Action Sheet，选中项右侧固定列绿色对号，对号不参与文字居中；点一项即选中并关闭 | 设置里选一个值，5–10 个选项（深色模式、贴合度） | ≤5 个且页面空间够：页面里整行单选 `PickRow`；>10 个要加搜索；日期 / 时间用滚轮 |
| Bottom Sheet 半页面板 | `<BottomSheet title onClose snaps? keepOnScrim? action? closeLabel?>`（即 `shell-kit` 的 `Sheet`） | 白底、顶部圆角 12，标题栏「取消 / 标题 / 右侧操作」；传 `snaps={['half','full']}` 出现把手，可拖到半屏 / 全屏吸附，从最低档下拖关闭 | 评论区、转发选人、表情面板这类「看一眼、做一下」的内容 | 长内容、复杂编辑（用二级页面）；纯操作列表（用 Action Sheet） |
| Dialog 普通对话框 | `<Dialog title? actions onDismiss?>`，按钮 `tone: 'primary' \| 'danger' \| 'default'` | 白底圆角 12，标题 + 正文 + 底部两个等宽按钮；主按钮绿字 | 需要明确回答的中等内容：保存草稿？更新到新版本？ | 不可撤销的危险操作（用 Alert Dialog）；纯通知（用 Toast） |
| Alert Dialog 危险确认 | `<AlertDialog title message? confirmLabel onConfirm onCancel pending?>` | 同 Dialog，左「取消」黑字，右主按钮红字写清后果；**点蒙层不关闭**，Esc 等同取消 | 只在**不可撤销**时：删除好友、清空聊天记录、注销、删除作品 | 能撤销的轻操作（用 Snackbar） |
| 二级页面外壳 | `<SubPage title canSave onSave fallback doneLabel? onCancel?>`（即 `edit-page` 的 `EditPage`） | 整页推入，顶栏「取消 / 标题 / 完成」，没改动或必填为空时「完成」灰底灰字，改了才变绿 | 长内容、复杂编辑：资料编辑、自建角色各字段、长文本 | 只选一个值（Choice Sheet） |
| 滚轮选择器 | `DatePickerSheet`、`TimePickerSheet`、`OptionPickerSheet`；自己拼列用 `PickerSheet` + `WheelPicker` + `WheelColumn`；可选值传 `onClear` 出现底部「清除」 | 底部面板，顶栏「取消 / 标题 / 绿色确定」；多列滚轮，中间一行选中、上下渐隐，停手自动吸附 | 日期（生日、纪念日）、时间（提醒）、需要滑着挑的一般选项 | 浏览器原生 `<input type="date">` / `<select>` 一律不再用 |
| 表单选择框（U2） | `DateField`、`TimeField`、`SelectField`（`wheel-picker.tsx`） | 输入框外观的按钮：显示当前值（空则灰字占位）+ 右侧小箭头；放进 `.field-row` / `.profile-field` / `.edit-input-row` 自动变成无边框、值右对齐 | 表单里原来放原生 date / time / select 的地方。`SelectField` ≤10 个选项弹 Choice Sheet，更多自动用单列滚轮；`DateField clearable` 给可选日期加「清除」 | 设置页整行选值（用 `MenuRow` + Choice Sheet） |
| 页内二级页面（U2） | `SubPageLayer`（任意表单）、`FieldPage`（单字段 + 清除 + 字数）（`edit-page.tsx`） | 外观同二级页面外壳，但不开新路由：从右侧整页推入盖住当前页；Esc / 取消关闭 | 原来「底部表单弹层」的编辑：群聊名称、积分提醒线、记忆、心愿、纪念日、补充设定、申请添加朋友、提示音 | 要能分享链接 / 浏览器后退回来的独立页面（用路由 + `SubPage`） |
| 返回键只关一层（U3 写法） | 打开时往地址加 `?edit=编号`（push），关闭时自己 push 的就 `navigate(-1)`、否则 replace 去掉参数；渲染时按参数决定显示哪个 `SubPageLayer`。样板：`custom-character.tsx` 的 `openRow` / `closeEditor` | 同页内二级页面 | 一页里有多个整页编辑、希望安卓返回键 / 浏览器后退只关掉编辑层（等同「取消」） | 只有一个简单弹层时不必 |
| 字段编辑页（U3） | `LongTextPage`（大文本区 + 字数，可设最少字数）、`ListPage`（可增删条目，左红色减号、末行「添加…」）、`DialoguePage`（「我说 / TA 说」气泡，可切「按原文编辑」）、`BasisPage` / `AgePage`（`persona-editors.tsx`）；`CharacterVoicePage`（音色单选 + 试听 + >10 个出搜索，`character-voice-select.tsx`） | 都是 `SubPageLayer`：顶栏「取消 / 标题 / 完成」，编辑草稿，完成才写回 | 自建角色创建 / 编辑页各字段；用哪个由人设板块配置（`packages/client-core/src/persona-sections.ts`）决定 | 单行文字（用 `FieldPage`）；日期（用滚轮） |
| 分段 Tab（U2，U7 改样子） | `SegmentedTabs`（`shell-kit.tsx`） | 左右通栏白底、两三个等宽页签；选中只变深色 + 绿色短下划线，字重不变 | 同一页内容的两种看法：角色生态「按角色 / 按动作」 | 页面顶部的一级切换（用 `TextTabs`） |
| 人设卡（U4） | `<PersonaCard source hideHead? avatar? headAside? headExtra? intro? asides? renders? renderText?>`（`persona-card.tsx`）；数据形状用 `{ kind: 'draft' \| 'profile' \| 'plaza' \| 'legacy', data }`，角色资料可直接用 `useCharacterPersona(id)`（`character-persona.tsx`） | 头部（头像、名字、一句身份、一句话介绍、标签，右侧可放点赞评论）+ 按配置分组的白色板块，板块间 8px 灰缝、板块内无边框；正文超 5 行折叠「展开」，口头禅浅色引用块，示例对话迷你气泡（左 TA 右我），生日 / 音色 / 来源是灰字键值小行，空子板块整块不显示 | 展示一个角色的人设：广场作品详情、微伴角色详情、资料页「TA 的人设」、补充设定对照原卡。后台预览用 `PersonaCardPreview`（`apps/admin`） | 编辑人设（用创建页 + 字段编辑页）；**不要在页面里自己拼人设字段**，新字段加到配置里 |
| 全屏看图 Lightbox（U5） | `<Lightbox items index onClose menu? hint?>`（`lightbox.tsx`）；聊天里用 `ImageViewer`（`media.tsx`，内部就是 Lightbox） | 黑底全屏、左右滑切换、双指缩放 / 双击放大、下滑关闭（跟手）、单击关闭；右上「…」出 Action Sheet；挂到 body | 图片、聊天记录里的图、收藏里的图 | 不要再用底部弹层看图 |
| 只读整页 PushLayer（U5） | `<PushLayer title onClose right?>`（`edit-page.tsx`） | 从右侧整页推入，顶栏返回箭头 + 标题，挂到 body | 看内容不编辑、又不值得开路由的整页：聊天记录详情 | 要编辑（用 `SubPageLayer`）；要能分享链接（用路由） |
| 贴键盘输入条（U5） | `<KeyboardBar onDismiss label?>`（`keyboard-bar.tsx`） | 底部一条输入栏贴在键盘上方，页面不被盖住；点输入条以外收起，草稿由调用方保留 | 一句话回复：朋友圈评论 / 回复 | 多字段表单（用 `SubPageLayer`） |
| 中间省略 MiddleEllipsis（U5） | `<MiddleEllipsis text>`（`middle-ellipsis.tsx`） | 「很长的文件名…备份副本.txt」，省略号在中间，最后几个字和扩展名始终可见 | 文件名、导出名 | 普通文字（末尾省略即可） |
| 返回键只关一层（U5 通用） | `useLayerHistory(onBack)`（`layer-history.ts`）；`SubPageLayer`、`PushLayer`、`Lightbox` 已内置 | 浮层打开时往浏览器历史压一条同地址记录；安卓返回键 / 浏览器后退只关最上面一层（等同取消）；用界面按钮关掉时自动退掉那条记录，同一拍关多层合并成一次后退 | 页内浮层默认就有，不用额外写 | 页面自己已经用地址参数管二级页（自建角色 `?edit=`）时，用 `<LayerHistoryContext.Provider value={false}>` 包住，免得压两次 |

### 页签、通栏与对齐（U7）

1. **页签选中不加粗**：`TextTabs`、`SegmentedTabs`、我发布的 / 卡册（`.plaza-tabs`）、信箱（`.play-tabs`）、角色广场顶栏、表情商店，选中只换颜色 + 下划线，字重与未选中相同，切换时文字宽度不跳。
2. **左右拉齐，不要浮块**：页签条、白色列表、页面级提示条（`.inline-tip` / `.notice-bar` 作为页面直接子元素时）、卡册卡片区都左右通栏；旧式 `.rows` 列表行的行尾箭头统一灰色、贴最右。
3. **说明文字**：页面底部说明用灰色小字 `.ui-foot-note`，不用彩色提示框。
4. **块状主按钮**：链接做主按钮用 `className="button primary ui-block-button"`（文字上下左右居中；放在 `EmptyState` 里自动收窄到最小 184px）。
5. **整页白底页面**（欢迎 / 登录 / 注册、`FormPage`、`InfoPage`）调用 `useWhiteSurface()`（`data/display-prefs.ts`）：`html` / `body` 和 `theme-color` 一起变白，iPhone 顶部安全区不露灰；离开自动切回灰色。底色规则仍集中在 `common-fixes.css` 的 F1-9 段。
6. **名字 + 状态表情 / 图标**：表情用 `1.05em`（随名字字号）+ 行高 1 + inline-flex 居中，上下边与汉字墨迹对齐；行内图标按钮（星标）用 `align-self: center`，不再用 `margin-top` 微调。
7. **会话列表顶部提示条**：可关闭（右侧 ×）；只有本机真写不进时才出现「重新打开」，触发条件见 `docs/handoffs/2026-10-27-ui-u7.md`。

### 输入与浮层的细节规则（U5）

1. **中文输入法回车只选字**：全站已装 `installImeEnterGuard`（`main.tsx`），单行输入框里输入法选字的回车不会触发表单提交；自己写 `onKeyDown` 判断回车时用 `isImeEnter(event)`（同时认 Chrome 的 isComposing、keyCode 229 和 Safari「选字刚结束」），不要只看 `isComposing`。
2. **底部面板点蒙层不丢内容**：`BottomSheet` 里任何输入框有字时，点蒙层 / 下拖都不关（面板轻顿），只有「取消」/ Esc 才关；不用调用方记得传 `keepOnScrim`（搜索框不算）。
3. **聊天上翻**：往上翻就停止跟随；离底部超过一屏半出现右下「↓ 回到最新」，上翻期间对方发来新消息时变成「↓ N 条新消息」，点一下回到底部并恢复跟随；自己发消息时也自动回到底部。

### 表单选值梯度（26 号 §2）

2 个选项用开关；≤5 个用页面里的整行单选 `PickRow`；5–10 个用 Choice Sheet；>10 个加搜索；日期 / 时间用滚轮选择器。

### 确认与删除的统一规则（U2 落地）

1. **先问能不能撤销**：能用现有接口恢复的轻操作，直接做 + `showSnackbar` 撤销，不再二次确认。两种写法：
   - 先做后撤：做完再给撤销条，「撤销」调用反向接口（不显示该聊天 → `hidden: false`；移出群成员 → 拉人进群；下架作品 → 重新上架；删除纪念日 → 按原名称日期重新添加；删一条补充设定 → 用原整段设定重新保存）。
   - 延迟提交：先从界面藏起来，撤销条消失（`onEnd` 的 reason 不是 `action`）才真正调删除接口，失败就放回并 Toast（取消收藏、删除心愿）。
2. **不可撤销**（删除好友 / 角色、清空聊天记录、删除聊天、删除作品、注销、删除记忆 / 经期 / 关系 / 提醒等）一律 `AlertDialog`：标题是问句，正文写后果，右侧红字按钮写动作（「删除作品」「清空聊天记录」），点蒙层不关。
3. **非危险的确认**（授权角色知道经期、恢复聊天记录、开启私密模式、更新到新版本）用 `Dialog`，主按钮 `tone: 'primary'` 绿字，同样写动作。纯通知用 `Dialog` 单按钮「知道了」（`tone: 'primary'`）。
4. **叠层约定（V08）**：Action Sheet 里点了会弹确认的项，面板先关，确认框单独出现（不叠两层蒙层）；内容型 Bottom Sheet（情景预设列表）里的确认可以叠在面板上，取消后回到列表。
5. **一组操作**（更多、发送失败、写信离开、小程序「…」、头像来源）用 Action Sheet，危险项红字；不要在 Bottom Sheet 里放一列带边框按钮。
6. 旧写法 `primary: true` / `danger: true`（Dialog 按钮）已全部换成 `tone`；`ActionItem` 的 `danger: true` 仍是 Action Sheet 红字项的正确写法。

## 四、示例代码位置

- 组件源码：`apps/web/src/features/toast.tsx`（Toast、Snackbar、Inline Alert、Dialog、Alert Dialog）、`shell-kit.tsx`（Action Sheet、Choice Sheet、Bottom Sheet）、`edit-page.tsx`（二级页面外壳、PickRow、PushLayer）、`wheel-picker.tsx`（滚轮）、`lightbox.tsx` / `keyboard-bar.tsx` / `middle-ellipsis.tsx` / `layer-history.ts` / `ime.ts`（U5）；样式 `apps/web/src/app/ui-components.css`（U5 规则在文件末尾「批 U5」一段）。
- 已在用的例子：Choice Sheet → `settings.tsx` / `account-settings.tsx` 的深色模式、字体大小；Action Sheet → `chat-settings.tsx` 人设贴合度、`plaza.tsx` 作品更多操作、`avatar-editor.tsx` 头像来源；Alert Dialog → `chat-settings.tsx` 清空聊天记录 / 删除角色、`settings.tsx` 退出登录；Snackbar → `conversation-list.tsx` 不显示该聊天、`favorites.tsx` 取消收藏（延迟提交）；二级页面 → `profile-edit.tsx`；页内二级页面 → `memories.tsx`、`groups.tsx` 群聊名称（`FieldPage`）、`settings.tsx` 提示音；表单选择框 → `play.tsx` 提醒、`period.tsx` 周期设置；分段 Tab → `ecology.tsx`；Lightbox → `favorites.tsx` 收藏图片、`chat-forward.tsx` 聊天记录里的图；PushLayer → `chat-forward.tsx` 聊天记录详情；KeyboardBar → `moments.tsx` 评论；两层浮层一起关 → `profile-edit.tsx` 的 `RegionPickerLayer`（首次填写资料选地区）。
- 全部组件的样板写法（含每种状态）：`C:\wb-dev\logs\ui-u1\gallery.tsx`（截图用，不进仓库）。

```tsx
import { AlertDialog, showSnackbar, ChoiceSheet } from './ui.js';

// 可撤销：先做，给 5 秒撤销
await hideConversation(id);
showSnackbar({ text: '已不显示该聊天', onAction: () => unhideConversation(id) });

// 不可撤销：红字主按钮，点蒙层不关
<AlertDialog
  title="删除作品？"
  message="作品和它的点赞、评论都会删除，不能恢复。"
  confirmLabel="删除作品"
  pending={pending}
  onConfirm={remove}
  onCancel={() => setAsk(false)}
/>;
```
