# 群聊与关系网（T-063）实现说明

> 负责人：后端 · 2026-10-10 · 契约：`packages/contracts/src/http/chat-groups.ts`、`http/character-extras.ts`、`ports/chat.ts`、`ports/characters.ts`

## 1. 关系网（characters 模块，迁移 0031）

- 表 `characters.relations`：一条关系一行，存储时规范化为 `character_a_id < character_b_id`，查询两个方向都命中（双向生效，ADM-02 第 2 条）。
- 预设之间：`owner_user_id` 为空、`evidence`（公开依据）必填，数据库 CHECK 兜底；真人与非真人之间拒绝（SOC-01 第 2 条）；写审计。
- 自定义之间：`owner_user_id` = 设定者、`evidence` 为空；任一方是预设角色返回 422（SOC-01 第 3 条）。
- 同一对角色只能有一条关系（重复 409 conflict）。角色删除时级联删除关系。
- 每次增删改发 `characters.relation_changed`。只读端口 `CHARACTER_RELATION_READ_PORT`（`CharacterRelationReadPort`）：用户可见 = 预设之间 + 该用户设定的。
- 删除清单：`CharacterService.purgeUser / countUserData` 已包含该用户设定的关系。

## 2. 群聊（chat 模块，迁移 0030）

- 群会话沿用 `chat.conversations`（type = group），新增 `created_by_character_id`、`title_customized`、`create_key`（建群幂等）。
- 成员沿用 `chat.participants`，新增 `left_at`：移出 / 退出时只写 `left_at`，行保留，历史消息的发送者仍能渲染（`Conversation.group.formerParticipants`）；再次拉入复用原行。已退出的角色不能再发言、不能「正在输入」。
- 群名默认按成员名「、」拼接（最多 40 字），成员变化时自动更新；用户或角色改过（`title_customized`）后不再自动改。
- 系统提示 code 与 params：`group_created {names, characterIds}`、`group_invited_by_character {name, characterId, names, characterIds}`、`member_joined {names, characterIds, byName?, byCharacterId?}`、`member_removed {name, names, characterId}`、`member_left {name, names, characterId}`、`group_renamed {title, byName?, byCharacterId?}`。
- 删除并退出 = 解散：先把会话置为隐藏并发 `conversation.state_updated` / `conversation.updated`（契约没有「会话删除」更新类型，做法同私聊彻底删除），再物理删除会话与消息，发 `chat.group_dissolved`。重复调用视为成功。
- CHR-06：contacts 删除（30 天保留或立即彻底删除）时调用 `ChatGroupAdminPort.removeCharacterFromUserGroups`，群里写 `member_left`（「XX 退出了群聊」）。
- 群消息仍走 `ChatWriteService`：seq、幂等、补拉、已读游标与私聊一致；群聊 `peerReadSeq` 为 null。`TextContent.mentions` 只保留仍在群里的参与者，写进 `chat.message_created.mentionedParticipantIds`。
- 成人范围盖章沿用会话 `contentScope`；成人范围下每次写入都要求**所有在群角色**通过 policy，否则拒绝（拉入不合格成员后 ai-runtime 切回日常前也不会写出成人消息）。
- 群的情景模式、「角色自己聊天」、秒回属于 ai-runtime（`GroupCompanionEndpoints`），chat 不存。
- 通讯录与名字查询经 `CHAT_GROUP_DIRECTORY`（chat 定义令牌，`app.module.ts` 用 contacts + characters 绑定）。

## 3. 卡片按钮（ADR-0026）

- `chat.messages` 新增 `action_id`、`action_chosen_at`；只能写一次（条件更新 `action_id IS NULL`），同一 actionId 重复提交返回原消息，不同 actionId 返回 409。
- 成功后发 `message.updated` 更新与 `chat.message_action_chosen` 事件。

## 4. ReadMessagesInput 3.0 过滤

- `excludeLabels`、`excludeMessageIds` 在 SQL 中过滤；`contentTypes` 用新列 `messages.content_type`（0030 起写入），旧消息该列为空时解密后再判断。
