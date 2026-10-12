# 朋友圈与名片推荐（T-064）实现说明

> 负责人：后端 · 2026-10-10 · 契约：`packages/contracts/src/http/moments.ts`、`ports/social.ts`（MomentsReadPort、MomentsCharacterPort）、`http/contacts.ts`（ContactCardEndpoints）、`ports/contacts.ts`（ContactCardRecommendationPort）

## 1. moments 模块（上层，迁移 0034，schema `moments`）

- 表：`posts`（动态，文字信封加密）、`post_media`（最多 9 张）、`visibility`（「部分可见」选中的角色）、`likes`、`comments`（文字加密，含回复对象）、`badge_state`（红点游标）。
- 每个用户一个朋友圈世界（`owner_user_id`）。**读时过滤**：只返回用户本人和通讯录中 active 角色的动态、点赞、评论，所以删除角色后其动态消失、30 天内恢复后又出现（CHR-06）。
- 用户动态「部分可见」：未选中的角色经端口点赞、评论返回 `not_visible`；`listUserPostsVisibleTo` 不返回给它。
- 角色评论上限：最后一条用户评论之后的角色评论数达到 6 条时，`comment` 返回 `comment_limit`（SOC-08 第 5 条）。
- 幂等：用户发圈 / 评论按 `clientRequestId`；角色发圈 / 评论按端口 `idempotencyKey`；点赞天然幂等（主键）。
- 来源限制：角色发圈只接受 `daily_event / public_update / holiday / pet` 来源，不接受聊天消息，因此不会混入成人模式或「健康」标记内容（SOC-07 第 8 条、MODE-05）。
- 事件：`moments.post_created`、`moments.comment_created`、`moments.post_liked`（`occurredAt` 即 P-29 计时起点）。更新：`moments.post_changed`（含删除）、`moments.badge_updated`（新角色动态、与我有关的新互动、清红点）。
- P-16「今天是否已发」：`MomentsReadPort.listCharacterPosts(owner, characterId, since=当地零点)` 非空即已发。
- 删除清单：注册 `moments`，按 owner 删除全部动态（子表级联）与红点游标。

## 2. 名片（chat + contacts，迁移 0033）

- 名片消息类型 `contact_card` 契约已有，由服务器端发送方（ai-runtime）经 `ChatParticipantPort.postMessage` 发出；会话列表摘要显示「[名片] 名字」。
- 推荐账本 `contacts.card_recommendations`、`contacts.card_dismissals`：`canRecommend` 判断未添加 / 不在 90 天冷却 / 全局 7 天 1 次（`ignoreWeeklyLimit` 用于用户主动询问）；`recordRecommendation` 与名片消息同一事务记账（按 messageId 幂等）。
- 「不感兴趣」：`POST /contacts/recommendations/:characterId/dismiss`，重复点刷新冷却起点。
- 通过名片添加时的推荐人：沿用已有 `AddContactRequest.referrerCharacterId` → `contacts.referrer_character_id`。
- 删除清单：contacts 的 `purgeUser / countUserData` 已包含两张账本表。
