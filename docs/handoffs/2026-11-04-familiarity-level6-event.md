# 交接说明：T-20261104d 熟悉度升到第 6 阶段时事件校验失败

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-11-04 |
| 分支 | `fix/familiarity-level6-event-20261104`（基于 origin/main `6256972e`） |
| 任务卡 | `docs/tasks/T-20261104d-familiarity-level6-event.md` |
| 契约 | 5.3 → 5.4（只放宽 `growth.familiarity_leveled_up` 的 `level` 上限，总负责人已批准） |
| 迁移 | 无（数据库 `familiarity_level_check` 早已是 1–6，迁移 0122） |

## 结论

用户从「恋人」（第 5 阶段）升「伴侣」（第 6 阶段）时，服务器要发一个「升级了」的内部事件。契约里这个事件的阶段号还写死最大 5，发事件时校验不通过，整笔加分跟着撤销。所以用户永远停在第 5 阶段，之后每条消息都重复报错。

现在阶段号的上限直接引用契约里已有的「好感度阶段」定义 `FamiliarityLevel`（1–6），不再单独写数字。以后阶段数再变，只改一处。第 5→6 阶段升级已有真实数据库测试：事件发出、阶段落库为 6、系统提示和「伴侣」卡都发出，之后继续聊天不重复升级、不报错。

## 做了什么

1. **契约**：`Events.FamiliarityLeveledUp.payload.level` 由 `z.number().int().min(2).max(5)` 改为 `FamiliarityLevel.min(2)`，上限跟 `FamiliarityLevel` 走，目前是 6。版本号 5.3 → 5.4，README 已写变更记录。这是放宽取值范围、不删不改字段，按规则升次版本。项目版本号只有「主.次」两位，没有补丁位。这个事件只在服务器模块之间传，不发给客户端；WebSocket 鉴权已放行 5.x。
2. **安卓生成契约**：用 `pnpm android:generate` 重新生成，变化只有三处：版本号；两个事件载荷类的 `level` 类型从 `Long` 改为 `FamiliarityLevel`（它本身就是 `typealias FamiliarityLevel = Long`）；`contracts.json` 的版本号。图标和设计令牌没有变化。
3. **第 6 阶段各项取值核对**（第 2 条，都有值，不会出现空串或越界）：
   - 阶段名：`FAMILIARITY_STAGE_NAMES[5]` = 伴侣；`LEVEL_NAMES[6]` 由它生成。
   - 卡片：标题 `familiarityTitle(6)` = 伴侣；台词 `CARD_LINES.familiarity(6)` = 「往后的日子，也想一直和你一起过。」；幂等键 `familiarity:6`。卡册「未获得」列表按 `MAX_STAGE` 循环到 6。
   - 系统提示：`familiarity_level_up` 参数为 `level: 6, levelName: 伴侣`；`card_obtained` 同样带这两个参数。
   - 成就：契约里没有第 6 阶段专属成就。升到 6 时照常补解锁 `familiarity_l3` / `familiarity_l5`（已获得的不重复，不越界）。
   - ai-runtime 消费者 `ai.call_permission_ask`：条件是 `level >= 3`，而且还受 `PROACTIVE_CALLS_ENABLED` 开关控制（目前关闭）。6 能正常处理。
   - 提示词阶段语气：`STAGE_PROMPTS[6]` 有值，`relationshipStageText` / `stageLabel` 都按 `FAMILIARITY_STAGE_NAMES` 取。
4. **同类写死 5 的核查**（第 3 条），清单见下一节。只有一处需要动代码：朋友圈点赞概率表。
5. **测试**：新增真实数据库测试 `apps/server/test/growth-familiarity-stage6.test.ts`，契约测试补正反两面，点赞概率补第 6 阶段的断言。

## 第 3 条：熟悉度阶段写死 5 的核查清单

| 位置 | 情况 | 处理 |
|---|---|---|
| 契约 `Events.FamiliarityLeveledUp.level` | `max(5)`，本次事故的原因 | **已改**，跟 `FamiliarityLevel` 走 |
| 服务端 `ai-runtime/domain/moments-reactions.ts` `userPostLikeProbability` | 点赞概率表按五级写死，用 `Math.min(5, level)` 把 6 截成 5。不报错，第 6 阶段按第 5 阶段取值 | **已改**：表补到第 6 阶段（值与第 5 阶段相同，行为不变），上限改按表长；注释「1–5」改为「1–6」 |
| 契约 `FamiliarityLevel`、`FamiliarityInfo.level`、`FamiliarityStageSettings.freeCeilingLevel` | 1–6 | 不用改 |
| 契约 `FamiliarityStageThresholds` / `FamiliarityStageSettings.stageNames` | `.length(6)` | 六阶段，不用改 |
| 系统提示 `SystemContent.params`（`familiarity_level_up`、`card_obtained`） | 通用键值，没有上限 | 不用改 |
| 推送通知 `NotificationPayload`、同步 `data.changed(familiarity)` | 不带阶段号 | 不用改 |
| 数据库 `growth.familiarity` 约束 | `level BETWEEN 1 AND 6`（迁移 0122） | 不用改 |
| 服务端 `growth.service.ts` `newLevel >= 5`（解锁成就 28）、`level >= 5`（是否恋人） | 「恋人及以上」，第 6 阶段同样成立 | 不用改 |
| 服务端 `play/application/context.ts` 恋人阶段常量 5、`relationship-stage.ts` `ROMANCE_TITLE_STAGE = 5` / `FLIRT_STAGE = 4` | 都是下限（「从第 5 阶段起」） | 不用改 |
| 网页 `apps/web/src/features/growth.tsx` 阶段图标 | 6 个（◔ ◑ ◐ ◕ ● ♥），阶段名取契约 | 不用改 |
| 角色卡 WB-Card `persona.growthByFamiliarity` | 只有 `L1`–`L5`（严格对象） | **未改，列为遗留**：这是角色卡内容格式，不是运行时阶段校验；提示词把各条全列出，不按当前阶段取值，不会报错或越界。要不要加 `L6` 牵涉角色卡格式版本与已有卡，归 AI / 架构 |
| 设计令牌 `--wb-color-familiarity-l1…l5`（`docs/design/tokens.css`）与安卓 `WbTokens.familiarityL1…L5` | 只有 5 个颜色 | **未改，列为遗留**：网页和后台都没有引用这组令牌；安卓原生已暂缓。归设计负责人 |

## 改了哪些文件

- `packages/contracts/src/events.ts`：`FamiliarityLeveledUp.level` 改为 `FamiliarityLevel.min(2)`（新 import `./http/growth.js`，无循环依赖）
- `packages/contracts/src/version.ts`：5.3 → 5.4
- `packages/contracts/README.md`：变更记录 5.4
- `packages/contracts/test/schemas.test.ts`：事件接受 2–6，拒绝 1、7、5.5
- `packages/contracts/test/service-unit-pricing.test.ts`：版本号断言改为 5.4
- `apps/android/core/contracts-generated/src/main/kotlin/app/weiban/contracts/Contracts.kt`、`.../resources/contracts.json`：重新生成
- `apps/server/src/modules/ai-runtime/domain/moments-reactions.ts`、`.test.ts`：点赞概率表补第 6 阶段
- `apps/server/test/growth-familiarity-stage6.test.ts`（新）：真实数据库测试第 5→6 阶段
- `docs/backend/growth.md`：熟悉度卡「L2～L5」改为第 2～6 阶段，并注明事件上限
- `docs/tasks/T-20261104d-familiarity-level6-event.md`：状态改为「待验收」

## 自测（开发自测，非独立验收）

本机各跑一次，全部通过：

- `pnpm --filter @weiban/contracts typecheck`、`build`；`vitest --project contracts`：8 个文件、91 个用例通过
- `pnpm --filter @weiban/server typecheck`：通过
- 改动文件 `eslint`、`pnpm lint:deps`：通过，没有依赖违规
- `pnpm android:generate:check`：通过；改动文件 `prettier --check`：通过
- 服务端单元测试 `moments-reactions.test.ts`、`familiarity-rules.test.ts`：15 个用例通过
- 真实数据库测试 `growth-familiarity-stage6.test.ts`：2 个用例通过。为了不和同事共用的 `weiban_test` 互相清库，用的是临时库 `weiban_test_lv6`，跑完已删除。测试做法：
  - 好友关系只替换「读联系人」端口，让它指向一个真实私聊会话；
  - 「是否充值过」设为是，否则卡在「亲密好友」上限；
  - 卡片文案不调模型。
  - 事件经真实 `Outbox` 按契约校验写入，系统提示经真实 chat 写进私聊（断言 2 条系统消息）。
  - 加分走与生产订阅者相同的 `GrowthService.awardUserMessage`，从 696 点、第 5 阶段开始，一条有效消息后：
    - 到 700 点、第 6 阶段；
    - 发出一个 `level: 6` 的事件；
    - 系统提示的阶段名为「伴侣」，并发一张「伴侣」卡；
    - `getFamiliarity` 返回第 6 阶段、没有下一阶段。
  - 再发一条：704 点，没有第二个升级事件。

整套测试和安卓 Gradle 构建以 CI 为准。

## 遗留问题

1. **被放弃的 14 个事件（只说明，未碰生产）**：
   - **影响范围**：事件分发器对每个订阅者分别记录。这 14 条 `chat.message_created` 只有 `growth.familiarity_on_user_message` 失败，AI 回复等其他订阅者当时都已成功处理，不受影响。
   - **少记的东西**：这 14 条消息各少记了 4 点熟悉度，合计最多 56 点。消息里如果有「别叫我宝贝」「叫我老婆」这类话，「暂停亲密表达 / 称呼」也没有记下（同一事务一起撤销了）。
   - **用户会自然升级**：受影响用户的累计点数都停在升级线以下（升级那一刻整笔撤销）。修复上线后，下一条有效消息就会正常升到第 6 阶段。阶段不需要人工修复。
   - **建议不补投递**。如果把这 14 条重新投递，事件分发器会按订阅者去重，只有熟悉度这一个订阅者会重跑。但它们会排在之后的新消息后面执行：旧消息里的「暂停 / 恢复亲密表达」可能覆盖用户后来说的新意思，点数也会记到补投递那天的当日上限里。
   - **如果总负责人仍要补**：只能在修复上线之后，由运维先人工看过这 14 条再处理。
2. 角色卡 `growthByFamiliarity` 只有 L1–L5、设计令牌只有 5 个熟悉度颜色：见上表，交给对应负责人判断，不影响这次的问题。
3. 契约版本号 5.4：如果同期还有别的分支升契约版本，后合并的一方需要顺延版本号并重新生成安卓契约。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给项目总负责人：PR 合并、部署后，生产里停在第 5 阶段的用户会在下一条有效消息时升到第 6 阶段。部署后可以看日志确认 `growth.familiarity_on_user_message` 不再出现 `payload.level … expected number to be <=5`。14 个已放弃的事件建议不补，理由见遗留 1。
- 给 ai-lead：`growth.familiarity_leveled_up` 现在会带 `level: 6`。朋友圈点赞概率表已补到第 6 阶段，取值与第 5 阶段相同，行为不变；要给「伴侣」调高或调低，改 `LIKE_BY_STAGE`。角色卡 `growthByFamiliarity` 要不要加 `L6`，请评估（牵涉角色卡格式）。
- 给 android-lead：生成契约只变了版本号和两个事件载荷的 `level` 类型（仍是 `Long` 的别名），客户端代码不用改。
- 给 design-lead：熟悉度颜色令牌仍是 5 级（`familiarity-l1…l5`），六阶段需要的话请补 `l6`。目前网页没有引用这组令牌。
- 给 Codex（验收）：重点看事件 schema 的正反用例、`growth-familiarity-stage6.test.ts`，以及 CI 的 `android:generate:check`。
