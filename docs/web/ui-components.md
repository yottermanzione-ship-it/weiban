# 用户端公共 UI 组件说明

> 2026-10-26 批 U1 建立（任务卡 `docs/tasks/2026-10-26-ui-quality.md`，规则来源 `docs/refactor/26-ui-quality-plan.md` §2 §5）。
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
- **字重**：`--wb-font-weight-*`。深色模式下中粗 500→400、粗 600→500（MiSans 只打包了 400 / 500 / 600 三个字形，正文 400 无法再细）。
- **动效**：第 1 层 `--wb-motion-*`，网页补充 `--ui-motion-route`（整页推入 220ms）、`--ui-motion-dialog`（150ms）、`--ui-motion-spin`、`--ui-ease-out` / `--ui-ease-in-out`。

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
| 滚轮选择器 | `DatePickerSheet`、`TimePickerSheet`、`OptionPickerSheet`；自己拼列用 `PickerSheet` + `WheelPicker` + `WheelColumn` | 底部面板，顶栏「取消 / 标题 / 绿色确定」；多列滚轮，中间一行选中、上下渐隐，停手自动吸附 | 日期（生日、纪念日）、时间（提醒）、需要滑着挑的一般选项 | 浏览器原生 `<input type="date">` / `<select>` 一律不再用 |

### 表单选值梯度（26 号 §2）

2 个选项用开关；≤5 个用页面里的整行单选 `PickRow`；5–10 个用 Choice Sheet；>10 个加搜索；日期 / 时间用滚轮选择器。

## 四、示例代码位置

- 组件源码：`apps/web/src/features/toast.tsx`（Toast、Snackbar、Inline Alert、Dialog、Alert Dialog）、`shell-kit.tsx`（Action Sheet、Choice Sheet、Bottom Sheet）、`edit-page.tsx`（二级页面外壳、PickRow）、`wheel-picker.tsx`（滚轮）；样式 `apps/web/src/app/ui-components.css`。
- 已在用的例子：Choice Sheet → `settings.tsx` / `account-settings.tsx` 的深色模式、字体大小；Action Sheet → `chat-settings.tsx` 人设贴合度、清空聊天记录；二级页面 → `profile-edit.tsx`；Dialog → `settings.tsx` 退出登录。
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
