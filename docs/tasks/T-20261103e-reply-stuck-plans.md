# T-20261103e 私聊回复卡死两例修复（气泡数超限、等待中的回复永不恢复）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（回复计划、任务队列）+ ai-lead（气泡拆分） |
| 分支 | `fix/reply-stuck-plans-20261103`（worktree `C:\wb-dev\wb-t1103e`） |
| 状态 | 待派发 |
| 来源 | 11-02 交接遗留「10-30 卡住的会话复查」；总负责人 11-03 只读生产实查（只看任务状态和计数，未读聊天内容） |
| 必读 | `apps/server/src/modules/ai-runtime/application/reply-engine.ts`、`plan-store.ts`、`lifecycle.ts`（`ai.recover_replies` 的触发点）、`domain/reply-rules.ts`（`P02_SPLIT_BUBBLES`）、`apps/server/drizzle/0012_ai_replies.sql`（`reply_plan_counters`） |

## 例 1：回复拆成 5 条，写库违反约束，重试 47 次后作废

- **生产事实**：10-29 20:09（北京时间）有一条回复计划，`ai.generate_reply` 连续失败 47 次。错误是 `new row for relation "reply_plans" violates check constraint "reply_plan_counters"`（23514），出错的语句是把 status 置为 done 的那次更新。计划最后变成 cancelled，`next_bubble=4`。
- **约束**：`reply_plan_counters` 要求 `next_bubble` 在 0 到 4 之间。推断是这次回复实际拆出了 5 条气泡，发完第 5 条时要写 `next_bubble=5`，于是违反约束。
- **要求**：
  1. 找出为什么会出现 5 条以上气泡：`P02_SPLIT_BUBBLES.maxBubbles` 之外，是否还有路径会追加气泡，比如表情或语音附加、重写、#47 的表情标记剥离后重新拆分，或者主动消息。
  2. 二选一修复，选哪种并说明理由：
     - (a) 所有出口统一封顶 4 条，多出的合并进最后一条；
     - (b) 新迁移放宽约束。
  3. 这类违反约束的错误重试多少次都没用，不能再让 pg-boss 空转几十次。确定性失败要快速结束，并把计划标成明确的失败或作废。
  4. 已经发出去的气泡不能重发。顺带看看「已生成并发送第一气泡后重启应用」这个偶发失败的集成测试（`test/ai-runtime.test.ts`，偶发 expected 3 to be 2）是否和这里有关。它在 CI 上反复出现，可能是真缺陷，不只是测试时序问题。查清楚后在交接里写结论。

## 例 2：模型不可用时回复进入「等待」，之后再也没有恢复

- **生产事实**：10-30 00:45 有一条回复计划，至今 `status='waiting'`，`failure='provider_unavailable'`。这个会话里用户 10-30 00:45 发的 2 条消息没有收到回复。之后会话里只有角色的主动消息和 1 条系统消息，用户再没发过消息。
- **原因**：等待中的计划只靠 `ai.recover_replies` 恢复，触发点只有四个：积分恢复、模型状态变为可用、成人检查器配置，以及 `plan-store` 里的个别场景。如果供应商只是这一次调用失败，没有触发「模型状态变化」事件，这条计划就永远等下去。
- **要求**：
  1. 加一个定时巡检，比如每 5 到 10 分钟一次，处理 `failure` 属于可恢复类型（provider_unavailable 等）的 waiting 计划：退避重试，复用现有 `recover` 的逻辑，每个会话只恢复最新批次。
  2. 设最长等待时间，建议 6 小时，可配置成常量。超时的计划改为 cancelled，不再回复，免得几天后突然冒出一条回复。这个上限内恢复的回复，沿用现有「有意稍等了一会儿」的提示。
  3. 积分不足这类需要用户自己处理的等待，仍由原触发点恢复，巡检不碰。
  4. 上线后，10-30 那条会被巡检按超时作废，这是预期结果，交接里写明。

## 测试

- 例 1：单测或集成测试覆盖两点：5 条以上气泡不再违反约束；确定性数据库错误不会被无限重试。
- 例 2：单测覆盖三点：巡检能恢复可恢复的等待；超时的会作废；积分不足的等待不被巡检碰。

## 规矩

- 开工前先 `git fetch origin`，如果 #47（表情包模型自决，改了 `reply-engine.ts` 和 `media-ai.ts`）已合入，先合并 origin/main，用 merge，不 rebase、不 force-push。
- 分支 → PR（base main）→ CI。不推 main、不合并、不部署、不碰服务器。做到一半就及时推远端分支。
- 本机只跑一次相关检查，其余交给 CI。不读用户私聊原文。
- 如果走 (b) 加迁移，迁移编号接在当前最新编号之后，并在交接里写明。
- 交接写 `docs/handoffs/2026-11-03-reply-stuck-plans.md`。
