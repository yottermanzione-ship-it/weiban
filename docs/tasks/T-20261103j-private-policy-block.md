# T-20261103j 私密模型被上游安全策略拦截后反复失败：正确归类、被拦消息不再发给模型

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（模型网关错误归类、迁移）+ ai-lead（回复上下文） |
| 派发人 | 项目总负责人 |
| 日期 | 2026-11-03 |
| 分支 | `fix/private-policy-block-20261103`（worktree `C:\wb-dev\wb-fix-policy`，基于 origin/main 09072c20） |
| 状态 | 待验收（开发自测完成，PR 已开） |
| 优先级 | 最高（线上故障） |
| 来源 | 总经理 11-03 报私密模型反复调用失败，总负责人查实 |

## 目标

上游服务商的安全策略拦下一条消息时：只让这一轮回推托语，不把整个上游标成不可用；被拦的消息之后不再发给模型，会话不再卡死。

## 背景

- 私密模型上游是 Abliteration（`openai_compatible`，`https://api.abliteration.ai/v1`，模型 `abliterated-model`）。11-03 10:19 起一个私密私聊会话回复反复失败。
- 上游对某条用户消息回 **HTTP 403** `{"error":{"code":"policy_violation","type":"policy_error","message":"The request was blocked by a safety policy."}}`，用户先后发了三次。同一把密钥发普通请求、调 `/models` 都是 200，不是密钥问题。
- `text-adapter.ts` 只认 `content_filter` / `content_policy_violation` / `moderation_blocked` 为 `content_rejected`，`policy_violation` 落到 `401/403 → invalid_key`；调度器把整个上游标 `invalid`，所有私密调用直接失败。后台「测试」只调 `GET /models`，恢复成 active，下一次真实回复又被打回 invalid。
- 即使归类正确：被拦的那条用户消息仍留在聊天历史里，之后每次回复都带上它，一直被拦、一直只回推托语。

## 输入文档

- `docs/ai/runtime-overview.md`（适配器「错误归类」、网关返回的处理表）
- `docs/backend/model-access.md`（调度与健康）
- `apps/server/src/modules/model-access/infra/text-adapter.ts`、`anthropic-adapter.ts`、`application/gateway.ts`、`application/scheduler.ts`
- `apps/server/src/modules/ai-runtime/application/reply-engine.ts`、`reply-context.ts`、`memory.ts`

## 范围

- 可以改：model-access 适配器的错误归类；ai-runtime 组装模型上下文的地方；新迁移 0156（带 down）；相关测试与文档。
- 不可以改：契约（`packages/contracts`）、`minClientVersion`、chat 模块（用户界面照常显示消息）；私密照护、群聊、通话已有的 `content_rejected` 处理方式。

## 要求与验收标准

- [ ] **识别**：`error.code` 为 `policy_violation`（或原三个 code）、或 `error.type` 为 `policy_error` 时归为 `content_rejected`，不管 HTTP 是 400、401 还是 403；名单只在一处定义，非流式（OpenAI 兼容）与流式（Anthropic SSE）都用它；401/403 且正文不是安全策略类的仍是 `invalid_key`。
- [ ] `content_rejected` 不把上游标不可用、不进冷却、不换账号重试。
- [ ] **被拦消息不再进入后续上下文**：回复因 `content_rejected` 失败时登记这次回复针对的用户消息；之后回复上下文及其他把聊天历史发给模型的地方（记忆整理等）都不再带上；用户界面照样能看到。
- [ ] 提供**手工登记入口**（SQL），按会话 ID + 消息序号补登记这次已被拦、当时记成 `invalid_key` 的 3 条历史消息，写进交接。
- [ ] 被拦那一轮仍回 `snapshot.deflect`，不报错不卡住；下一条正常消息正常回复。私密照护、群聊、通话的 `content_rejected` 分支不被破坏。
- [ ] 测试：适配器单测（403 + `policy_violation`、403 + `policy_error`、401/403 普通正文，流式与非流式各一次）；网关真库用例（`content_rejected` 不标 invalid）；上下文排除真库用例（被登记的消息不出现在下一次回复上下文，同一会话其他消息照常）。测试数据全部自造。
- [ ] 文档：`docs/ai/runtime-overview.md`、`docs/backend/model-access.md` 同步错误归类说明。

## 交付物

- 代码 / 文档：见 PR（base main）
- 交接说明：`docs/handoffs/2026-11-03-private-policy-block.md`（含手工登记 SQL、上线后恢复上游状态的步骤）
