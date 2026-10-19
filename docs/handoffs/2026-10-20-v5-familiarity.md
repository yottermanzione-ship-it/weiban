# 交接说明：会员 v5 · 好感度（熟悉度）提速与会员翻倍

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人 |
| 日期 | 2026-10-20 |
| 依据 | `docs/refactor/16-membership-v5.md` 第 11 节 |
| 分支 | `v5-familiarity`（从 `local/trunk` 16a1ec0 建，未 push、未合入） |

## 做了什么

1. **参数**（`P25_FAMILIARITY`）：PRO+ 倍率 1.2 → 2；每角色每日上限 20 → 350（PRO+ ×2 = 700）；新增 `points.userMessage = 4` 和有效消息规则 `userMessage.minChars = 2`、`minIntervalMs = 3000`。满级阈值不变（30/100/300/700）。
2. **按消息加分**：新订阅者 `growth.familiarity_on_user_message` 监听 `chat.message_created`（和原有成就订阅分开，失败重试互不影响）。
   - 目标角色：私聊 → 对方角色（经通讯录端口按会话找）；群聊 → 被 @ 的角色（经 `ChatReadPort.getParticipants` 把参与者 ID 换成角色 ID）。没 @ 的群消息不计。
   - 只算文字消息和语音的转写文字；图片、表情、拍一拍等不计。
   - 正文经 `ChatReadPort.getMessage` 按该消息自己的内容范围读取，只用于数字数和算指纹，**不保存正文**。
   - 有效判定（纯函数 `evaluateUserMessage`）：去空白后 ≥2 字（emoji 算一个字）；与该用户对该角色上一条消息（不论是否计分）去空白后不完全相同；距上一条计分消息 ≥3 秒（按消息发送时刻，乱序到达取差的绝对值）。
   - 幂等键 `user_message:{messageId}:{characterId}`（群里 @ 多个角色各计一次，同一消息重投只计一次）。与原有加分共用同一把行锁（advisory lock），并发安全。
3. **原有加分项**（有效聊天日、回复主动消息、朋友圈互动、纪念日、首次互动）不变，同受新上限约束、同样 ×2（倍率计算抽成 `scaledPoints`）。
4. **数据库**：迁移 `0106_familiarity_message_points`，给 `growth.familiarity` 加两列 `last_message_hash`（上一条消息指纹）、`last_message_scored_at`（上一条计分时刻）；有回滚脚本。彻底删除角色 / 注销时随熟悉度行一起删，无需改删除清单。
5. **契约未改**：`user_message` 只是服务器内部事件类型（`GrowthFamiliarityEventType`），契约里的 `FamiliarityEventType` 不变，客户端也不能经 HTTP 上报这个类型。
6. **测试**：新增 `familiarity-rules.test.ts`（9 条：参数与翻倍、阈值、字数、重复、3 秒间隔、乱序、emoji）。原来没有 growth 单测，无需改断言。

## 改了哪些文件

- `apps/server/src/platform/config/product-params.ts`
- `apps/server/src/modules/growth/domain/familiarity-rules.ts`
- `apps/server/src/modules/growth/domain/familiarity-rules.test.ts`（新）
- `apps/server/src/modules/growth/application/growth.service.ts`
- `apps/server/src/modules/growth/application/growth-events.ts`
- `apps/server/src/modules/growth/infra/db/schema.ts`
- `apps/server/drizzle/0106_familiarity_message_points.sql`、`.down.sql`（新）、`apps/server/drizzle/meta/_journal.json`
- `docs/backend/growth.md`（第 4 节）、`docs/backend/membership-v5.md`（第 8 节）

## 自测结果（本机一次）

- `pnpm typecheck`（全仓）通过；`eslint`（改动文件）通过；`pnpm lint:deps`（depcruise）无违规；`apps/server` build 通过；`vitest run apps/server/src/modules/growth` 9/9 通过。
- 未在真实数据库上跑迁移和端到端（按要求不碰服务器）。

## 遗留问题

- **文档冲突**：`docs/product/prd-v1.md` P-25 仍写「每角色每天最多 20 点……最快 35 天到 L5」，与 16 号 §11 不一致。按规则我不改 PRD，请产品负责人更新 P-25（可改为引用 16 号 §11）。
- 判断「有效聊天日」`active_chat_day` 目前服务器内部没有触发点（只能经 HTTP `addPoints` 上报），这是原状，本次未动。
- 指纹比较是「去空白后完全相同」，只换个标点就算不同；16 号 §11 写的是「不是和上一条完全相同」，按字面实现，够用；如要更严（如忽略标点）再调。
- 迁移编号 0106 插在已有 0107/0108 之间：本项目迁移器按 tag 判断是否执行，已跑过 0107/0108 的库也会补跑 0106，不受影响。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：分支 `v5-familiarity` 可合入 `local/trunk`；与生态批（契约 3.19）无契约冲突，迁移只用了 0106。
- 给产品负责人：请按上面「文档冲突」更新 PRD P-25。
- 给 Web / Android：无接口变化；熟悉度数值会涨得更快，界面上不展示分值（`cards-familiarity.md` 原规定不变）。
