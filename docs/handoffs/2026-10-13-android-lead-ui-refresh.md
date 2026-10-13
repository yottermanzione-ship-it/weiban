# 交接说明：安卓换壳（微信式布局 + 微伴小程序）

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 日期 | 2026-10-13 |

依据：网页交接 `2026-10-13-web-lead-ui-refresh.md`「给 Android 的 13 条照做清单」、`docs/refactor/02-wechat-shell-and-miniprograms.md`、`02a-navigation-tree.md`；后端交接 `2026-10-13-backend-lead-ui-refresh.md`（契约 3.2）；AI 交接 `2026-10-13-ai-lead-quick-wins.md`。
按总经理授权：不写测试、不跑测试，只在本机跑一次 `ktlintCheck detekt assembleDebug`。契约生成物未手改，`pnpm android:generate:check` 一致。

## 做了什么

### 第一批（P0，已合入主干）

1. **通用部件**（`core/designsystem`）：`ShellKit.kt`（标题栏 `WbNavBar`、`MenuGroup` / `MenuRow` / 开关行、红点、二级页骨架 `ShellPage`）、`Tint.kt`（图标方块点缀色）、`ComingSoon.kt`（「暂未开放」登记表与统一页、气泡菜单 `PopMenu`、底部弹层 `WbSheet`）。登记表与网页 `comingSoon` 表一一对应，只用现有令牌。
2. **发现页**改成菜单列表：朋友圈 ｜ 角色广场 · 视频号* · 直播* ｜ 扫一扫* · 听书* ｜ 看一看* · 搜一搜 ｜ 游戏* · 小程序（* 进「暂未开放」）。角色广场变成二级页（去掉「人设广场」分页，底部「看看大家创作的角色 ›」进人设广场小程序）。
3. **通讯录**：标题栏右上「添加角色」；搜索就地过滤；固定行 新的朋友（红点）/ 新建角色 / 群聊 / 角色广场 / 标签* / 公众号*；拼音首字母分组（系统 ICU `AlphabeticIndex`，不引第三方库）+ 底部「N 个角色」。**新建角色**弹层三选一：自己写 → 编辑器；从聊天记录生成 → 导入角色；去人设广场挑 → 人设广场。
4. **会话列表**：标题「微伴（未读数）」+ 右上 ⊕ 菜单（发起群聊 / 添加角色 / 新建角色 / 导入角色 / 扫一扫* / 收付款*）；长按会话 → 置顶 / 标为未读 / 消息免打扰 / 不显示该聊天（`PATCH state { hidden: true }`）。行内显示时间、免打扰图标、未读角标。
5. **隐藏 ≠ 退群**：群聊页、群聊信息页不再把 `state.hidden` 当成已解散；「通讯录 › 群聊」也列出隐藏的群。解散的群服务器发 `conversation.removed`，本地删除后自动退出页面。
6. **聊天页**：新标题栏（‹ · 标题 + 副标题 · ···）。副标题 = 对方正在输入… > 当前情景预设（日常聊天不显示、自动 →「自动」、成人 →「私密」），点副标题打开情景预设弹层。
7. **情景预设弹层**（`Scenario.kt`）：按 listModes 顺序，「自动」通栏卡、其余两列卡片（推荐角标、选中绿框 ✓）、`section = private` 放底部「私密」一栏；私密没选成人模式模型 → 提示去模型选择；第一次开启弹「只在你们俩之间」说明（本机按账号记住）。系统提示改为「已切换到 树洞分享」等新名字。聊天信息页、群聊信息页的情景模式选择删除。
8. **「+」面板**：每页 4×2、左右滑动 + 圆点。私聊 相册 · 拍摄 · 语音通话 · 情景预设 / 写信 · 陪我专注 · 提醒 · 小程序 ｜ 心愿 · 名片*；群聊 相册 · 拍摄 · 情景预设 · 名片*。情景预设格子在非日常 / 非自动时带红点；小程序 → 半屏「和 TA 一起用」（按 TA 的 6 个）；提醒新建页支持预选当前 TA。
9. **聊天信息页**：新增「聊天模型 › TA 用的模型」→ 选择页（`GET/PUT /model/character-overrides/:characterId`，`chat: null` = 跟随默认）；新增「和 TA 一起用」图标行；删掉情景模式 / 我们的宠物 / 心愿清单 / 卡册 / 全局模型选择几行。
10. **宠物**：第一次打开先看引导页（三行说明 + 开始领养；没有角色时「先去添加一个 TA」→ 通讯录 › 角色广场）；领养合成一页（预览卡 → ① 和谁一起养（已有宠物的 TA 不出现）→ ② 物种 × 外观三列宫格 + 长大后三阶段 → ③ 起名 / 让 TA 起名 → 底部按钮提示还差哪步）；物种加载失败「加载失败 + 重试」；领养后宠物主页一次性新手提示；按 TA 打开时已有宠物直接进主页。
11. **我 / 设置**换成菜单：我页头部（头像、昵称、微伴号、「+ 状态」*、二维码*）、服务 ｜ 收藏 · 朋友圈 · 视频号* · 卡包* · 表情 ｜ 设置；设置 账号与安全 ｜ 青少年模式* · 关怀模式* ｜ 主动消息与免打扰 · 隐私 · 通用 ｜ 推送 ｜ 关于微伴 · 插件* ｜ 退出登录。我页加了系统返回逐层返回（原来直接退出应用）。
12. **公告 / 本版新功能 / 强制更新**（`feature/me/ReleaseCenter.kt`）：打开应用与回到前台时拉取；弹窗顺序：必须更新（不可关闭，「去下载」打开后台配置的下载地址）→ 本版新功能（关闭时 `release-notes/seen`）→ 未读弹窗公告（从旧到新，关闭即已读）。`versionCode` 用 `BuildConfig.VERSION_CODE`。未读红点：底部「我」→「设置」→「关于微伴」→「公告」。新页：关于微伴（版本、构建号、公告、更新日志、检查更新）、公告（进入即全部已读）、更新日志。
13. **小程序登记表与宿主**（`MiniApps.kt`，为第二批铺路）：11 个小程序的名字 / 说明 / 图标 / 颜色 / 按 TA 入口与网页 `miniApps` 表一致；统一入口 `MiniAppNavigation.open(id, characterId)`；没有自己浮层的卡册、成就、人设广场、经期日记由新的宿主浮层显示；发现 › 小程序主页（搜索 / 最近使用 / 我的小程序）。

## 改了哪些文件

- 新增：`core/designsystem/.../ShellKit.kt`、`Tint.kt`、`ComingSoon.kt`；`feature/chat/.../Discover.kt`、`MiniApps.kt`、`Scenario.kt`、`CharacterModel.kt`；`feature/me/.../ReleaseCenter.kt`
- 修改：`app/.../MainActivity.kt`；`feature/chat/.../ChatScreen.kt`、`ComposerPanels.kt`、`ConversationUi.kt`、`ChatInformation.kt`、`GroupChat.kt`、`RoleBrowser.kt`、`NewFriends.kt`、`Moments.kt`（发现页移出）、`Pets.kt`、`L6Shared.kt`、`PlayShared.kt`、`PlayFocusReminders.kt`；`feature/me/.../MeScreen.kt`、`MeState.kt`、`NotificationSettingsPage.kt`、`PeriodDiary.kt`
- 文档：本文件

## 遗留问题

（第二批完成后补全）

## 需要总经理决定的事

无。

## 给其他负责人的交接

（第二批完成后补全）
