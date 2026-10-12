# 交接说明：T-095 L7 玩法五：TA 的提醒（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `T-095-play-reminders`，`b6e5ea0`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0069_play_reminders`（含 .down.sql，不删 play schema；已登记 journal） |
| 自检 | server `tsc`、根目录 `pnpm lint`（含 dependency-cruiser）通过；按约定未写、未跑测试，未在数据库执行迁移 |

## 做了什么

实现说明见 `docs/backend/play.md` 第 6 节。

1. **提醒增删改**：
   - 每个用户最多 10 条（422 `limit_reached`）；内容最多 20 字；重复提交只算一次。
   - 重复方式：不重复 / 每天 / 工作日 / 自选星期几。
   - 「归类为健康」「免打扰时段也提醒」两个开关，每条可以单独开关。
   - 按用户时区计算下次到点时间。
   - 内容和说法都加密保存（「健康」类必须加密，所以统一都加密）。
2. **预生成说法**：
   - 新建和修改都发 `play.reminder_saved{textChanged}`，growth 记首次设置 +5，不设成就。
   - ai-runtime 生成说法后经 `setReminderPhrasings` 回写；改内容时旧说法作废。
   - 说法没生成时用模板说法。需要补生成的提醒用 `PLAY_REMINDER_PHRASINGS.listRemindersNeedingPhrasings` 取。
3. **到点发送**（1 分钟精度：精确任务加每分钟兜底扫描）：
   - 到点时由 play 自己经 `ChatParticipantPort.postMessage`，以角色身份发一条普通文字消息。
   - 不调用模型，不看余额和后台预算，不占 P-03 / P-04。
   - 遵守免打扰，勾选「免打扰时段也提醒」的那一条除外。
   - 说法轮流使用，「{称呼}」替换为专属称呼，没有就用昵称。
   - 「健康」类消息带 `labels:['health']`：推送不显示内容，不能选入分享图（push 和 library 现有规则已处理）。
   - 晚到超过 30 分钟的（如停机）这次不补发。
4. **删除角色**：该角色的提醒暂停；30 天内恢复角色时自动恢复并重新计算到点时间；彻底删除时一并删除；注销时也会删除。

## 改了哪些文件

- `apps/server/src/modules/play/`：`application/reminders.service.ts`（新）、`http/reminders.controller.ts`（新）；改 `infra/db/schema.ts`、`tokens.ts`、`index.ts`、`play.module.ts`、`application/{context,play-ports,play-lifecycle}.ts`
- `apps/server/drizzle/0069_play_reminders.sql` / `.down.sql`、`meta/_journal.json`
- `docs/backend/play.md`

契约未改，所以 Android 生成物不需要重新生成。

## 遗留问题

- 按约定没写测试，没在数据库上实际跑过。
- **说法的条数**：契约注释写的是「5 种说法」，后端最多保存 10 条，每条截到 40 字，不强制正好 5 条。
- **工作日**只按周一到周五算，不含法定节假日和调休，PRD 没有要求。
- **跟 ai-runtime 的配合**：提醒消息是 play 直接以角色身份写进私聊的。请 ai-runtime 确认以下几点：
  - 收到角色发出的 `chat.message_created` 时，不会把它当作主动消息计入额度；
  - 不会因此触发回复；
  - 推演不会受影响。
- 模板说法有 4 条固定文案，例如「{称呼}，该{内容}啦～」；内容不像动作时（如「药」），读起来会有点生硬。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-096）：
  - 订阅 `play.reminder_saved`，textChanged = true 时用 `getReminder(reminderId)` 取内容，生成 5 种角色口吻的说法（每条 ≤40 字，可含 `{称呼}`），调用 `PLAY_AGENT_PORT.setReminderPhrasings`。
  - 失败就不调用，余额恢复后用 `PLAY_REMINDER_PHRASINGS.listRemindersNeedingPhrasings(userId)` 补生成。
  - 到点发送 play 已经自己完成，T-096 不需要处理到点。
  - 请确认遗留第 3 条。
- 给 Web / 安卓：接口按 `ReminderEndpoints`；收到 `data.changed(section=reminders)` 后重新拉列表；`nextFireAt` 为 null 表示已停用、已过的单次提醒或暂停中，暂停中看 `pausedByContactRemoval`。
- 给总负责人：已合并进 `local/trunk`（`b6e5ea0`）。play 模块五个玩法（T-091～T-095）的后端都已完成。
