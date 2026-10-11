# 交接说明：T-076 growth 第二部分——卡片与成就（附：纪念日编辑与每年提醒、节日清单补充字段）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-076-cards-achievements`，`04ba535`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0050_growth_cards_achievements`、`0051_growth_contact_index_holidays`（含 .down.sql，已登记 journal） |
| 自检 | 根目录 `pnpm typecheck`、`pnpm lint`（含 dependency-cruiser）通过；按约定未写、未跑测试 |

## 做了什么

实现说明全文见 `docs/backend/growth.md`（随分支合入），要点：

1. **卡片（GRW-05）**：纪念卡（按用户时区每小时扫描，认识第 7/30/100/200/365 天及之后每 100 天、每个周年；停机错过的 7 天内补发）、熟悉度卡（每跨一级一张）、节日卡（节日当天用户在私聊发消息时发）、系统瞬间卡（第一次接通通话、被角色拉进群、角色在朋友圈回复你，每角色各一张）。每角色一本卡册、编号从 No.001 递增；没有随机、付费。卡面从素材库同类模板中按编号轮换，真人角色（含历史人物，保守处理）只用不含人物的模板。获得后：私聊系统提示 `card_obtained`、`data.changed(cards)`、`growth.card_issued`。
2. **发卡端口**：契约 `GrowthCardPort` 由 `GROWTH_CARD_PORT` 提供；`kind=moment` 且带 `sourceMessageIds` 视为名场面，每角色每周（用户当地周一起）最多 1 张，超出返回 `weekly_moment_limit`；宠物、玩法卡不受限。
3. **成就（GRW-06）**：34 个全部建好（名称、条件抄 PRD），订阅 contacts、chat、ai_runtime.milestone、calls、moments、library、宠物、玩法事件；只记「是否发生、几次」；删除角色不收回；获得时 `growth.achievement_unlocked` + `data.changed(achievements)`。接口：卡册列表、单本卡册（含未获得的纪念卡接下来 3 张、熟悉度卡 L2～L5 的获得条件）、卡片详情、成就页、熟悉度总览。
4. **首次完成某互动 +5**（P-25，每角色每天 20 点上限沿用）：第一次通话、第一次群聊、领养、每日一问、完成心愿、寄信、专注、设提醒，靠事件自动记账；纪念日当天私聊 +10。
5. **删除清单**：登记模块 `growth`；彻底删除角色时删卡片、熟悉度、纪念日，成就保留；注销时全清。
6. **附带缺口**：纪念日支持编辑（`PATCH /growth/:characterId/anniversaries/:anniversaryId`）和「每年提醒」；自定义纪念日当天发 `growth.anniversary_reached`（kind=custom，不发卡）。节日清单加农历（`lunar_annual`，用 Node 内置农历换算，不引入新依赖）、节日类型、是否发节日卡、指定卡面模板、适用角色分类、今年/明年的公历日期；管理端列表可按类型、恋爱向筛选。
7. **顺手修的 L3 问题**：① 系统纪念日 ID 原为 `system-7`，不符合契约的 UUID 格式（`getDaysKnown` 会报错），改为按角色和天数生成的稳定 UUID；② P-25 分值按驼峰键取值永远取不到（加分接口必报错），已修正；③ 加分的「当天」改用用户时区；④ 升级时原来不发 `growth.familiarity_leveled_up`，现在会发（ai-runtime 的来电询问依赖它）；⑤ 系统纪念日「之后每 100 天」按设计示例改为 100 的整数倍（原代码是 465、565…）。

## 契约变更（最小、向后兼容，标为 3.0.2，`CONTRACT_VERSION` 未改）

- `http/growth.ts`：`Anniversary.repeatYearly`（默认 false）、`AddAnniversaryRequest.repeatYearly`（可选）、新增 `UpdateAnniversaryRequest` 与 `GrowthEndpoints.updateAnniversary`。
- `http/proactive.ts`：`HolidayDateType` 加 `lunar_annual`；新增 `HolidayCategory`、`HolidayCharacterCategory`；`HolidayEvent` 加 `category`、`sendCard`、`cardTemplateId`、`characterCategories`、`upcomingDates`（都有默认值）；创建 / 修改请求加对应可选字段，修改可改 `dateType`（需同时传 `dateValue`）；列表查询加 `category`、`romantic`。
- `ports/proactive.ts`：`UpcomingHoliday` 加可选 `category`、`sendCard`、`cardTemplateId`、`characterCategories`。
- 安卓生成物已用 `pnpm android:generate` 重新生成。
- 注意：旧客户端收到 `dateType = lunar_annual` 的节日会解析失败（只影响管理后台节日页，需随本次一起更新）。

## 改了哪些文件

- `packages/contracts/src/http/growth.ts`、`http/proactive.ts`、`ports/proactive.ts`
- `apps/server/src/modules/growth/**`（新增 `application/context.ts`、`achievements.service.ts`、`cards.service.ts`、`growth-events.ts`、`domain/achievements.ts`、`http/growth-cards.controller.ts`；改 `growth.service.ts`、`familiarity-rules.ts`、`schema.ts`、`growth.controller.ts`、`growth.module.ts`、`index.ts`、`tokens.ts`）
- `apps/server/src/modules/proactive/application/holiday.service.ts`、`application/lunar.ts`（新）、`http/proactive.controller.ts`、`infra/db/schema.ts`
- `apps/server/src/app.module.ts`（绑定 `GROWTH_HOLIDAY_SOURCE` → `HOLIDAY_EVENT_PORT`）
- `apps/server/drizzle/0050_*`、`0051_*`、`meta/_journal.json`
- `apps/android/core/contracts-generated/**`（重新生成）
- `docs/backend/growth.md`（新）

## 遗留问题

- 未写测试、未在数据库上实际跑过迁移和接口（本轮约定），留给 Codex 整体验收。
- 节日卡和纪念日当天 +10 在每条私聊用户消息上多做 2～3 次查询（身份、联系人列表、索引）；个人项目量级可接受，量大时需要加缓存。
- 已有联系人的纪念日索引是「懒补」的：上线前就存在的联系人，要等用户下一次在该私聊发消息或重新添加后才会进入每小时扫描。
- 历史人物可用古风插画（GRW-05 第 2 条），但素材库模板只有「是否含人物」一个标记，目前历史人物也只用无人物模板。要区分需给 `CardTemplate` 加「古风」标记（契约变更，归架构）。
- 农历节日不支持闰月；当年农历没有这一天（如小月三十，除夕可能是廿九）的年份不触发。除夕建议在后台用「只此一次」逐年录入，或以后加「农历月末」规则。
- 成就轻提示的 `data.changed(achievements)` 的 `itemId` 为 null（契约 `Achievement` 没有 ID）；客户端需按 `unlockedAt` 比较找出新获得的。如需精确，可申请在事件里放成就键（契约变更）。
- 系统纪念日的「每 100 天」按设计示例（第 400 天）解释为 100 的整数倍；PRD 原文「之后每 100 天」也可理解为 465、565…，请产品确认。
- 与 T-077（宠物，同在 growth）并行：删除清单只能登记一次 `growth`，T-077 请把宠物表并入 `GrowthEvents.purgeUser / countUserData`，否则启动时会报「重复登记」。迁移 journal 也可能冲突，后合入的一方手动合并。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-082 名场面、宠物 AI）：从 `../../growth/index.js` 注入 `GROWTH_CARD_PORT`，调用 `issueCard(tx, {userId, characterId, kind, title(≤30), line(≤60), faceMediaId, templateId, sourceMessageIds, idempotencyKey})`。名场面用 `kind:'moment'` 并带来源消息 ID（≥1 条），收到 `weekly_moment_limit` 就放弃本周；幂等键在同一用户同一角色内唯一，字符限 `A-Za-z0-9:_.-`、≤200。`GROWTH_READ_PORT` 提供契约 `GrowthReadPort`（熟悉度等级、认识天数）。现有的 `GROWTH_SERVICE` 保持可用。
- 给 ai-runtime：`growth.familiarity_leveled_up` 现在真的会发了（`ai.call_permission_ask` 会开始生效）；新增 `growth.anniversary_reached`（系统纪念日和自定义纪念日当天各一次），可用于纪念日消息。成就 7/8/11/15 和瞬间卡依赖 `ai_runtime.milestone` 的 `proactive_message_sent`、`memory_auto_created`、`voice_message_sent`、`group_invited_user`、`moments_replied_user`，请确认这些都有发出。
- 给后端 T-077（宠物）：发 `growth.pet_adopted`、`growth.pet_stage_changed(stage=adult)` 即可得到成就 29、30 和领养 +5；宠物卡请调 `CardsService.issue` / `GROWTH_CARD_PORT`（`kind:'pet'`，不受周限）。删除清单见上面遗留最后一条。
- 给后端 T-091～T-095（玩法）：发契约里的 `play.*` 事件即可，growth 自动记成就 31～34 和「首次互动」+5（`wishlist_item_completed`、`daily_answer_submitted`、`letter_sent`、`letter_delivered`、`focus_ended`、`reminder_saved`）。心愿、慢信瞬间卡请经 `GROWTH_CARD_PORT` 发（`kind:'play'`）。玩法模块不能 import growth（上层白名单），发卡请在 ai-runtime（T-096）里调用，或由装配入口注入令牌。
- 给 Web（T-083）/ 安卓（T-085）：接口按 `GrowthCardEndpoints`；系统提示 code `card_obtained`（params：cardId、serialNo、kind、title，另有 daysKnown / level / levelName / holidayName / momentKind）、`familiarity_level_up`（characterId、characterName、level、levelName）。卡面 `face.url` 每次读取现取（5 分钟有效），为 null 时用类型色占位。成就提示：收到 `data.changed(achievements)` 后重拉成就页，按 `unlockedAt` 找新获得的。纪念日编辑用新的 PATCH 接口，字段 `repeatYearly`。
- 给 Web 管理后台：节日清单新字段已在接口里（`category`、`sendCard`、`cardTemplateId`、`characterCategories`、`upcomingDates`，`dateType` 可为 `lunar_annual`，农历日期填农历 MM-DD），可以按设计 `admin-content.md` 第 2 节做全；对应 `2026-10-09-web-lead-L3.md` 遗留 2 的「节日清单」「纪念日」两项。
- 给架构：请登记契约 3.0.2 的上述改动（README 变更记录、`contracts-3.0-map.md`），并考虑「卡面模板古风标记」与「成就事件带键」两个可选变更。
- 给总负责人：已合并进 `local/trunk`（`04ba535`）。
