# 交接说明：T-063 L4 关系网与群聊（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-063-relations-groups`，`35b7ad3`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

1. **关系网**（characters 模块，迁移 0031）：管理端增删改查（公开依据必填、真人与虚构之间拒绝、写审计）；用户给自己的自定义角色之间设关系（任一方是预设角色返回 422）；一条关系双向生效；每次变化发 `characters.relation_changed`；只读端口 `CharacterRelationReadPort`。
2. **群聊**（chat 模块，迁移 0030）：建群（2～9 个通讯录角色、幂等、默认群名按成员名拼接）、加人、移出、改名、删除并退出（解散，物理删除）；系统提示 `group_created / group_invited_by_character / member_joined / member_removed / member_left / group_renamed`；端口 `ChatGroupAdminPort`、`ChatGroupReadPort`。
3. 群消息沿用现有 seq、幂等、补拉、已读机制；`@` 写入 `mentionedParticipantIds`；成人范围下要求所有在群角色都有资格才能写入。
4. **删除角色退群（CHR-06）**：contacts 删除（保留 30 天或立即彻底删除）时把角色移出该用户所有群，群里显示「XX 退出了群聊」。
5. **卡片按钮**（ADR-0026）：`POST .../messages/:messageId/action`，只能点一次，发 `message.updated` 与 `chat.message_action_chosen`。
6. `ReadMessagesInput` 的 `excludeLabels / excludeMessageIds / contentTypes` 已实现。
7. 删除清单：群聊随会话（按 owner）一起删除；关系网加入 characters 的 `purgeUser / countUserData`。
8. 实现说明：`docs/backend/groups-relations.md`（在 local/trunk 中）。typecheck、eslint、dependency-cruiser 已通过；按要求未写测试。

## 改了哪些文件

- 迁移：`apps/server/drizzle/0030_chat_groups(.down).sql`、`0031_character_relations(.down).sql`、`meta/_journal.json`
- chat：`application/groups.ts`（新）、`application/actions.ts`（新）、`http/groups.controller.ts`（新）、`application/store.ts / write.ts / read.ts / admin.ts / participant.ts`、`infra/db/schema.ts`、`chat.module.ts`、`tokens.ts`、`index.ts`
- characters：`application/relations.ts`（新）、`http/relations.controller.ts`（新）、`application/characters.ts`（删除清单）、`infra/db/schema.ts`、`characters.module.ts`、`tokens.ts`、`index.ts`
- contacts：`application/commands.ts`（删除时调用退群端口，两处调用）
- 装配：`apps/server/src/app.module.ts`（绑定 `CHAT_GROUP_DIRECTORY`）
- 契约：`packages/contracts/src/http/chat.ts`；安卓生成物 `Contracts.kt`、`contracts.json`
- 文档：`docs/backend/groups-relations.md`

## 契约变更（已做，向后兼容，请架构补登记）

- `Conversation.group.formerParticipants?: Participant[]`（可选）：已退出 / 被移出的角色参与者，只用来渲染其历史消息的发送者；不是群成员。原因：移出后 `participants` 不再包含该角色，否则客户端无法显示其旧消息的头像和名字。

## 遗留问题

- 未写测试、未在数据库上实际跑迁移和接口（按本轮要求），留给 Codex 整体验收。
- 契约没有「会话已删除」的更新类型：解散群时先发 `hidden = true` 的会话更新再物理删除（与私聊彻底删除的做法一致）。客户端收到 `hidden` 的群聊后再拉不到它，应直接从本地删掉。
- 群的情景模式、「角色自己聊天」、秒回按契约归 ai-runtime（`GroupCompanionEndpoints`），本卡没做。拉入没资格的角色后「自动回到日常 + 系统提示」由 ai-runtime 订阅 `chat.group_members_changed` 完成；在那之前 chat 会拒绝写入成人范围消息，不会越界。
- 现有 ai-runtime 的回复逻辑没有区分群聊：用户在群里发言后，可能按私聊方式触发回复，需要 T-065 处理（例如只处理 `conversationType = 'direct'`，群聊交给调度）。
- `CHR-06` 由 contacts 调用退群端口（`ChatGroupAdminPort` 注释里写的调用方就是 contacts），改了 contacts 两处调用，超出卡片写的「可以改」范围，在此说明。
- 删除关系后历史群聊消息不动；「两人不再互动」由 T-065、T-066 读取关系时实现。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 T-065（ai-lead 群聊调度）：注入 `CHAT_GROUP_READ_PORT`（`listGroupConversations`、`getLastUserMessageAt`）、`CHAT_GROUP_ADMIN_PORT`（角色拉群 `createGroupConversation`，`characterIds` 要包含拉群角色本人，幂等键自己定；`addGroupMembers`、`renameGroup` 传 `byCharacterId`）、`CHARACTER_RELATION_READ_PORT`。订阅 `chat.message_created`（`mentionedParticipantIds`）、`chat.group_members_changed`（检查情景模式资格并切回日常、写 `scenario_mode_switched` 系统提示）、`chat.group_dissolved`。群里的角色成员 = `Conversation.participants` 中 kind = character 的项（已退出的不在里面）。已退出的角色发言会返回 `not_conversation_member`。
- 给 T-066 / T-071（ai-lead）：关系查询用 `CHARACTER_RELATION_READ_PORT.getRelation / listRelations(userId, characterId)`，结果已包含预设之间与该用户设定的自定义关系；订阅 `characters.relation_changed` 清缓存。
- 给 T-067（web-lead）：接口见契约 `ChatGroupEndpoints`、`ChatActionEndpoints`、`RelationAdminEndpoints`、`UserRelationEndpoints`。系统提示按 code 渲染，参数里有 `name / names / title / byName`。旧消息发送者找不到时查 `conversation.group.formerParticipants`。解散后收到 `hidden` 更新即从本地删除。上限错误为 422 `limit_reached`（`details.limit = 9`）。
- 给 T-068（android-lead）：同上；安卓契约生成物已重生成（含 `formerParticipants`）。
- 给 T-078（后端搜索）：`chat.messages.content_type` 已有（0030 起写入），可用于只搜文字类消息。
- 给架构：请在契约文档登记 `Conversation.group.formerParticipants`；考虑以后加一个「会话已删除」更新类型。
