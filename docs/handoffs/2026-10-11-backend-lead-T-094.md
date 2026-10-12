# 交接说明：T-094 L7 玩法四：陪你专注（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `T-094-play-focus`，`b36940d`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0068_play_focus`（含 .down.sql，不删 play schema；已登记 journal） |
| 自检 | server `tsc`、根目录 `pnpm lint`（含 dependency-cruiser）通过；按约定未写、未跑测试，未在数据库执行迁移 |

## 做了什么

实现说明见 `docs/backend/play.md` 第 5 节。

1. **开始专注**：
   - 时长只能是 5～120 分钟；同一时间只能有一次（409 `focus_in_progress`，数据库唯一索引兜底）；重复提交只算一次。
   - 以服务器时间计时，同一事务里投递到点任务；「做什么」加密保存。
   - 发 `play.focus_started{endsAt}`。
2. **结束专注**：
   - 时间到由任务和每分钟扫描自动结束（completed）。
   - 用户可以提前结束（ended_early），重复点只算一次。
   - 两种结束都发 `play.focus_ended`，growth 记首次专注 +5 和第 34 号成就，提前结束也算。
   - 没有「失败」状态，不保存累计时长，不做排行。
3. **「用户正在专注」查询**：
   - `GET /play/focus` 和 `PlayReadPort.getActiveFocus` 已实现。
   - ai-runtime 已接上：`AiRuntimeModule` 引入 `PlayModule`；`QuietStateService` 新增 `getFocusUntil(userId)`；`GET /me/quiet-state` 的 `focusUntil` 现在有真实值。这是 ai-runtime 里的最小改动。
4. **删除角色**：进行中的专注照常计时到结束；彻底删除时删除记录；注销时也会删除。

## 改了哪些文件

- `apps/server/src/modules/play/`：`application/focus.service.ts`（新）、`http/focus.controller.ts`（新）；改 `infra/db/schema.ts`、`play.module.ts`、`application/{play-ports,play-lifecycle}.ts`
- `apps/server/src/modules/ai-runtime/ai-runtime.module.ts`、`application/quiet-state.ts`
- `apps/server/drizzle/0068_play_focus.sql` / `.down.sql`、`meta/_journal.json`
- `docs/backend/play.md`

契约未改，所以 Android 生成物不需要重新生成。

## 遗留问题

- 按约定没写测试，没在数据库上实际跑过。
- **专注期间「所有角色安静」还没真正生效**：目前只是能读到专注状态。主动消息延后、来电不拨出、群聊不自发话题，需要 ai-runtime 的调度器、来电调度、群聊调度在决策时调用 `QuietStateService.getFocusUntil` 或 `PlayReadPort.getActiveFocus`（T-096 / ai-lead 范围，我没有改调度器）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-096 / ai-lead）：
  - 订阅 `play.focus_started`，让 TA 发一句加油。可以从 `getActiveFocus(userId).note` 取「做什么」，它可以成为记忆。
  - 订阅 `play.focus_ended`：result = completed 时说「辛苦啦」并聊刚才做了什么；ended_early 时只说「那先休息一下吧」这类话。
  - 主动消息、来电、群聊自发话题在决策时检查 `QuietStateService.getFocusUntil(userId)`，非 null 就延后（按 P-09 处理）。
- 给 Web / 安卓：接口按 `FocusEndpoints`；收到 `data.changed(section=focus)` 后重新拉 `GET /play/focus`；倒计时以 `endsAt`（服务器时间）为准。
- 给总负责人：已合并进 `local/trunk`（`b36940d`）。
