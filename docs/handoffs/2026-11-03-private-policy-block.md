# 交接说明：T-20261103j 私密模型被上游安全策略拦截后反复失败

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead + ai-lead（本任务由开发负责人兼任） |
| 日期 | 2026-11-03 |
| 分支 | `fix/private-policy-block-20261103`（基于 origin/main 09072c20） |
| 任务卡 | `docs/tasks/T-20261103j-private-policy-block.md` |
| 契约 | 不变（5.3）；`minClientVersion` 不动 |
| 迁移 | **0156** `0156_model_blocked_messages`（新建空表，带 down；不动已有数据） |

## 结论

1. **归类修好了**：上游回「被安全策略拦下」时，现在算「内容被拒」（`content_rejected`），不再算「密钥失效」。不管 HTTP 是 400、401 还是 403 都这样算。上游不会再被标成不可用，也不进冷却。只有 401/403 且正文不是安全策略类时，才仍算密钥失效。
2. **会话不再卡死**：某一轮回复被拦时，用户照样收到推托语（关怀中是关怀兜底）。同时把这一轮的用户消息登记为「不再发给模型」。之后所有把这个会话聊天记录发给模型的地方都不带这几条。用户界面照常显示。下一条正常消息能正常回复。
3. **这次已被拦的 3 条历史消息**当时记成了 `invalid_key`，不会被自动登记。上线后请总负责人按第 3 节的 SQL 手工补登记，再按第 4 节恢复上游状态。

## 1. 归类（模型网关）

| 位置 | 改动 |
|---|---|
| `model-access/infra/text-adapter.ts` | 新增 `SAFETY_POLICY_CODES`（`content_filter` / `content_policy_violation` / `moderation_blocked` / `policy_violation`）、`SAFETY_POLICY_TYPES`（`policy_error`）和 `isSafetyPolicyBlock(error)`，**名单只在这里定义**，不区分大小写。OpenAI 兼容适配器（非流式）先判断额度，再判断安全策略，最后才判断 401/403。 |
| `model-access/infra/anthropic-adapter.ts` | `classifyAnthropicError` 在 401/403 / `permission_error` 之前用同一个函数判断。HTTP 错误体和流式 SSE 里的 `error` 事件都经过它，所以流式路径也覆盖到了。 |
| `model-access/infra/media-adapter.ts`、`mimo-asr.ts` | 改用同一份名单。百炼自己的审核码 `data_inspection_failed` 只在这两处多认一个。 |

文本适配器里判断错误类别的地方一共三处：错误体的 `code`/`type`、HTTP 状态码、`finish_reason = content_filter` / `refusal`。第三处原本就算内容被拒，没有改。

网关和调度器没改。`gateway.ts` 收到 `content_rejected` 直接 `completeFailure`，不调 `recordFailure`，不换账号。这次加了真库用例，确认它不标 invalid、不冷却线路。

## 2. 被拦的消息不再发给模型（回复上下文）

**登记表**：`ai_runtime.model_blocked_messages`（迁移 0156）。主键是（会话 ID，序号）。另有 `user_id`、`character_id`、`message_id`（自动登记时为空）、`source`（`auto` / `manual`）、`reason`、`plan_id`、`created_at`。**只存 ID 和序号，不存正文。**

**自动登记**（`reply-engine.ts`）：私聊回复最终结果是 `content_rejected`、且这是一条用户消息触发的回复时（打招呼不算）登记。登记的是这次回复针对的用户消息，也就是上一条角色消息之后、状态正常的用户消息，最多 50 条。这份序号在组装上下文时算好，存进回复快照的 `turnUserSeqs`。上线前存下的旧快照没有这个字段，就只登记触发消息本身。登记失败只写日志，不影响这一轮回复。
- 关怀中被拦同样登记。用户看到的关怀兜底没有变化。不登记的话，关怀结束后被拦的那条还会一直把会话卡住。

**排除**（集中在 `ai-runtime/application/model-blocked-messages.ts`，按序号排除）：

| 发给模型的地方 | 文件 |
|---|---|
| 私聊回复上下文（含窗口、本轮新消息、图片描述等，都从同一份历史来） | `reply-context.ts` `readHistory` |
| 翻聊天记录（回忆） | `reply-context.ts` `recall` |
| 试聊 | `reply-context.ts` `buildTrial` |
| 回复附加形式判断（语音、表情包、链接） | `reply-engine.ts` `planExtras` 的历史 |
| 记忆抽取（照敏感消息的做法，序号照常推进游标） | `memory.ts` |
| 聊天摘要（同上） | `chat-summary.ts` |
| 私密整理 | `private-digest.ts` |
| 通话上下文 | `call-agent.ts` `callHistory` |
| 主动消息（含形式判断的历史） | `proactive-scheduler.ts` |
| 名场面、互动玩法 | `moment-cards.ts`、`play-ai.ts` |

没有改的：`ecology.ts` 只数时间、不发正文。群聊和群记忆是另外的会话，群聊里的 `content_rejected` 处理不变，也不登记。chat 模块不读这张表，所以界面照常显示。

**读登记表失败时**（比如迁移还没执行）照常回复、不排除。最坏结果是那条消息再被拦一次、再回一次推托语。

**清理**：注销账号（`T066_TABLES`）、彻底删除好友会话（`contacts.contact_purged`）、后台彻底删除角色（`purgeCharacter`）时一并删除。

## 3. 手工登记这次已被拦的 3 条历史消息（总负责人上线后执行）

下面的 SQL 只读写 ID、序号和元数据，**不读聊天正文**。真库用例 `test/ai-runtime.test.ts`「T-20261103j …手工登记 SQL 可用」原样执行过第 2 步（参数化写法）。

在香港服务器上进入数据库（容器名按 `deploy/hk/ops-lib.sh` 的项目名 `weiban-prod`，实际以 `docker ps` 为准）：

```bash
docker exec -it weiban-prod-postgres-1 psql -U weiban -d weiban -v ON_ERROR_STOP=1
```

把下面的 `<会话ID>` 和 `<seq1>,<seq2>,<seq3>` 换成实际值。

**第 1 步（可选，核对）**：确认这几个序号确实是这个会话里用户发的消息。

```sql
SELECT m.seq, m.sender_kind, m.status, m.scope, m.created_at
  FROM chat.messages m
 WHERE m.conversation_id = '<会话ID>'
   AND m.seq IN (<seq1>, <seq2>, <seq3>)
 ORDER BY m.seq;
-- 想从回复计划反查序号（失败的那几次回复的触发消息）：
-- SELECT trigger_seq, status, failure, created_at FROM ai_runtime.reply_plans
--  WHERE conversation_id = '<会话ID>' AND created_at >= '2026-11-03 10:00+08' ORDER BY created_at;
```

**第 2 步：登记。**只会登记这个私聊会话里用户发的消息，重复执行不报错。

```sql
INSERT INTO ai_runtime.model_blocked_messages
  (conversation_id, seq, user_id, character_id, message_id, source, reason, created_at)
SELECT m.conversation_id, m.seq, c.owner_user_id, c.character_id, m.id, 'manual', 'content_rejected', now()
  FROM chat.messages m
  JOIN chat.conversations c ON c.id = m.conversation_id
 WHERE m.conversation_id = '<会话ID>'::uuid
   AND m.seq = ANY('{<seq1>,<seq2>,<seq3>}'::bigint[])
   AND m.sender_kind = 'user'
   AND c.type = 'direct'
   AND c.character_id IS NOT NULL
ON CONFLICT (conversation_id, seq) DO NOTHING
RETURNING seq::text AS seq, message_id;
```

正常会返回 3 行。少于 3 行时，要么是那条已经被自动登记（见第 3 步），要么是序号不是用户消息。

**第 3 步：核对登记结果。**

```sql
SELECT seq, source, plan_id, created_at
  FROM ai_runtime.model_blocked_messages
 WHERE conversation_id = '<会话ID>'
 ORDER BY seq;
```

**撤销**（登记错了时）：

```sql
DELETE FROM ai_runtime.model_blocked_messages
 WHERE conversation_id = '<会话ID>' AND seq IN (<seq1>, <seq2>, <seq3>);
```

说明：
- 这个会话还在等待中的旧回复（`waiting`）被巡检恢复时会重新组装上下文，排除也会生效。如果被拦的 3 条正好是这个会话最后的用户消息、全部登记了，那次恢复会直接取消，不回复。用户下一条消息照常回复。
- 如果上线后、手工登记前，巡检先恢复了那次等待的回复：上游拦截现在算内容被拒，会回推托语，并自动登记本轮的用户消息（很可能就是这 3 条）。这时第 2 步返回的行数会少于 3，属于正常。

## 4. 上线后恢复上游状态

1. **按正常流程发版**。这次含迁移：发版脚本会先备份，迁移跑完才启动应用。0156 只新建一张空表。
2. **执行第 3 节的手工登记**。
3. **恢复 Abliteration 上游**：在管理后台的上游账号列表里找到 Abliteration，点「测试」。测试调 `GET /models`，通过后状态改回「正常」，同时清掉暂停和连续失败次数（`UpstreamService.test`，会记审计）。修复上线后，同样的 403 只算这一轮内容被拒，不会再把上游打回 invalid。
   - 不建议直接改 `model_access.upstreams` 表：绕过 `reportStatus`，不会发「模型恢复可用」的事件，也不会记审计。
   - 线路冷却记在进程内存里，发版重启后自动清空。
4. **确认**：
   - 后台上游账号列表里 Abliteration 保持「正常」；
   - 用量记录里之后如果再有被拦的调用，错误码是 `content_rejected`，不是 `invalid_key`；
   - 请这位用户在那个会话里再发一条普通消息，能正常回复（可选）。

**回退**：先回退代码，再回滚迁移（`pnpm db:rollback`，或发版回退流程）。只回退代码、保留这张表也没问题：旧代码不读它。回滚迁移会删表，已登记的消息会重新进入模型上下文，可能再被拦。

## 5. 自测结果（本机只跑一次）

- 服务器类型检查 `pnpm --filter @weiban/server typecheck`：通过（含测试文件）。
- 改动文件的 eslint、prettier：通过。`pnpm lint:deps`：没有依赖违规。
- 单测（本机）：
  - `model-access/infra/safety-policy.test.ts`（新，8 个）：403 + `policy_violation`、403 + 只有 `policy_error`、400/401 带安全策略正文 → `content_rejected`；401/403 普通正文（含非 JSON）→ `invalid_key`；Anthropic 流式 SSE 的 error 事件、HTTP 403 错误体 → `content_rejected`；`authentication_error` / `permission_error` → `invalid_key`。
  - `ai-runtime/application/model-blocked-messages.test.ts`（新，5 个）：本轮范围、按序号排除、读登记表失败时不排除、登记去重。
  - 已有的 `mimo-asr`、`json-truncation`、`proactive-forms`、`proactive-charge`、`call-agent`、`realtime-call-agent` 单测：通过。
- 真库用例（本机没有 Docker / `TEST_DATABASE_URL`，交给 CI）：
  - `test/model-gateway.test.ts` 新用例：假上游连续 4 次回 403 `policy_violation`，都得到 `content_rejected`，每次只调一次上游；上游保持 active、线路不冷却、仍在调度候选里；随后正常请求成功。不带安全策略正文的 403 仍把上游标 invalid。
  - `test/ai-runtime.test.ts` 新用例：被拦一轮回推托语、计划完成、自动登记本轮用户消息；下一条正常回复，发给模型的内容没有被拦那条，同会话其他消息都在；用户读消息仍能看到那条；第 3 节手工登记 SQL（参数化）只登记用户消息、重复执行不报错，登记后的消息不再发给模型。
  - `test/migrations.test.ts`：0156 执行、回滚、再执行。

## 6. 遗留问题

- 上游不会告诉我们是哪一条消息触发了拦截，所以整轮的用户消息都登记。用户一轮连发很多条时，可能多排除几条正常消息（最多 50 条）。
- 没有后台界面查看或撤销登记，目前只能用第 3 节的 SQL。如果以后常用，可以加一个后台入口（需要改契约，另开任务）。
- 群聊、通话里的 `content_rejected` 照旧，不自动登记。它们的上下文较短，被拦的那条很快会滑出窗口。
- 其他供应商专用的识别分类器（`native-asr.ts`、`dashscope-realtime.ts`、`dashscope-voice-clone.ts`）保留各自的审核码判断，没有并进名单。它们不会把 `policy_violation` 当密钥错误，只是名单分散，可以以后统一。

## 7. 给其他负责人的交接

- **总负责人**：PR 合并后发版；执行第 3 节登记、第 4 节恢复上游。CI 里真库用例第一次跑，失败请转回来。
- **Codex（验收）**：重点看第 1 节的归类顺序（额度 → 安全策略 → 401/403），以及第 2 节表格列出的排除点是否完整。
