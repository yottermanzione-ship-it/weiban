# library（收藏、分享图数据）与聊天记录搜索（T-078）

> 负责人：backend-lead · 2026-10-10 · 契约：`http/library.ts`（`LibraryEndpoints`、`ShareEndpoints`）、`http/chat-groups.ts`（`ChatSearchEndpoints`）· 迁移 0053、0054

## 1. 代码位置

| 部分 | 位置 |
|---|---|
| 收藏、分享图、分享偏好 | `apps/server/src/modules/library/`（上层，schema `library`） |
| 聊天记录搜索 | `apps/server/src/modules/chat/application/search.ts`、`http/search.controller.ts`（ADR-0027 定在 chat） |
| 装配 | `app.module.ts` 的 `LibraryCompositionModule`：`LIBRARY_MOMENTS_READ` → moments `MOMENTS_READ_PORT`；`LIBRARY_CARD_LOOKUP` → growth `GROWTH_CARD_LOOKUP` |

library 按 T-101 上层白名单不能 import moments / growth，所以在自己的 `tokens.ts` 定义令牌，由装配入口注入（同 calls / `CallAgentPort`）。两个令牌都是可选注入，未绑定时对应请求按「不存在」处理。

## 2. 表（0053）

- `library.favorites`：一行一个收藏。唯一索引 `(user_id, source_kind, source_id)` 保证同一来源重复收藏返回原收藏。正文快照 `content_ciphertext` 用用户数据密钥加密（AAD `library:favorite:{id}`，与 chat 消息同级保护）；另存明文 `scope`、`labels`、`sender_kind`、`character_id` 供筛选和分享判断。
- `library.share_preferences`：默认模板，初始 `pink_filter`。
- `library.share_generations`：每用户每模板生成次数（只记次数，不存图）。

0054 在 `chat.messages` 上建可搜索消息的部分索引（会话 + seq 倒序）。

## 3. 收藏规则

- 消息收藏：经 `ChatReadPort.getConversation` 确认会话属于本人，`getMessage(['normal','adult'])` 读正文；已撤回 / 不存在返回 404。成人模式和带 `health` 标签的消息**可以收藏**（MODE-05 第 4 条），但 `shareable = false`、`notShareableReason` = `adult_scope` / `health_label`。
- 朋友圈动态收藏：经 `MomentsReadPort.getPost`。快照为 text 内容，图片列入 `extraImages`；纯图片动态以第一张图为 image 内容。
- 收藏后发 `library.favorite_added`（含当前收藏总数）与 `data.changed(favorites)`；取消收藏幂等，不收回成就。
- 列表按收藏时间倒序（游标 = 时间 + ID），可按 `characterId` 筛选；`q` 在解密后的文字里匹配（文字、链接标题与描述、信件、每日一问、语音原文）。

## 4. 分享图数据（`POST /library/share-images/prepare`）

- 四个来源：聊天多选、收藏、朋友圈、卡片。条数上限 P-24 = 30 由契约校验（超过返回 400 校验错误）。
- 成人模式消息、`health` 标签消息、不存在的项 → 422 `share_content_not_allowed`，`details.rejected = [{ id, reason }]`，不静默丢弃（EXP-01 第 6 条）。收藏里的快照同样按收藏时的 `scope` / `labels` 排除。
- 撤回的消息不显示（跳过）；全部都是撤回消息时以 `recalled` 拒绝。系统提示不进分享图。
- 真人标注：对涉及的每个角色调 `PolicyPort.getCharacterPolicy`，任一 `isRealPerson` 或 `shareImageLabel = not_real_person` → `weiban_not_real_person`；查不到策略（角色已删）保守按真人处理。群聊只要一条来自真人角色即按真人。
- 卡片：经 `LIBRARY_CARD_LOOKUP` 取卡片所属角色，返回 `cardId` 与 `characterIds`，卡面由客户端取。
- `POST /library/share-images/generated` 计数并发 `library.share_image_generated`。

## 5. 聊天记录搜索（偏离 ADR-0027 的实现说明，已上报）

**结论：没有建 pg_trgm 明文索引，改为服务器内存逐条解密匹配。**

理由：`chat.messages` 的正文存放在 `content_ciphertext`（按用户数据密钥加密），数据库里没有明文列，ADR-0027 的 `pg_trgm` GIN 索引无法建立；若为搜索另存一份明文，等于取消消息加密，属于安全取舍，不应由后端自行决定。

做法：先用明文列筛掉不可搜消息（`status = normal`、`seq > clearedThroughSeq`、`content_type` 属于 text / link / letter / daily_question / voice 或旧消息为空），再按 seq 倒序每批 200 条解密匹配（不区分大小写的子串匹配，中文按字匹配），跳过本人已删除的消息。可搜文字：文字、链接标题、信件正文、每日一问（题目 + 回答）、**角色**语音原文。

- 会话内搜索：返回命中 + `hasMore`，`beforeSeq` 向旧翻页；结果带 `seq`，客户端用 `listMessages` 定位上下文。
- 全局搜索：角色（私聊会话角色的备注 / 名字，经 `CHAT_GROUP_DIRECTORY`）、群名、各会话命中汇总（按最新命中时间倒序，最多 20 组）。已删除好友（归档会话）不出现。
- 代价：全局搜索要解密该用户全部可搜消息，单用户数万条可接受；变慢后的方案见交接说明「契约变更申请 / 待架构决定」。

## 6. 删除清单

library 登记 `module: 'library'`：删除并计数 `favorites`、`share_preferences`、`share_generations`。搜索不建新表，无需登记。
