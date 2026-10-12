# 交接说明：T-078 L6 library 收藏与分享图数据、聊天记录搜索

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-078-library-search`，`6757bc1`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

1. **收藏**（`LibraryEndpoints`）：新模块 `library`。收藏消息或朋友圈动态时复制一份内容快照（正文加密），原消息删除后收藏仍在；同一来源重复收藏返回原收藏（幂等）；列表按时间倒序、可按角色筛选、可搜文字；取消收藏幂等。成人模式、「健康」标记消息可以收藏，但标为不能用于分享图并给出原因。发 `library.favorite_added`、`data.changed(favorites)`。
2. **分享图数据**（`ShareEndpoints`）：四个来源（聊天多选、收藏、朋友圈、卡片）。成人模式 / 「健康」标记 / 不存在的项一律 422 `share_content_not_allowed`，`details.rejected` 逐条列出原因，不静默丢弃；撤回消息不显示；超过 30 条由契约校验拒绝。真人标注按 `PolicyPort.getCharacterPolicy` 判定，任一真人角色（或查不到策略）即 `weiban_not_real_person`。生成次数回报、默认模板读写。
3. **聊天记录搜索**（`ChatSearchEndpoints`，在 chat 内）：会话内搜索（seq 倒序、`beforeSeq` 翻页）和全局搜索（角色名 / 备注、群名、各会话命中汇总），返回定位所需的 seq。只搜文字类内容，不含撤回、本人删除、已清空的消息。
4. **删除清单**：library 登记 `favorites`、`share_preferences`、`share_generations`。
5. 实现说明：`docs/backend/library-search.md`。
6. 本地 `pnpm typecheck`、`pnpm lint` 通过；按约定没写测试。契约未改，安卓生成物无需重生成。

## 改了哪些文件

- 新增 `apps/server/src/modules/library/**`（module、controller、service、schema、tokens、index）
- 新增 `apps/server/src/modules/chat/application/search.ts`、`chat/http/search.controller.ts`；改 `chat/chat.module.ts`
- 改 `apps/server/src/modules/growth/`（`tokens.ts`、`index.ts`、`growth.module.ts`）：新增内部令牌 `GROWTH_CARD_LOOKUP`（卡片属于哪个角色）
- 改 `apps/server/src/app.module.ts`：`LibraryCompositionModule` 把 moments 的 `MOMENTS_READ_PORT`、growth 的 `GROWTH_CARD_LOOKUP` 绑定到 library 自己的令牌，并装配 `LibraryModule`
- 新增迁移 `apps/server/drizzle/0053_library.sql/.down.sql`、`0054_chat_search_index.sql/.down.sql`，`meta/_journal.json` 登记 53、54
- 新增 `docs/backend/library-search.md`

## 遗留问题

- **ADR-0027 与现有加密冲突（上报，请架构裁定）**：ADR-0027 要在 `messages` 的明文上建 `pg_trgm` 索引，但消息正文是按用户密钥加密存放的，数据库里没有明文。我没有为搜索另存明文（那等于取消消息加密），改为服务器内存里逐条解密匹配，0054 只建了缩小候选范围的普通部分索引。个人测试规模可以用；单用户消息很多时全局搜索会变慢。需架构决定长期方案：A. 维持现状；B. 另存明文搜索列并建 `pg_trgm`（放弃这部分加密）；C. 存关键词哈希做盲索引（中文要按字或二字切分）。
- **library → moments 依赖**：按 T-101 交接建议，library 没有直接 import moments，用自己的令牌、由 `app.module.ts` 注入。若架构把 library → moments 加进上层白名单，可以简化，不影响功能。
- **契约小缺口（不卡开发，供架构参考）**：设计 `favorites.md` 要求「角色被删除后收藏卡片显示删除前的头像、名字快照」，但契约 `Favorite` 没有名字 / 头像快照字段，目前客户端只能拿 `characterId` 现查。如需要，请加 `senderNameSnapshot` 之类的可选字段。
- 分享图来源是聊天多选时，被用户「本地删除」的消息经 `ChatReadPort` 无法识别，仍可被选中（客户端本来就看不到它们，影响很小）。
- 全局搜索的「角色」只覆盖有私聊会话的角色；名字查询依赖 `CHAT_GROUP_DIRECTORY`（已在装配入口绑定）。
- 未跑数据库迁移的实际执行验证（本轮不测试），交 Codex 整体验收。

## 需要总经理决定的事

无（搜索方案的取舍属技术决策，请总负责人转架构）。

## 给其他负责人的交接

- 给架构：①ADR-0027 与消息加密冲突，请在 A / B / C 中裁定并更新 ADR（见遗留第 1 条）；②library → moments 是否进白名单；③`Favorite` 是否加名字 / 头像快照字段。
- 给网页 / 安卓（T-083 / T-085）：接口全部按契约实现。`addFavorites` 返回 200 + `{ items }`；分享图 422 时读 `details.rejected[].reason`，`adult_scope` / `health_label` 显示「成人模式 / 健康相关的消息不能生成分享图」；收藏列表里 `shareable = false` 的项多选时置灰。搜索结果用 `seq` 调 `listMessages` 定位。
- 给 AI（T-082）：名场面不要从收藏取素材；library 不提供任何给 ai-runtime 的端口。
- 给 growth（T-076 成就 19、20、21 号）：订阅 `library.favorite_added`（`totalFavorites` 为当前总数）和 `library.share_image_generated`。
- 给总负责人：已合并进 `local/trunk`（`6757bc1`）。
