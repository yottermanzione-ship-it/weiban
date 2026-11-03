# T-20261103h 私聊回复条数放宽：文字最多 6 条，加表情或图片总共最多 8 条

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead（拆句、提示词）+ backend-lead（迁移） |
| 分支 | `feat/reply-bubble-cap-8-20261103`（worktree `C:\wb-dev\wb-t1103h`） |
| 状态 | 待派发 |
| 来源 | 总经理 2026-11-03：「数据库为什么非要规定 4 条？就不能再多一点吗」。总负责人建议文字最多 6 条、表情或图片另算、总共最多 8 条，总经理未反对 |
| 必读 | `apps/server/src/platform/config/product-params.ts`（`P02_SPLIT_BUBBLES.maxBubbles: 4`）、`domain/reply-rules.ts`、`domain/reply-delivery.ts`、`application/reply-engine.ts`、`apps/server/drizzle/0012_ai_replies.sql`（`reply_plan_counters`：`next_bubble <= 4`）、`docs/handoffs/2026-11-03-reply-stuck-plans.md`（#48 的封顶做法）、`docs/handoffs/2026-11-03-chat-photo-group-sticker.md`（#51，开工时可能已合入） |

## 要求

1. **两个上限分开**：文字气泡上限 6 条，整条回复总上限 8 条。总数包括文字、表情包、照片、作品链接，以及「撤回」和「打错字」两种小习惯带出来的额外条。
   - 拆几条仍由内容决定。提示词里如果有「1 到 4 条」「最多 4 句」这类说法，改成和新上限一致；同时说明短话照样一两条，不要为了凑条数硬拆。
   - #48 的封顶逻辑改用新上限，合并、丢弃的优先级保持不变。
2. **迁移**：新迁移把 `reply_plan_counters` 里的 `next_bubble <= 4` 改为 `<= 8`，同时提供 down 文件。迁移编号接在当前最新编号之后（开工时看 `apps/server/drizzle/meta/_journal.json`）。down 迁移要考虑已有 `next_bubble > 4` 的行，按项目现有 down 迁移的惯例处理，并在交接里写明。
3. **群聊不变**：群聊仍最多 3 条（`GROUP_MAX_BUBBLES`）。
4. **主动消息**：确认主动消息的条数上限和私聊回复一致，或者有自己的上限；在交接里写明。
5. **文档**：
   - PRD `docs/product/prd-v1/04-chat.md` 的 P-02，以及 `docs/product/glossary.md` 里「1–4 条」的说法同步改掉；
   - `docs/ai/runtime-overview.md` 同步更新；
   - 文档里写明这是总经理 2026-11-03 的调整。
6. **测试**：
   - 6 条文字 + 表情 = 7 条，能正常发完；
   - 7 条以上文字被合并到 6 条；
   - 总数超过 8 条时按优先级合并或丢弃；
   - `next_bubble` 能写到 8 而不违反约束；
   - 已有真库用例同步更新。

## 规矩

- 开工先 `git fetch origin`，合并最新 origin/main（用 merge，不 rebase、不 force-push）。#51 若已合入，要一起照顾照片。
- 分支 → PR（base main）→ CI。不推 main、不合并、不部署、不碰服务器。做到一半就及时推远端分支。
- 本机只跑一次相关检查，其余交给 CI。不读用户私聊原文。
- 不改契约字段；如果必须改，先停下回报。
- 交接写 `docs/handoffs/2026-11-03-reply-bubble-cap-8.md`，写明迁移编号和提示词改动原文。
