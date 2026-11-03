# T-20261104c 寄信卡死整站（事务里套独立事务）紧急修复

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-11-04 |
| 状态 | 待验收 |

## 目标

任何玩法（寄信、专注、心愿单、提醒、每日一问等）在事务里发聊天消息或通知时，都不会再出现「外层事务等内层、内层等外层」的卡死；就算以后出现别的长时间挂起的事务，也只影响那一个请求，不会耗尽连接池拖垮整站。

## 背景（生产事故，2026-11-04 00:23:58–00:35 CST）

- 现象：整站 500 约 11 分钟。数据库连接池被耗尽，有一条连接 `idle in transaction` 持锁不放（pid 1156654，00:23:58 开始），后面同一用户的请求全部排队；总负责人 `pg_terminate_backend` 后恢复。
- 根因（已核实代码）：`apps/server/src/modules/play/application/letters.service.ts` `sendLetter` 在一个事务 `tx` 里依次：加锁 → 插信 → `ctx.postToDirectChat(tx, …)`（会在 tx 里写会话行）→ … → `ctx.postPlayNotice(tx, …)`。
  `apps/server/src/modules/play/application/context.ts` 的 `postToDirectChat` / `postPlayNotice` 调 `this.chatRead.findDirectConversation(userId, characterId)` **没有传 tx**；
  `apps/server/src/modules/chat/application/read.ts:146` 的 `findDirectConversation` 自己另开 `this.db.transaction(...)`，在**另一条连接**上对同一会话行 `SELECT … FOR SHARE`。外层 tx 已经改过这行 → 内层永远等外层提交，外层又在等内层返回 → 应用层死锁（数据库检测不到，因为外层连接是 idle in transaction）。
- 已做的临时止血（生产，总负责人做的，不要改动生产）：`ALTER ROLE weiban SET idle_in_transaction_session_timeout = '30s'`，并重建了连接。现在卡死最多 30 秒会被数据库断开。
- 附带发现：数据库主动断开空闲连接（`terminating connection due to administrator command`，日志里只看到 `pg-boss 出错` 两条）后，app 进程**以退出码 0 退出**并被 docker 重启（RestartCount 增加）。断一条连接不应该让整个进程退出。

## 输入文档

开工前必须读：
- `CLAUDE.md`、`AGENTS.md`（共享文件夹规则；你在独立 worktree `C:\wb-dev\wb-txfix` 工作，分支 `fix/letter-tx-deadlock-20261104`）
- `apps/server/src/platform/db/database.ts`（`Database.transaction`、PgTx、连接池）
- `apps/server/src/modules/chat/application/read.ts`、`apps/server/src/modules/chat/` 里 ChatReadPort 定义
- `apps/server/src/modules/play/application/context.ts` 及所有调用 `postToDirectChat` / `postPlayNotice` 的玩法服务
- `apps/server/src/platform/jobs/job-queue.ts`、`apps/server/src/main.ts`、`apps/server/src/modules/realtime/infra/socket-server.ts`（进程退出问题）

## 范围

- 可以改：`apps/server/src/**`、`apps/server/test/**`、本任务卡、交接说明。
- 不可以改：`packages/contracts`（本任务不需要改接口）、web/admin/android、`docs/quality/`、部署脚本、生产服务器。不推 main、不合并 PR、不碰生产。

## 要做的事

1. **修死锁**：让 `findDirectConversation`（或新增的带 tx 版本，如 `findDirectConversationIn(tx, …)`）能在调用方事务里执行；`postToDirectChat` / `postPlayNotice` 一律用调用方的 tx 查会话。`characterName(userId, characterId, tx)` 等其它带 tx 的查找也核对一遍。
2. **排查同类问题**：全服务器搜「拿着外层 tx，期间调用会自己开 `db.transaction` 或 `db.db`/`pool` 直查、且可能锁到外层已改过的行」的写法（至少覆盖 play 全部玩法、chat、calls、channels、ai-runtime timeline、billing 积分扣减等调用 ChatReadPort/其它 Port 的地方）。能确定有风险的一并修；只是理论可能的写进交接说明。
3. **连接池兜底**：在 `Database` 连接池建立连接时设置会话级 `idle_in_transaction_session_timeout`（建议 30s）和 `lock_timeout`（建议 10s，若发现有合理的更长等锁场景请说明并调整），用 pg 的连接参数或 `connect` 钩子实现均可；pg-boss 连接按需同样处理（确认不破坏 pg-boss 自身的锁用法）。迁移器（migrator.ts）不要加 lock_timeout 以免迁移失败。
4. **进程不该因断一条连接退出**：查清 2026-11-04 断开空闲连接后进程退出码 0 的原因（pg-boss 停止？realtime LISTEN 连接？Nest shutdown hook？），修到「数据库断开个别连接 → 记日志、自动重连，进程继续服务」。
5. **回归测试**：至少一条集成测试复现「事务内发聊天消息/玩法通知」不会卡住（加超时断言），覆盖寄信路径；一条测试验证连接池会话参数生效（`SHOW idle_in_transaction_session_timeout`）。

## 验收标准

- [ ] 寄信、专注结束、心愿单、提醒、每日一问在事务内发消息/通知不再另开连接锁同一会话行；有测试证明寄信不卡。
- [ ] 连接池新连接的 `idle_in_transaction_session_timeout`、`lock_timeout` 生效，有测试。
- [ ] 数据库断开一条应用连接后进程不退出，有说明（能测则测）。
- [ ] 本机只跑一次相关检查（server typecheck + 相关测试）通过；推分支、开 PR，以 CI 为准。
- [ ] 交接说明写清：根因、改动、同类问题排查清单（已修/未修）、遗留风险。

## 交付物

- 代码：`apps/server/src/**`、`apps/server/test/**`
- 交接说明：`docs/handoffs/2026-11-04-letter-tx-deadlock.md`
- PR：标题 `fix(db): 修复寄信事务内另开事务导致整站卡死（T-20261104c）`
