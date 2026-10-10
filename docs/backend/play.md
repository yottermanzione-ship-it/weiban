# play 模块实现说明（后端）

> 负责人：后端 · 2026-10-11 · T-091 起；T-092～T-095 在本文追加各自小节。
> 契约：`packages/contracts/src/http/play.ts`、`ports/social.ts`（PlayReadPort / PlayAgentPort）、`events.ts`（play.*）。模块归属见 ADR-0024。

## 1. 模块骨架（各玩法共用）

| 位置 | 作用 |
|---|---|
| `modules/play/infra/db/schema.ts` | 全部 play 表（schema `play`），每张卡追加自己的表 |
| `application/context.ts` `PlayContext` | 用户时区 / 当地日期、通讯录校验、角色画像（恋人 / 儿童 / 真人）、写私聊消息（用户或角色身份）、`data.changed` |
| `application/play-feature.ts` `PlayFeature` | 每个玩法实现：`purgeUser`、`countUserData`、可选 `onContactRemoved / onContactRestored / onContactPurged / sweepDue` |
| `application/play-lifecycle.ts` `PlayLifecycle` | **唯一**登记删除清单（模块 `play`）、订阅 contacts 删除 / 恢复 / 彻底删除、每分钟 `play.due_sweep` 兜底扫描 |
| `application/play-jobs.ts` `PlayJobs` | 到点任务：`at(name, {id}, when, {tx})` 精确投递 + `register` 登记处理函数；处理函数必须幂等 |
| `application/play-ports.ts` | 契约 `PlayReadPort` / `PlayAgentPort` 实现，转发到各玩法服务；未交付玩法返回安全默认值 |
| `tokens.ts` / `index.ts` | `PLAY_READ_PORT`、`PLAY_AGENT_PORT`、`PLAY_DAILY_ANSWER_STATUS`（内部） |

新玩法接入步骤：建表（本卡迁移号）→ 写 `XxxService implements PlayFeature` → 加进 `play.module.ts` providers 与 `PlayLifecycle` 构造函数的 `features` 数组 → 在 `play-ports.ts` 把占位方法改为转发。迁移的 `.down.sql` **不要** `DROP SCHEMA play`（只有 0065 删 schema）。

依赖边界：play 是上层，只 import 中 / 底层（characters、chat、contacts、identity、realtime）；不能 import ai-runtime、growth。成就、首次互动 +5 由 growth 订阅 play.* 事件完成；发瞬间卡由 ai-runtime（T-096）调 `GROWTH_CARD_PORT`。

## 2. 每日一问（PLAY-03，T-091，迁移 0065）

表：`daily_questions`（题库，标签 + 上下架，起步 12 题）、`daily_answers`（每用户每当地日期唯一；回答与 TA 的答案按用户数据密钥加密；题目文字快照）、`daily_prefs`（上次选的角色）。

- **选题**：上架题按创建顺序排列，以 sha256(userId|日期) 取起点向后轮转；过滤：儿童角色只要 `child_safe`；非恋人（关系类型不是「恋人」或角色不允许恋爱）跳过 `romance`；真人跳过 `work`。优先没答过的题。没有合适题返回 404。
- **作答** `POST /play/daily-question/answers`：1～200 字（契约校验）；`clientRequestId` 幂等；当天已答 409 `already_answered`；题目须仍上架且适合该角色。同一事务：写回答（status `pending`）→ 私聊以用户身份写 `daily_question` 卡片消息（幂等键 = clientRequestId）→ 记上次角色 → 发 `play.daily_answer_submitted` → `data.changed(daily_question)`。
- **揭晓**：TA 的答案只在 `characterAnswerStatus = ready` 时返回。ai-runtime 经 `PlayAgentPort.setDailyCharacterAnswer` 回写（已 ready 时幂等忽略）。余额不足：ai-runtime 调 `PLAY_DAILY_ANSWER_STATUS.markDailyAnswerWaitingBalance`，余额恢复后用 `listDailyAnswersWaitingBalance` 取出补生成。
- **历史**：只列答过的，按日期倒序，游标分页 30 条。
- **管理端** `/admin/play/questions`：列表（可按标签筛）、新增、编辑 / 上下架，写审计。
- **删除**：注销清空回答与偏好；彻底删除角色时删除和该角色的回答。

## 3. 心愿清单（PLAY-04，T-092，迁移 0066）

表：`wishlist_items`（文字加密；`proposed_by_character`「TA 提议」；`due_date` 约定；`completed_at` / `first_completed_at`；`card_issued`；`followed_up_at`；`source_key` 幂等）、`wishlist_proposals`（角色提议，按用户当地周一计数）。

- **接口**：`GET /play/wishlists`（通讯录里每个角色的总数 / 完成数）、`GET /play/wishlists/:characterId`、`POST .../items`（clientRequestId 幂等；满 50 项 422 `limit_reached`）、`PATCH /play/wishlist-items/:itemId`（文字、日期、打勾）、`DELETE`。两个入口同一张表，任何改动发 `data.changed(wishlist)`。
- **约定**：新建 / 改文字或日期 / 删除都发 `play.wishlist_item_changed`（删除时 `dueDate = null`）；ai-runtime 据此写或取消「我们的约定」记忆，到期跟进按 SIM-07。
- **打勾**：只有用户能打勾。第一次完成时，经 `PLAY_CARD_ISSUER`（装配入口绑定 growth 的 `GROWTH_CARD_PORT`，kind `play`，幂等键 `wish:{itemId}`）发瞬间卡，并发 `play.wishlist_item_completed{firstCompletion}`。取消完成不收回卡；再次完成不再发卡。
- **角色提议**：`PlayAgentPort.createWishlistProposal`，每个角色每用户每周（用户当地时间周一起算）1 次，清单满时返回 `list_full`，同一幂等键重复调用返回原 proposalId。ai-runtime 发 `action_card`（cardKind `wishlist_proposal`，`ref = {kind:'wishlist_proposal', id: proposalId}`，按钮 actionId `add` / `skip`，常量见 `WISHLIST_PROPOSAL_ACTIONS`）。play 订阅 `chat.message_action_chosen`：点 `add` 时建项并标「TA 提议」；点 `skip`、清单已满或角色已删除时记为 declined。
- **跟进标记**：`PLAY_WISHLIST_FOLLOW_UP.markWishlistFollowedUp(itemId)` 返回 false 表示该项已问过或已完成，不要再问。
- **删除角色**：30 天回收期内清单保留，但接口返回「角色不在通讯录」；恢复后原样回来；彻底删除时一并删除。
