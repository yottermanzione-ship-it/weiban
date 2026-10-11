# 交接说明：T-064 L4 朋友圈模块与名片消息（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-064-moments-cards`，`419fb4c`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

1. 新建 **moments 模块**（迁移 0034）：用户和角色的动态（文字、最多 9 张图、链接），点赞、评论和回复，「谁可以看」（全部 / 部分角色），红点（新动态、与我有关的新互动、清红点后所有设备同步）；全部用户接口按契约 `MomentsEndpoints` 实现。
2. 用户只看到自己和通讯录中角色的动态、点赞、评论（读的时候过滤），所以删除角色后其动态消失，恢复好友后又出现（CHR-06）。
3. 「部分可见」的动态：没被选中的角色经端口拿不到、不能点赞评论。
4. 一条动态下角色评论连续到 6 条后拒绝，用户评论后重新计数。
5. 给 ai-runtime 的端口：`MOMENTS_READ_PORT`、`MOMENTS_CHARACTER_PORT`；事件 `moments.post_created / comment_created / post_liked`。
6. **名片推荐账本**（迁移 0033，contacts 模块）：全局 7 天 1 次、「不感兴趣」后冷却 90 天、已添加的不推荐；端口 `CONTACT_CARD_RECOMMENDATION_PORT`；「不感兴趣」接口。会话列表摘要显示「[名片] 名字」。
7. 删除清单：moments 已注册；contacts 已包含两张账本表。
8. 实现说明 `docs/backend/moments.md`（在 local/trunk 中）。typecheck、eslint、dependency-cruiser 已通过；按要求未写测试。

## 改了哪些文件

- 迁移：`apps/server/drizzle/0033_contact_card_recommendations(.down).sql`、`0034_moments(.down).sql`、`meta/_journal.json`
- moments（新）：`apps/server/src/modules/moments/**`（`application/moments.ts`、`http/moments.controller.ts`、`infra/db/schema.ts`、`moments.module.ts`、`tokens.ts`、`index.ts`）
- contacts：`application/recommendations.ts`（新）、`application/lifecycle.ts`、`http/contacts.controller.ts`、`infra/db/schema.ts`、`contacts.module.ts`、`tokens.ts`、`index.ts`
- chat：`application/store.ts`（名片摘要）
- 装配：`apps/server/src/app.module.ts`（加入 MomentsModule）
- 文档：`docs/backend/moments.md`

## 遗留问题

- 未写测试、未在数据库上实际跑（按本轮要求）。
- 角色评论 @ 用户要推送（SOC-08 第 4 条，推送 kind `moments`）：本卡只在事件里带 `mentionsUser`，推送模块尚未订阅 `moments.comment_created`，需要派给负责 push 的卡（或 T-066 交接时一起补）。
- 「朋友圈不含成人 / 经期内容」靠来源限制保证：角色发圈端口只接受日常事件、公开动态、节日、宠物作为来源，不接受聊天消息；文字内容本身是否含经期信息仍需 AI 生成侧保证。
- 角色发图片时 moments 不校验媒体归属（由 ai-runtime 负责传入合法 mediaId；media 系统端口 L5 才实现）。用户发图校验用途必须为 `moments_image`。
- 契约没有改动。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 T-066（ai-lead）：注入 `MOMENTS_CHARACTER_PORT`（`createPost / like / comment`，幂等键相同只生效一次；`comment` 返回 `comment_limit` 时停止评论）和 `MOMENTS_READ_PORT`（`getPost`、`listCharacterPosts`——传当地零点即可判断 P-16「今天已发」、`listUserPostsVisibleTo`——不可见的角色拿不到）。订阅 `moments.post_created`（`visibleCharacterIds` 即可互动的角色）、`moments.comment_created`、`moments.post_liked`，事件发生时间就是 P-29 两小时计时起点。名片：发名片前调 `CONTACT_CARD_RECOMMENDATION_PORT.canRecommend`（用户主动问时传 `ignoreWeeklyLimit: true`），发出 `contact_card` 消息后在同一事务调 `recordRecommendation`。
- 给 T-067 / T-068（web / android）：接口按契约 `MomentsEndpoints`、`ContactCardEndpoints`。分页游标原样回传。收到 `moments.post_changed` 时重新拉 `getPost`（`deleted = true` 直接删本地）；收到 `moments.badge_updated` 更新发现页红点。名片点开走资料页，添加时带 `referrerCharacterId`。
- 给 T-078（library）：`MomentsReadPort` 由 moments 正常导出（`MOMENTS_READ_PORT`）；library 在自己模块定义令牌，由 `app.module.ts` 绑定到 `MOMENTS_READ_PORT`。
- 给 push 负责人：如需推送「角色评论 @ 我」，订阅 `moments.comment_created` 且 `mentionsUser = true`。
