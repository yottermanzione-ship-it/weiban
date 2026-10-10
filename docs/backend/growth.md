# growth 模块实现说明（熟悉度、纪念日、卡片、成就）

> L3 T-050 建立熟悉度与纪念日；L6 T-076 加卡片与成就。宠物（T-077）也在本模块，另见其交接说明。
> 需求唯一定义处：PRD `09-relationship-growth.md` GRW-03～GRW-06；接口以 `packages/contracts` 为准（`http/growth.ts`、`http/growth-cards.ts`）。

## 1. 表（schema `growth`）

| 表 | 用途 | 迁移 |
|---|---|---|
| `familiarity` / `familiarity_events` | 熟悉度状态与加分流水（流水的 `idempotency_key` 全局唯一，用于幂等） | 0020 段（T-050） |
| `anniversaries` | 自定义纪念日；`repeat_yearly` 每年提醒、`updated_at` | T-050 + 0051 |
| `cards` | 卡片；`(user, character, idempotency_key)` 唯一；`scene_week` 部分唯一索引限制名场面每角色每周 1 张 | 0050 |
| `achievement_unlocks` | 已获得成就，**删除角色时不删** | 0050 |
| `achievement_counters` | 累计计数：`active_contacts`（取历史最大）、`favorites_total`、`cards_total` | 0050 |
| `contact_index` | growth 自己的通讯录索引（纪念日扫描用，growth 不能读 contacts 的表） | 0051 |
| `notices` | 一次性通知去重（自定义纪念日到达） | 0051 |

0051 同时给 `proactive.holidays` 加了 `category`、`send_card`、`card_template_id`、`character_categories`（节日清单设计补充，契约 3.0.2）。

## 2. 发卡

统一入口 `CardsService.issue`（也实现契约 `GrowthCardPort.issueCard`）：每用户每角色加 advisory 锁 → 幂等键查重 → 名场面周限 → 编号 = 最大编号 + 1 → 选卡面 → 写卡 → 成就 22/23、`growth.card_issued`、私聊系统提示 `card_obtained`、`data.changed(cards)`。

| 卡 | 触发 | 幂等键（每角色） |
|---|---|---|
| 纪念卡 | 每小时扫描（`growth.anniversary_sweep`，每小时第 5 分），按用户时区，认识第 7、30、100、200、365 天，之后每 100 天和每个周年；停机错过的 7 天内补发 | `anniversary:{N}` |
| 熟悉度卡 | 升级时每跨一级一张（L2～L5） | `familiarity:{L}` |
| 节日卡 | 节日当天用户在私聊发消息；节日 `sendCard=true` 且角色分类在适用范围内 | `holiday:{holidayId}:{当地日期}` |
| 瞬间卡（系统） | 第一次接通通话、被角色拉进群、角色在朋友圈回复你（ai_runtime.milestone `moments_replied_user`） | `moment:first_call` / `moment:pulled_into_group` / `moment:moments_reply` |
| 名场面 / 宠物 / 玩法卡 | ai-runtime 等经 `GROWTH_CARD_PORT` 发；`kind=moment` 且带 `sourceMessageIds` 视为名场面，受每周 1 张限制（返回 `weekly_moment_limit`） | 调用方给 |

卡面：调用方给了生成图（`faceMediaId`）直接用；否则在素材库同类模板（`MEDIA_ASSET_READ_PORT.listCardTemplates`）里挑，指定模板合规则用指定的，否则按编号轮换（确定性，不是随机）。角色 `portraitPolicy != allowed`（真人，含历史人物，保守处理）只取 `portraitFree` 模板。没有模板时卡面为空，客户端用类型色占位。卡面 `url` 读取时经 `MEDIA_READ_PORT.getMedia` 现取（5 分钟有效）。

卡上那句话：growth 自己发的卡用模板文案（`CARD_LINES`），不调用 AI。

## 3. 成就

34 个定义在 `domain/achievements.ts`（名称、条件抄 PRD）。事件来源：

| 编号 | 事件 |
|---|---|
| 1、3、4、5 | `contacts.contact_accepted`（4、5 用当前联系人数） |
| 2、6、9、10 | `chat.message_created`（用户发送；按 contentType） |
| 7、8、11、15 | `ai_runtime.milestone`（11 也认角色私聊语音消息） |
| 12、13 | `calls.call_answered` |
| 14、15 | `chat.group_members_changed` |
| 16、17、18 | `moments.post_created` / `comment_created` / `post_liked` |
| 19、20、21 | `library.favorite_added` / `share_image_generated` |
| 22、23 | growth 发卡时 |
| 24～26 | 纪念日扫描（认识天数 ≥ 7 / 100 / 365） |
| 27、28 | 熟悉度升级 |
| 29、30 | `growth.pet_adopted` / `pet_stage_changed(adult)` |
| 31～34 | `play.wishlist_item_completed` / `daily_answer_submitted` / `letter_delivered` / `focus_ended` |

获得时：`growth.achievement_unlocked` + `data.changed(achievements)`（itemId 为 null，客户端重拉成就页，按 `unlockedAt` 比较找出新获得的弹轻提示）。

## 4. 熟悉度加分

`GrowthService.awardPoints`（HTTP `addPoints` 也走这里）：幂等、每角色每天 20 点（按用户当地日期）。T-076 修正了 P-25 分值取不到的问题。升级时发 `growth.familiarity_leveled_up`、熟悉度卡、系统提示 `familiarity_level_up`。
「首次完成某互动」+5：第一次通话、第一次群聊（建群时群内角色）、领养、每日一问、完成心愿、寄信、专注、设提醒——各自订阅事件，每用户每角色每种只计一次（键 `first:{种类}:{userId}:{characterId}`）。纪念日当天私聊 +10（`anniversary_chat`）。

## 5. 删除

- 删除角色（软删除）：`contact_index.active=false`，其余保留，30 天内恢复照旧。
- 彻底删除（`contacts.contact_purged`）：删该角色的卡片、熟悉度、流水、纪念日、索引；**成就不删**。
- 注销：删除清单登记为模块 `growth`，清除本模块全部表。T-077 的宠物表请并入同一个登记（`GrowthEvents.purgeUser/countUserData`），不能再登记一次 `growth`。

## 6. 系统提示 code（客户端按 code 渲染）

| code | params |
|---|---|
| `card_obtained` | `cardId`、`serialNo`、`kind`、`title`；纪念卡另有 `daysKnown`，熟悉度卡 `level`、`levelName`，节日卡 `holidayName`，系统瞬间卡 `momentKind` |
| `familiarity_level_up` | `characterId`、`characterName`、`level`、`levelName` |
