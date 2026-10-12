# 交接说明：T-093 L7 玩法三：慢信（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `T-093-play-slow-letter`，`dd5c1bb`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0067_play_letters`（含 .down.sql，不删 play schema；已登记 journal） |
| 自检 | server `tsc`、根目录 `pnpm lint`（含 dependency-cruiser）通过；按约定未写、未跑测试，未在数据库执行迁移 |

## 做了什么

实现说明见 `docs/backend/play.md` 第 4 节。

1. **信件与状态**：
   - 来信 草稿 → 已寄出；回信 在路上（等生成 / 等到点）→ 已送达 → 已读。
   - 每个角色一份草稿，正文加密保存。
   - 送达前接口不给正文，只显示「信件在路上」。
2. **寄信**：
   - 重复提交只算一次。
   - 私聊里出现信件卡片，发送者为用户。
   - 同一事务里建好回信，并定好送达时间。
   - 发 `play.letter_sent`，growth 记首次寄信 +5。
3. **送达时间**：
   - 从寄信起 6～24 小时内随机，落在用户活跃时段，每个角色每个当地日期最多送达 1 封。
   - 都不满足时顺延，`replyDelayed = true`，写信页据此显示「这封的回信会晚一些到」。
4. **到点送达**：
   - 寄信时投递精确到点任务，另有每分钟一次的兜底扫描。
   - 余额不足或模型故障时正文迟迟不到，信保持「在路上」，不会丢。
   - 正文补到后（已过点）立即送达。
5. **送达时**：
   - 私聊出现角色的信件卡片。
   - 推送「XX 给你寄来了一封信」：kind `letter`，不显示内容。这需要改 push 的通知规则，见下方说明。
   - 第一次收到该角色的回信时发瞬间卡。
   - 发 `play.letter_delivered`，growth 记第 33 号成就。
   - 通知客户端刷新（`data.changed(letters)`）。
6. **红点**：等于已送达未读的信数，读信后消失。
7. **角色主动寄信**（纪念日）：`sendCharacterLetter` 直接送达。
8. **删除角色**：进入回收期时，在路上的回信删除，不再送达；彻底删除时删除该角色的全部信件；注销时也会删除。

## 改了哪些文件

- `apps/server/src/modules/play/`：`application/letters.service.ts`（新）、`http/letters.controller.ts`（新）；改 `infra/db/schema.ts`、`tokens.ts`、`index.ts`、`play.module.ts`、`application/{play-ports,play-lifecycle}.ts`
- `apps/server/src/modules/push/domain/notification-rules.ts`：角色寄来的信件卡片改按 kind `letter` 推送。这是 push 模块的改动，只加了一个分支，其他消息不受影响。
- `apps/server/drizzle/0067_play_letters.sql` / `.down.sql`、`meta/_journal.json`
- `docs/backend/play.md`

契约未改，所以 Android 生成物不需要重新生成。

## 遗留问题

- 按约定没写测试，没在数据库上实际跑过。
- **活跃时段数据目前接不上**：P-06 学到的活跃小时归 ai-runtime（表 `user_chat_activity`），play 不能 import ai-runtime。我新建了令牌 `PLAY_ACTIVE_HOURS`，但还没有绑定，所以现在全部按 P-05 默认的 09:00–23:00 算。需要 ai-runtime 导出一个「取用户活跃小时」的提供者，然后在 `app.module.ts` 绑定。
- **契约有歧义**：
  - 情况：契约说 ai-runtime「在 deliverAt 前约 10 分钟生成」，又说「经 deliverLetterReply 送达」，而 `deliverLetterReply` 必须返回 messageId。
  - 我的处理：提前调用时先存正文、到点再送达，返回值里的 messageId 用回信的 letterId 占位；到点后调用，返回真实 messageId。
  - 建议：架构在契约注释里写明这一点。
- 推送 deepLink 用的是 `/play/letters/{letterId}`，需要 Web / 安卓确认这条路由。
- 角色在回收期内被恢复时，原来在路上的回信已经删掉，不会补发（按 PRD「在路上的回信不再送达」处理）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-096）：
  - 订阅 `play.letter_sent`，或在余额恢复后定时调用 `PLAY_READ_PORT.listPendingLetterReplies(userId)`（返回送达前 15 分钟内或已过点、还没有正文的回信）。
  - 用 `getLetterBody(inReplyToLetterId)` 取来信内容，生成回信后调用 `PLAY_AGENT_PORT.deliverLetterReply({letterId: 回信 ID, body, idempotencyKey})`。生成失败就不调用，信会一直在路上。
  - 纪念日寄信用 `sendCharacterLetter`，P-03 / P-04 额度和预算由你们判断。
  - 请提供活跃小时并绑定 `PLAY_ACTIVE_HOURS`（见遗留第 2 条）。
- 给 Web / 安卓：接口按 `LetterEndpoints`；收到 `data.changed(section=letters)` 后重新拉信箱和红点；推送 kind `letter` 的 deepLink 是 `/play/letters/{letterId}`。
- 给架构：请在契约里写明 `deliverLetterReply` 提前调用时的返回语义（见遗留第 3 条）。
- 给总负责人：已合并进 `local/trunk`（`dd5c1bb`）。
