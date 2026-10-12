# 交接说明：L4 后端收尾（新接口、推送规则、契约登记）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `L4-backend-backlog`，`a5fd58f`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

1. 补了 T-067 / T-068 交接里提的四个接口缺口：「新的朋友」列表（含不感兴趣、删除记录、已看过，多设备同步）、朋友圈消息列表、自定义角色列表、群名置空恢复默认名。
2. 推送：角色在朋友圈评论里 @ 用户时推送（kind = `moments`，链接 `/moments/posts/{postId}`，遵守免打扰）；群聊里带 `self_chat` 标签且没 @ 用户的消息不推送，未读数照常（T-065 遗留 1）。
3. 契约登记：`Message.labels` 说明里登记 `self_chat`；`Conversation.group.formerParticipants`（T-063 已加）保留；新增「会话已删除」更新 `conversation.removed`。网页 / 安卓的同步核心都已处理这条更新（从本地删掉会话和消息）。
4. 契约版本 3.0.1，全部是向后兼容的新增；Android 生成物已重生成。全仓 typecheck、lint（含依赖检查）已通过；按要求没写测试、没跑测试。

## 新接口（供网页 / 安卓接入）

| 接口 | 说明 |
|---|---|
| `GET /api/v1/contacts/new-friends` | 「新的朋友」：`items[]`（`itemId`、`kind` = card_recommendation / contact_request、`characterId`、`recommenderCharacterId`、`messageId`、`status` = can_add / pending / added / dismissed、`createdAt`）按时间倒序，客户端自己分近三天 / 更早；`unseenCount` = 通讯录红点数 |
| `POST /api/v1/contacts/new-friends/seen` | 清「新的朋友」红点（204） |
| `DELETE /api/v1/contacts/new-friends/:itemId` | 删除一条记录，只从列表移除（204） |
| `POST /api/v1/contacts/recommendations/:characterId/dismiss` | 不感兴趣（T-064 已有），现在会同步到列表 |
| `GET /api/v1/moments/notifications?cursor&limit` | 朋友圈消息列表：`kind` = like / comment / reply / mention、`actor`、`text`、`post`（作者、前 100 字、首图）、`createdAt`；游标分页。点进后调 `markSeen({scope:'interactions'})` 清红点 |
| `GET /api/v1/characters/custom` | 我的全部自定义角色（`UserCustomCharacter[]`，按创建时间倒序） |
| `PATCH /api/v1/groups/:conversationId` | `title` 传 `""` 或 `null` = 恢复默认名；之后群名随成员变化自动更新，系统提示 `group_renamed` 带 `reset: true` |

同步更新：

- `data.changed`，`section = 'new_friends'`：推荐、不感兴趣、删除、已看过时发出，客户端重新拉 `new-friends`。
- `conversation.removed`（`conversationId`、`reason` = group_dissolved / purged）：群解散、私聊彻底删除后发出；之前那条 `hidden = true` 的状态更新也照发，兼容旧客户端。

## 改了哪些文件

- 契约：`packages/contracts/src/http/{contacts,moments,characters,chat-groups,chat,sync}.ts`、`ports/chat.ts`
- 服务器：`modules/contacts/{application/recommendations.ts,http/contacts.controller.ts,infra/db/schema.ts}`、`modules/moments/{application/moments.ts,http/moments.controller.ts}`、`modules/characters/{application/custom-character.ts,http/custom-character.controller.ts,characters.module.ts}`、`modules/chat/{application/groups.ts,application/admin.ts,application/read.ts,http/groups.controller.ts}`、`modules/push/application/lifecycle.ts`
- 迁移：`apps/server/drizzle/0035_new_friends(.down).sql`、`meta/_journal.json`（用的是 L4 号段里没人用的 0035）
- 客户端同步核心：`packages/client-core/src/sync-engine.ts`、`apps/android/core/data/.../SyncEngine.kt`
- Android 生成物：`Contracts.kt`、`Endpoints.kt`、`contracts.json`
- 文档：`docs/backend/groups-relations.md` 第 5 节

## 遗留问题

- 没写测试、没在数据库上跑，留给 Codex 整体验收。
- `characters.module.ts` 把 `CustomCharacterController` 调到 `CharacterController` 前面，否则 `GET /characters/custom` 会被当成角色 ID 处理；以后在 `/characters/` 下加固定路径时要注意这个顺序。
- 朋友圈 @ 推送的正文固定为「XX 在朋友圈提到了你」，不带评论原文（事件里没有正文，避免推送渠道带出内容）。
- 契约对照表 `docs/architecture/contracts-3.0-map.md` 归架构维护，本次没有改；请架构补记 3.0.1 的这些新增。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 web-lead / android-lead：把「新的朋友」、朋友圈消息列表、「TA 认识的人」的数据来源换成上表接口；群名清空时直接提交 `title: null`，不要再提交成员名拼接；收到 `data.changed(new_friends)` 重新拉列表。同步核心已处理 `conversation.removed`，界面上如果另外缓存了会话（例如群聊信息页），也要跟着移除。
- 给 ai-lead：`self_chat` 标签的推送规则已生效；朋友圈评论要 @ 用户时继续传 `mentionsUser: true`，推送由 push 负责。
- 给架构：在契约对照表登记 3.0.1 新增（NewFriendsEndpoints、MomentsEndpoints.listNotifications、UserCustomEndpoints.list、renameGroup 允许空、`conversation.removed`、`DataSection.new_friends`、`self_chat` 标签、通知上下文 `labels`）。
