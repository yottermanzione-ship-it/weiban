# 交接说明：T-068 L4 安卓——群聊、群设置、朋友圈、新的朋友与名片

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 日期 | 2026-10-10 |
| 分支 | `T-068-android-l4`（worktree `C:\wb-dev\wb-t068`），已合 `local/trunk` 后并入主干 |
| 状态 | **未编译、未测试**（总经理要求：不用 GitHub、不写不跑测试；本机不做安卓编译）。只做了人工自查；`pnpm android:generate:check` 通过 |

## 做了什么

- **群聊**：会话列表「发起群聊」、私聊聊天信息「＋ 发起群聊」（原角色锁定），选 2～9 个角色；群聊页显示发送者名字、不显示已读、「XX 正在输入…」、@ 选人（mentions 随消息发出）、群系统提示（建群、拉群、加人、移出、退出、改名、情景模式切回日常、解散）、已解散时「你已不在该群聊中」；群聊信息页：成员宫格 +/−、群名（≤16 字，清空恢复默认名）、查找聊天记录、免打扰、置顶、情景模式 / 角色自己聊天 / 秒回（GroupCompanionEndpoints）、清空聊天记录、删除并退出；通讯录「群聊」列表；会话列表群头像宫格。群里点角色头像进资料页，打招呼默认「我们在『群名』群里见过」。
- **名片与卡片消息**：名片点开资料页，打招呼默认「是 XX 推荐我来的」，添加带 `referrerCharacterId`；「不感兴趣」调 `dismissRecommendation`；卡片按钮消息点一次（`chooseMessageAction`），`message.updated` 同步后显示已选。
- **朋友圈**：发现页顶部入口（新动态角色头像 + 红点）、底部「发现」标签红点、资料页「朋友圈」、我 ›「朋友圈」；动态流滚到底自动加载、点赞 / 取消、评论、回复、删除自己的评论和动态、详情页（已删除显示「该动态已删除」）；发朋友圈（文字 + 最多 9 张图，先上传 `moments_image`；谁可以看：全部 / 部分角色）；进入时清新动态红点；`moments.post_changed` 重拉该条。
- **新的朋友**：通讯录顶部「新的朋友」（名片推荐红点）、近三天 / 更早分组，状态 添加 / 等待中 / 已添加 / 已忽略，可删除记录。
- **TA 认识的人**：自定义角色资料页（拥有 ≥2 个自定义角色时）设定 / 编辑 / 删除关系。
- **朋友圈 @ 通知**：通知路由 `/moments/posts/{id}` 打开对应动态（服务器推送尚未实现，见遗留）。
- **顺带**：① 时间线改用 `listTimeline`；②「你不在时」每次打开私聊都调用摘要接口；③ 我 › 设置 › 隐私「跨角色共享」（`MemorySharingEndpoints`）；另在「主动消息与免打扰」加「允许角色拉我进群」。
- **同步核心**：契约 3.0 新增的更新类型原来没有分支（Kotlin 的 `when` 不完整会编译失败），现在 `message.updated` 替换本地消息，其余（朋友圈、data.changed、通话、转文字）经 `AppUpdates` 转发给界面。

## 改了哪些文件

- `apps/android/core/data/`：新增 `AppUpdates.kt`；改 `SyncEngine.kt`、`ChatRuntime.kt`（发送带 mentions）、`AvatarUpload.kt`（通用 `uploadMedia`）
- `apps/android/feature/chat/`：新增 `GroupChat.kt`、`Moments.kt`、`MomentsData.kt`、`NewFriends.kt`、`Relations.kt`；改 `ChatScreen.kt`、`ConversationUi.kt`、`MessageRow.kt`、`MessageAvatars.kt`、`CharacterScreen.kt`、`ChatInformation.kt`、`RoleBrowser.kt`、`CharacterTimeline.kt`、`WhileAway.kt`
- `apps/android/feature/me/`：新增 `PrivacyPage.kt`；改 `MeScreen.kt`、`MeEntry.kt`、`NotificationSettingsPage.kt`、`ProactiveDefaultsPage.kt`
- `apps/android/app/.../MainActivity.kt`（发现页、朋友圈路由、标签红点、我 › 朋友圈）、`apps/android/platform/.../NotificationPolicy.kt`（允许 `/moments` 路由）
- `docs/android/social-l4.md`、本交接

## 遗留问题

1. **未编译**。工程开了「警告即错误」，首次构建可能有少量编译 / ktlint / detekt 问题，需要有安卓环境时修。
2. 契约缺口与网页相同：没有「新的朋友」列表、朋友圈消息列表、自定义角色列表接口（界面已按现有接口退一步做）；群名清空时提交成员名拼接，服务器会认为群名被改过。
3. 服务器尚未推送「朋友圈 @ 我」（push 模块没有订阅 `moments.comment_created`）；安卓已能处理 `/moments/posts/{id}` 路由，但需服务器下发的 deepLink 用这个格式。
4. 简化：@ 选人用对话框代替底部弹层，未做「长按头像 @」；朋友圈没有封面和更换封面、个人相册页没有按日期的相册版式（用同一动态流）；发朋友圈没有离线排队；群聊搜索结果点击只回群聊，不定位到那条消息；群成员「−」删除态用文字「移出」代替红色减号；新的朋友未做左滑删除（用按钮）；「通讯录」标签不显示新的朋友红点（只在行内）。
5. 群解散后本机消息没有物理删除，只是不再显示（契约没有「会话已删除」更新类型）。
6. Room 本地库没有新表（新的朋友等标记沿用 `cache` 表的 `flag:` 键），所以未递增数据库版本。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给项目总负责人：本批与 L3 安卓都未编译，请安排一次安卓构建（CI 或有 SDK 的机器），我按报错修。
- 给 backend-lead：朋友圈 @ 推送请用 `deepLink = /moments/posts/{postId}`，`kind = moments`。
- 给 architect / backend-lead：同网页交接的接口缺口（新的朋友、朋友圈消息列表、自定义角色列表、会话已删除更新）。
- 给 Codex（总经理转交）：重点看建群上限、@ 的 mentions、名片添加带推荐人、可见范围、`message.updated` 后卡片状态。
