# 安卓 L4：群聊、朋友圈、新的朋友与名片、TA 认识的人

负责人：android-lead · 2026-10-10 · 状态：**未编译、未测试**（本机不编译，按总经理要求）

| 功能 | 代码（`apps/android/feature/chat/.../`） | 入口 |
|---|---|---|
| 发起群聊、选择角色、群聊列表、群聊信息页（成员 +/−、改名、查找聊天记录、免打扰、置顶、情景模式、角色自己聊天、秒回、清空、删除并退出） | `GroupChat.kt` | 会话列表「发起群聊」；私聊聊天信息「＋ 发起群聊」；通讯录「群聊」 |
| 群聊页：发送者名字、不显示已读、「XX 正在输入…」、@ 选人（输入「@」弹出，只剩 1 个角色直接插入）、系统提示文案、已解散状态 | `ChatScreen.kt`、`ConversationUi.kt`、`MessageRow.kt` | — |
| 名片消息、卡片按钮消息 | `MessageRow.kt` | 点名片进资料页（带推荐人与默认打招呼） |
| 朋友圈：动态流、个人相册（角色 / 我）、详情、点赞评论回复、删除、发朋友圈（≤9 图、谁可以看）、红点 | `Moments.kt`、`MomentsData.kt` | 发现页顶部「朋友圈」；资料页「朋友圈 ›」；我 ›「朋友圈」；通知 `/moments/posts/{id}` |
| 新的朋友 | `NewFriends.kt` | 通讯录顶部 |
| TA 认识的人（自定义角色之间的关系） | `Relations.kt` | 自定义角色资料页（拥有 ≥2 个自定义角色时） |
| 3.0 更新转发 | `core/data/.../AppUpdates.kt`、`SyncEngine.kt` | `message.updated` 替换本地消息；朋友圈、data.changed 等转发给界面 |

## 取舍（与网页 T-067 一致）

- ~~没有「新的朋友」列表接口~~ T-074 起改用 `GET /contacts/new-friends`（`seen`、`DELETE`、`data.changed(new_friends)` 重拉），本机标记已去掉。
- ~~没有「朋友圈消息列表」接口~~ T-074 起「N 条新消息」进入消息列表页（`listNotifications`，进入时清互动红点）。
- ~~没有自定义角色列表接口~~ T-074 起「TA 认识的人」改用 `GET /characters/custom`。
- ~~群名清空 = 提交成员名拼接~~ T-074 起清空提交 `title: null`；`group_renamed` 带 `reset` 时显示「恢复了默认群名」。
- 群聊相关代码放在 `feature/chat` 里（复用头像、资料、远程加载等内部组件），没有新建 gradle 模块。
