# 交接说明：T-20261104c 寄信卡死整站（事务里套独立事务）紧急修复

| 项     | 内容                                                      |
| ------ | --------------------------------------------------------- |
| 负责人 | backend-lead                                              |
| 日期   | 2026-11-04                                                |
| 分支   | `fix/letter-tx-deadlock-20261104`（基于 main `6256972e`） |
| 任务卡 | `docs/tasks/T-20261104c-letter-tx-deadlock.md`            |
| 契约   | 不变（`packages/contracts` 未改）                         |
| 迁移   | 无                                                        |

## 结论

1. **死锁已修**：玩法在事务里发聊天消息 / 系统提示时，查私聊会话改在调用方同一个事务里做，不再另开连接去锁同一会话行。同样的问题另外找到两处并一起修了：心愿打勾发瞬间卡、官方会话补齐。
2. **连接池兜底**：应用连接池每条连接都带两个会话参数：
   - `idle_in_transaction_session_timeout = 30s`：事务卡住最多 30 秒，就被数据库断开；
   - `lock_timeout = 10s`：等锁最多 10 秒，就报错。

   pg-boss 的连接只加前一个参数。以后再有类似问题，只影响那一个请求，不会耗尽连接池。
3. **断一条连接不再让进程退出**：根因是事务连接被数据库断开时，pg 在这条连接上发 `error` 事件，代码没人接，变成未捕获异常，进程崩溃退出。现在会接住：记日志，丢弃这条连接，只让这次事务失败，进程继续服务。

## 根因

### 死锁

`sendLetter` 在一个事务 tx 里依次执行：

1. `postToDirectChat(tx)`：写私聊消息，锁住并修改会话行；同时持有 `realtime:用户` 咨询锁；
2. `postPlayNotice(tx)`：调 `chatRead.findDirectConversation(userId, characterId)`，**没传 tx**。

`findDirectConversation` 自己 `db.transaction(...)`，在另一条连接上对同一会话行 `SELECT … FOR SHARE`。这一行外层已经改过，所以：

- 内层要等外层提交；
- 外层要等内层返回。

两边互相等待。数据库只看到外层连接 `idle in transaction`，检测不出死锁。之后同一用户的请求都排在这行锁后面，每个请求占一条连接，连接池耗尽，整站 500。

### 进程退出

`Database.transaction()` 用 `pool.connect()` 借出连接。借出期间，pg 连接池把自己的 `error` 监听摘掉了。连接在事务中途被数据库断开时（管理员终止、`idle_in_transaction` 超时、网络断开），pg 在这条连接上 `emit('error')`。没人监听，就是 Node 的未捕获异常，进程退出。

事故当时连接池 10 条连接全部借出，所以日志里没有「数据库连接池出错」，只有 pg-boss 自己接住的两条「pg-boss 出错」。

本机已复现：对旧代码跑新加的测试，Vitest 报 `Uncaught Exception: terminating connection due to administrator command`。

**关于「退出码 0」**：Node 因未捕获异常退出时，退出码是 1，不是 0。`docker inspect` 的 `.State.ExitCode` 在容器被重启策略重新拉起、处于运行状态时会被重置为 0。所以看到的 0 很可能是这个原因，不是真实退出码。

如需确认，可以在生产只读查看：

- `docker events --since <时间> --filter event=die`（die 事件带真实 exitCode）；
- `docker logs` 里有没有 `Emitted 'error' event on Client instance`。

代码里没有任何「数据库出错就优雅退出」的路径：Nest 只监听信号，pg-boss 只发 error 事件。

**注意（生产现状）**：生产已经 `ALTER ROLE weiban SET idle_in_transaction_session_timeout = '30s'`，但部署的还是旧代码。在本 PR 上线前，如果再卡死，30 秒后数据库会断开那条事务连接，进程随即按上面的原因崩溃，容器自动重启（约十几秒全站不可用）。这比卡 11 分钟好，但仍会断一下。本 PR 上线后，就只是那一个请求失败。

## 改了什么

| 文件                                                                    | 改动                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/platform/db/database.ts`                               | 连接池加启动参数 `idle_in_transaction_session_timeout`（30 秒）和 `lock_timeout`（10 秒），导出常量 `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS`，可用 `idleInTransactionTimeoutMs` / `lockTimeoutMs` 覆盖（测试用）。`transaction()` 借出连接期间挂 `error` 监听：记日志（`onError`），归还时带错误、丢弃这条连接。ROLLBACK 失败也带错误归还，不把状态不明的连接还给连接池。文件头补了「拿着 tx 必须把 tx 传下去」的规则 |
| `apps/server/src/platform/index.ts`                                     | 导出两个常量                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/platform/jobs/job-queue.ts`                            | pg-boss 连接加 `options: -c idle_in_transaction_session_timeout=30000`。不加 `lock_timeout`：pg-boss 的加锁事务自己 `SET LOCAL lock_timeout = 30s`，其余语句用 SKIP LOCKED；全局设 10 秒，可能让建队列、建分区的 DDL 误失败                                                                                                                                                                                                  |
| `apps/server/src/modules/chat/tokens.ts`、`chat/index.ts`               | 新增服务器内部类型 `ChatReadInTxPort`，继承契约 `ChatReadPort`，给 `findDirectConversation`、`readMessages` 加可选 `tx`。注入仍用同一个 `CHAT_READ_PORT` 令牌，契约不变                                                                                                                                                                                                                                                       |
| `apps/server/src/modules/chat/application/read.ts`                      | `findDirectConversation(userId, characterId, tx?)`、`readMessages(input, tx?)`：传 tx 就在调用方事务里执行。`findDirectConversation` 带 tx 时用 `FOR UPDATE`：调用方随后要写这个会话，先拿共享锁再升级成排他锁，两个并发写入方会互相等待，形成数据库死锁。不带 tx 时行为不变（独立事务 + `FOR SHARE`）                                                                                                                        |
| `apps/server/src/modules/play/application/context.ts`                   | `postToDirectChat`、`postPlayNotice` 查会话时传入调用方 tx。`postPlayNotice` 只吞业务错误（AppError，如账号失效、没有私聊）；数据库错误（如等锁超时）原样抛出，否则这个事务已作废，后面的语句只会报「事务已中止」，看不到真正原因                                                                                                                                                                                              |
| `apps/server/src/modules/official-assistant/application/engine.ts`      | `ensureConversation` 读已有消息时传入 tx（见下面「同类问题」第 3 条）                                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/modules/realtime/infra/socket-server.ts`               | LISTEN 通知连接：先挂 `error` 监听，再执行 LISTEN。原来监听是在 LISTEN 成功之后才挂的，LISTEN 期间断开会让进程退出                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/modules/channels/application/wechat-runtime.ts`        | 微信渠道长期借出的咨询锁连接原来没有 `error` 监听，数据库断开它就会让进程退出。现在接住：<br>- 断开后丢弃这条锁连接，停掉本进程的长轮询；<br>- 下一次 reconcile 重新抢锁、再起循环，保证只有持锁进程在轮询；<br>- 没抢到锁、或关闭时，把监听摘掉，不累积                                                                                                                                                                       |
| `apps/server/test/play-tx-deadlock.test.ts`（新）                       | 真实 HTTP + PG，分别验证寄信、心愿打勾（发瞬间卡）、官方会话两次 ensure：<br>- 在 5 秒内完成（远小于 10 秒的 lock_timeout）；<br>- 系统提示 / 欢迎语确实写进了会话                                                                                                                                                                                                                                                             |
| `apps/server/test/db-session-guards.test.ts`（新）                      | 真实 PG：<br>- `SHOW` 两个会话参数为 30s / 10s；<br>- 等锁超时报 55P03；<br>- 空闲事务超时、`pg_terminate_backend` 断开事务连接时，只让这次事务失败、`onError` 记录，不产生未捕获异常，连接池之后照常可用                                                                                                                                                                                                                    |
| `apps/server/test/job-queue.test.ts`                                    | 加一例：pg-boss 连接的 `idle_in_transaction_session_timeout = 30s`，`lock_timeout` 未设置                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/src/modules/official-assistant/application/engine.test.ts` | 断言 ensure 读消息用的是 ensure 的同一个 tx                                                                                                                                                                                                                                                                                                                                                                                 |

**两个新测试能复现问题。** 把修复临时退回、只跑这两个新文件，结果如下：

- 寄信、心愿、官方会话三例全部卡住（超时失败）；
- 断开连接两例报 Vitest「Uncaught Exception」。

恢复修复后全部通过。

## 同类问题排查清单

排查方法：

- 写了一个粗扫脚本，找出所有「作用域里有事务」的函数，包括：事务回调、带 `tx: DbTx/Tx` 参数的方法、事件订阅的 `(event, tx) =>` 回调；
- 在这些函数里列出没传 tx、而被调方法会自己开事务、加锁或直写的调用；
- 再逐条人工核对；
- 另外人工检查了任务卡点名的模块。

### 已修（确定有风险）

1. **寄信** `letters.service.ts sendLetter`：先 `postToDirectChat`，再 `postPlayNotice`。这是事故路径。
2. **心愿打勾** `wishlist.service.ts updateItem`（第一次完成、发瞬间卡时）：
   - `issueCard(tx)` 里 growth 先用 `postSystemMessage(tx)` 写「获得瞬间卡」提示，锁住了会话行；
   - 之后 `postPlayNotice` 又另开连接 `FOR SHARE` 同一行。
   - 同样是死锁，旧代码已用测试复现。
3. **官方会话补齐** `official-assistant engine.ensureConversation`：
   - `ensureOfficialConversation(tx)` 已用 `FOR UPDATE` 锁住会话行（或刚插入会话行）；
   - 随后 `chatRead.readMessages(...)` 不带 tx，另开连接 `store.load` 又 `FOR UPDATE`。
   - 已有会话时死锁，触发入口是 `POST /api/v1/official-assistant/conversation`；
   - 新会话时另一条连接看不到这行，报「会话不存在」，事务回滚。所以注册时的自动补齐（`official.on_user_registered`）一直失败，只记 warn，欢迎语从来发不出去。
   - 旧代码已用测试复现。
4. **其余玩法也改为在调用方事务里查会话**：专注开始（`postPlayNotice`）、提醒到点、每日一问、回信送达、角色主动寄信（`postToDirectChat`）。这几处原来是事务里第一次碰会话行，所以没卡；现在统一走同一个 tx，以后在前面加写入也不会出问题。
5. **进程退出**：`Database.transaction` 借出的连接、realtime LISTEN 连接（LISTEN 期间那一小段）、微信咨询锁连接，都已接住 `error`（见上）。全服务器只有这三处直接 `pool.connect()`。

### 只记录（理论风险，当前不会卡死）

- **事件订阅里不带 tx 读会话 / 消息**：
  - 涉及的回调：
    - `ai-runtime/application/lifecycle.ts`：`ai.ecology_user_request`、`ai.quiet_state`、`ai.group_invite_intent`、`ai.card_on_user_message`、`ai.on_user_message`、`ai.memory_on_message` 等；
    - `official-assistant/application/lifecycle.ts`；
    - `proactive/application/lifecycle.ts`；
    - `growth/application/growth-events.ts onUserMessageForFamiliarity`；
    - `ai-runtime/application/group-chat.ts onUserMessage`。
  - 在分发器的事务里，它们调 `chat.getConversation / getMessage / getParticipants` 时都没传 tx，chat 会另开事务，并且 `FOR UPDATE` 会话行。
  - 现在不会卡：这些调用都发生在本订阅事务碰会话行之前，分发器每个订阅者单独一个事务。
  - 代价：每次多占一条连接。
  - 以后在这些读之前加写入，就会卡死。建议后续改为传 tx（`getConversation`、`getMessage` 的契约已支持 tx）。
- **事务里不带 tx 的 `crypto.seal/open`**：`characters/application/supplements.ts:207`、`play/letters.service.ts deliverIfDue` 的 `this.open(row)` 等。
  - 只有在「同一个事务刚为该用户创建数据密钥、还没提交」时，才会在 `INSERT … ON CONFLICT` 上等外层；
  - 正常用户的数据密钥早已存在，风险很低。
- **事务里调外部服务**：
  - 瞬间卡文案 `growth cards.service aiCopy` 调模型，有 3 秒超时，用 `Promise.race`；
  - 推送 `push delivery-engine` 发送有意放在事务里，时限 1.5 秒；
  - 媒体删除 `media.ts deleteObject` 在事务里删存储文件。
  - 都远小于 30 秒的空闲事务超时、10 秒的等锁超时。
  - 粗扫没发现事务里调用模型生成、搜索、转写等慢调用。
- **pg-boss 首次投递新队列**：`JobQueue.ensureQueue` 在 pg-boss 自己的连接上建队列、建分区。如果调用方事务已经往同一个任务表投递过别的任务，建分区可能要等表锁。
  - 只发生在本进程第一次向一个未登记的队列投递时；
  - 消费进程启动时会先建好队列，pg-boss 的加锁事务自带 30 秒 `lock_timeout`。
- **已核对、无风险**：
  - calls（`inPrivateMode`、`startCall`、来电）、channels（`channel-bridge` 两处）、`ai-runtime timeline`：都在事务外调 `findDirectConversation`；
  - billing 积分扣减（ledger / reservations / service-fees）：事务内调用都传了 tx。
  - 粗扫命中的 `image-captions`、`shared-episodes`、`play-continuity`、`proactive guards` 等，核对后都是传了 tx、只是变量名不同。

## 本机检查（各跑一次）

- `pnpm --filter @weiban/server typecheck`：通过。
- eslint、prettier：改动文件均通过。
- 相关测试：用独立测试库 `weiban_test_txfix`，避免和同事共用的 `weiban_test` 互相清库。
  - 文件：`db-session-guards`、`job-queue`、`play-tx-deadlock`、`official-assistant/engine.test`、`chat`、`realtime-sockets`、`official-assistant`、`channels-helper`。
  - 共 8 个文件、60 例通过。
  - 第一次运行时 `db-session-guards` 有 1 例 SQL 写错（`SHOW … AS`），修正后单独重跑通过。
- 其余以 CI 为准。

## 遗留问题

- `lock_timeout = 10s` 是全局的。如果有后台任务正当地长时间持有行锁或咨询锁，同时来的请求会报 55P03（`canceling statement due to lock timeout`），不再排队等。
  - 本次排查没发现这样的路径：模型调用都在事务外，`realtime:用户` 咨询锁的持有时间都很短。
  - 上线后请留意日志里的 55P03。如果出现正当的长等待，可以只对那个事务 `SET LOCAL lock_timeout`。
- 事件订阅里不带 tx 的读（见上面「只记录」）留待后续，交 ai-lead / 各模块按需改。
- 契约 `ChatReadPort` 的 `findDirectConversation` / `readMessages` 正式加可选 tx：需要架构走变更申请。本次用服务器内部类型 `ChatReadInTxPort` 过渡，没改契约。
- 生产 `ALTER ROLE weiban SET idle_in_transaction_session_timeout = '30s'` 可以保留，与代码同值；代码里的设置在连接级生效，会覆盖角色设置。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- **给项目总负责人**：
  - 本 PR 合并后尽快发布。在此之前，生产如果再卡死，30 秒后进程会崩溃重启（见「注意（生产现状）」）。
  - 「退出码 0」大概率是 `docker inspect` 显示的问题，可用 `docker events` 的 die 事件确认真实退出码。
- **给 devops-lead**：
  - 发布后观察：日志里的「数据库连接池出错」「微信渠道咨询锁连接断开」、`55P03`；
  - 留意 `pg_stat_activity` 里是否还出现长时间 `idle in transaction`；
  - 迁移器（`migrator.ts`）没加任何超时。
- **给 architect**：
  - 建议把「拿着 tx 调端口必须传 tx」写进 `docs/backend/kernel.md` 的事务一节。本任务范围不含该文档，规则已写在 `database.ts` 文件头；
  - `ChatReadPort` 加 tx 的契约变更待评估。
- **给 Codex（验收）**：
  - 重点看 `test/play-tx-deadlock.test.ts`、`test/db-session-guards.test.ts`；
  - 可以把 `play/application/context.ts` 和 `database.ts` 临时退回旧版本，确认这两个测试会失败。
