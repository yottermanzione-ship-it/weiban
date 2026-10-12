# 交接说明：T-091 L7 玩法一：每日一问（后端）+ play 模块公共骨架

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `T-091-play-daily-question`，`3d24306`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0065_play_daily_question`（含 .down.sql，已登记 journal） |
| 自检 | server `tsc`、根目录 `pnpm lint`（ESLint + dependency-cruiser）通过；按约定未写、未跑测试，未在数据库执行迁移 |

## 做了什么

实现说明见 `docs/backend/play.md`（已随分支合入）。

1. **新建 play 模块（上层，schema `play`）和公共骨架**，T-092～T-095 直接往里加：
   - `PlayFeature` 接口 + `PlayLifecycle`：删除清单只登记一次（模块 `play`，汇总各玩法）；订阅 contacts 的删除 / 恢复 / 彻底删除，分发给各玩法；每分钟一次 `play.due_sweep` 兜底扫描。
   - `PlayJobs`：精确到点的延迟任务（与业务写入同一事务投递），配合兜底扫描。
   - `PlayContext`：用户时区与当地日期、通讯录校验、角色画像（恋人 / 儿童 / 真人）、以用户或角色身份写私聊消息、`data.changed`。
   - 契约 `PlayReadPort` / `PlayAgentPort` 已提供（`PLAY_READ_PORT`、`PLAY_AGENT_PORT`）。每日一问部分已实现；其余玩法先返回安全默认值（例如 `getActiveFocus` 返回 null）。
2. **每日一问**：
   - 题库表 + 管理端接口：列表（按标签筛）、新增、编辑、上架 / 下架，操作写审计。迁移里放了 12 道起步题。
   - 选题按「用户 + 日期」固定，同一天打开看到的是同一道题；不合适时换同日备选题：非恋人不出恋爱题，儿童只出「适合儿童」，真人不出「涉及工作」；已下架的题不出；优先出没答过的题。
   - 作答：1～200 字；当天答完就不能再答（409 `already_answered`）；不能修改；重复提交只算一次（以 `clientRequestId` 判断）。同一事务里完成：保存回答、在私聊写「每日一问」卡片消息（发送者为用户）、记住这次选的角色、发 `play.daily_answer_submitted`、通知客户端刷新。
   - 揭晓状态：pending / ready / waiting_balance。只有 ready 时才返回 TA 的答案，所以提交前和生成中都看不到。
   - 历史：只列答过的日子，按日期倒序分页。
   - 回答和 TA 的答案用用户数据密钥加密保存。注销时全部删除；彻底删除某个角色时，删除和该角色一起答过的记录。
3. **迁移登记检查**：`_journal.json` 与 drizzle 目录逐一核对，所有迁移文件都已登记，`when` 严格递增，没有其他遗漏（0049、0056、0057、0059 是没人用的空号，不是漏登）。T-090 补登 0060～0063 的做法确认没问题。

## 改了哪些文件

- `apps/server/src/modules/play/**`（新）：`play.module.ts`、`index.ts`、`tokens.ts`、`infra/db/schema.ts`、`application/{context,play-feature,play-jobs,play-lifecycle,play-ports,daily-question.service}.ts`、`http/daily-question.controller.ts`
- `apps/server/src/app.module.ts`（注册 PlayModule）
- `apps/server/drizzle/0065_play_daily_question.sql` / `.down.sql`、`meta/_journal.json`
- `docs/backend/play.md`（新）

契约未改动，所以 Android 生成物不需要重新生成。

## 遗留问题

- 按约定没写测试，也没在数据库上实际跑过迁移和接口，留给 Codex 整体验收。
- 契约 `ErrorCode` 里没有「没有合适的题」这个错误码，所以题库为空或没有合适的题时返回 404 `not_found`；客户端需要显示空状态。
- 「上次选的角色」只在提交回答时记录，只是切换头像不会记住。
- 0065 的 `.down.sql` 会删除 `play` schema。T-092～T-095 的 down 文件不要再删 schema；如果要回滚，必须按 0069→0065 的顺序倒着执行。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-096）：订阅 `play.daily_answer_submitted` → 用 `PLAY_DAILY_ANSWER_STATUS.getDailyAnswerForGeneration(answerId)` 取题目和用户回答 → 生成后调用 `PLAY_AGENT_PORT.setDailyCharacterAnswer`，再自己在私聊发一句接话。余额不足时调用 `markDailyAnswerWaitingBalance(answerId)`；收到 `billing.balance_restored` 后用 `listDailyAnswersWaitingBalance(userId)` 补生成。这些都从 `../../play/index.js` 注入。`ai-runtime/application/quiet-state.ts` 现在可以注入 `PLAY_READ_PORT.getActiveFocus` 了（T-094 交付前一直返回 null）。
- 给后端 T-092～T-095（下一步还是我）：按 `docs/backend/play.md` 第 1 节的「新玩法接入步骤」加。删除清单、contacts 事件、到点扫描都已经接好，不要重复登记。
- 给 Web（T-099 / T-100）：接口按 `DailyQuestionEndpoints` / `DailyQuestionAdminEndpoints`。收到 `data.changed(section=daily_question)` 后重新拉 `GET /play/daily-question`；`characterAnswerStatus = waiting_balance` 时显示「余额不足，TA 暂时没法回答」。
- 给 growth：不需要改。首次每日一问 +5 和第 32 号成就已经由现有订阅 `growth.on_daily_answer` 处理。
- 给总负责人：已合并进 `local/trunk`（`3d24306`）。
