# T-20261104f 停站事故善后：事件订阅传事务、规则入文档、上游权限类拒绝告警

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（第 1 条涉及契约端口，按 architect 变更申请口径写进交接） |
| 派发人 | 项目总负责人 |
| 日期 | 2026-11-04 |
| 分支 | `fix/tx-hardening-20261104`（worktree `C:\wb-dev\wb-txhard`） |
| 状态 | 待验收（交接：`docs/handoffs/2026-11-04-tx-hardening.md`） |

## 目标

把 11-04 停站事故和上游隔离两份交接里列出的遗留风险一次清掉：以后在事件订阅或事务里加写入，也不会再出现「事务里另开连接等自己」的卡死；密钥其实没坏但权限不够导致的长期拒绝，能被管理员及时发现。

## 背景

- `docs/handoffs/2026-11-04-letter-tx-deadlock.md` 的「只记录」清单写明：十几个事件订阅者在分发器事务里读会话或消息时没传事务，涉及 ai-runtime 的 lifecycle、group-chat，official / proactive 的 lifecycle，growth-events。现在不会卡，是因为这些读都在本事务碰会话行之前；以后在前面加写入就会卡。
- 同一交接建议：`ChatReadPort` 正式加可选事务参数，这次先用服务器内部的 `ChatReadInTxPort` 过渡；把「拿着事务调端口必须传事务」写进 `docs/backend/kernel.md`。
- `docs/handoffs/2026-11-04-upstream-isolation.md` 遗留：上游回 401/403、自检通过的情况（例如密钥没有某个模型的权限）会一直按内容被拒处理，用户只收到推托语，后台没有提醒，只能从 `upstream_key_self_check` 日志看出来。

## 输入文档

- `CLAUDE.md`、`AGENTS.md`
- 上面两份交接全文
- `docs/backend/kernel.md`、`apps/server/src/platform/db/database.ts`（文件头规则、PgTx）
- `packages/contracts/src/ports/` 里 ChatReadPort 的定义及契约版本规则（`packages/contracts/README.md`）
- `apps/server/src/modules/chat/`（`ChatReadInTxPort`、`read.ts`）
- 事件分发器、outbox 及上面列出的订阅者
- 管理员告警：`AdminAlertKind`（契约）及现有告警的写法（例如 `host_disk_high`、`backup_failed`）
- `apps/server/src/modules/model-access/application/upstreams.ts`（`keyStillWorks`、自检日志）

## 范围

- 可以改：`packages/contracts`（只限 ChatReadPort 的可选事务参数，和新增一种管理员告警类型；次版本升级，取 main 最新加一，同步 README、版本断言、安卓生成产物）、`apps/server/src/**`、`apps/server/test/**`、`apps/admin` 里告警类型的显示文案、`docs/backend/kernel.md`、本任务卡、交接。
- 不可以改：其它契约、web 用户端、`docs/quality/`、部署脚本、生产服务器。不推 main、不合并、不部署、不 ssh。

## 要做的事

1. **ChatReadPort 正式化**：`findDirectConversation`、`readMessages` 等读方法在契约端口上加可选的事务参数，替换掉过渡用的 `ChatReadInTxPort`。不传事务时行为不变。
2. **事件订阅者传事务**：交接「只记录」清单里所有在分发器事务里调用其它模块端口读数据的地方，都把事务传下去。每改一处在交接里列一行。顺带全服务器搜一遍新出现的同类写法。
3. **规则入文档**：在 `docs/backend/kernel.md` 写一节「事务与端口」：拿着事务调用其它模块端口必须传事务；事务里不要调外部服务（HTTP、模型、推送等），确需调用的要有远小于 30 秒的超时；连接池的 `idle_in_transaction_session_timeout=30s`、`lock_timeout=10s` 是兜底，不是正常流程。`database.ts` 文件头改为引用这一节，规则只写在一处。
4. **权限类拒绝告警**：同一上游在短时间内（建议 10 分钟内 ≥ 20 次，参数放 `product-params.ts`，只定义一处）出现「401/403 但自检通过」时，发一条管理员告警（新增告警类型，例如 `upstream_auth_rejected`）：只带上游 ID、名称、次数和时间窗，不带用户内容。同一上游在冷却期（建议 1 小时）内不重复发。后台告警列表能正常显示这一类型。
5. **测试**：
   - 一条集成测试：在事件订阅里先写会话行、再经端口读同一行，传事务后不会卡（加超时断言）。
   - 一条告警测试：到阈值才发，冷却期内不重复，内容不含用户文本。
   - ChatReadPort 不传事务时的原有测试照常通过。
6. 本机只运行一次相关检查（contracts、server、admin 的类型检查、lint 和相关测试）。推分支、开 PR，以 CI 为准。

## 验收标准

- [x] `ChatReadInTxPort` 已移除，契约端口支持可选事务；契约版本、README、安卓生成产物已同步。
- [x] 交接清单里的订阅者都已传事务，有逐项列表。
- [x] `kernel.md` 有「事务与端口」一节，`database.ts` 引用它。
- [x] 权限类拒绝告警按阈值和冷却发送，有测试，后台能显示。
- [x] 交接写清改动、未改的项及原因。

## 交付物

- 代码：`packages/contracts/**`、`apps/server/**`、`apps/admin/**`（只限告警文案）、`apps/android/core/contracts-generated/**`
- 文档：`docs/backend/kernel.md`；交接 `docs/handoffs/2026-11-04-tx-hardening.md`
- PR 标题：`fix(kernel): 事件订阅传事务、事务规则入文档、上游权限类拒绝告警（T-20261104f）`
