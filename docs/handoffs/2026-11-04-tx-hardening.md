# 交接说明：T-20261104f 停站事故善后：事件订阅传事务、事务规则入文档、上游权限类拒绝告警

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-11-04 |
| 分支 | `fix/tx-hardening-20261104`（基于 origin/main 8ad715d7） |
| 任务卡 | `docs/tasks/T-20261104f-tx-hardening.md` |
| 契约 | 5.6 → **5.7**（次版本：只有总负责人批准的两项）；`minClientVersion` 不动 |
| 迁移 | **无**（冷却时间存现有的 `model_access.settings` 键值表） |

## 结论

1. **以后在事件订阅里加写入，也不会再出现「事务里另开连接等自己」的卡死。** 交接清单里的订阅者读会话、消息、联系人时，都已经在自己的事务里读。新加的一条集成测试专门模拟这种情况：订阅者先写会话（写系统提示），再经端口读同一会话。现在毫秒级完成；没修时要等 10 秒锁超时才报错，然后重投。
2. **规则只写在一处**：`docs/backend/kernel.md` 第 6 节「事务与端口」，四条：
   - 必须传事务；
   - 固定的加锁顺序；
   - 事务里不调外部服务；
   - 30 秒 / 10 秒只是兜底。

   `database.ts` 文件头改为只引用这一节。
3. **新增管理员提醒「上游权限类拒绝」（`upstream_auth_rejected`）**，用于发现「密钥其实没坏，但没有某个模型的权限」这类长期拒绝：
   - 触发：同一上游 10 分钟内出现 20 次「401/403 但密钥自检通过」；
   - 冷却：1 小时内不重复，进程重启也不重复；
   - 内容：只有上游 ID、名称、次数和时间窗，不含用户内容；
   - 后台「运行提醒」显示为「上游权限类拒绝」。
4. 发版即生效，不需要手工操作。

## 1. 契约 5.7（只有两项）

| 项 | 改动 |
|---|---|
| `ChatReadPort`（`packages/contracts/src/ports/chat.ts`） | 6 个读方法都加了可选 `tx`：`getConversation`、`getParticipants`、`findDirectConversation`、`findOfficialConversation`、`readMessages`、`getMessage`。不传 `tx` 时行为与 5.6 完全相同。传 `tx` 时在调用方事务里读：除 `getParticipants` 外都 `FOR UPDATE` 锁会话行；`getParticipants(id, tx)` **不锁会话行**，专给订阅者「先看有谁、再拿本模块的锁」用。 |
| `AdminAlertKind`（`packages/contracts/src/http/push.ts`） | 末尾新增 `upstream_auth_rejected`。旧版后台用容错枚举读到它显示 `unsupported`，不会报错。 |

同步改动：
- `version.ts` 改为 5.7；
- README 新增 5.7 变更记录；
- 版本断言改为 5.7（`service-unit-pricing.test.ts`）；
- `schemas.test.ts` 加新提醒种类的解析用例；
- 安卓生成产物用 `pnpm android:generate` 重新生成（`Contracts.kt`、`contracts.json`；`WbTokens.kt` 和图标没有变化）。

服务器内部过渡用的 `ChatReadInTxPort` 已删除。chat 的 `ChatReadService` 直接实现 `ChatReadPort`。原来用它的官方小V引擎（`official-assistant/application/engine.ts`）和玩法上下文（`play/application/context.ts`）改用契约的 `ChatReadPort`，只改了类型，行为不变。

## 2. 传事务的订阅者（逐项）

「改前」指的是在订阅者事务里不传 `tx` 调端口。改前不会卡，是因为这些读都排在本事务碰会话行之前；以后谁在前面加一句写入，就会卡。

| # | 订阅者（事件） | 文件 | 改动 |
|---|---|---|---|
| 1 | `ai.ecology_user_request`（chat.message_created） | ai-runtime/application/lifecycle.ts | `getConversation()` → `getParticipants(id, tx)`；`getMessage(…, tx)` |
| 2 | `ai.quiet_state`（chat.message_created） | 同上 | `getMessage(…, tx)` |
| 3 | `ai.group_invite_intent`（chat.message_created） | 同上 | `getParticipants(id, tx)`；`getMessage(…, tx)` |
| 4 | `ai.card_on_user_message`（chat.message_created） | 同上 | `getParticipants(id, tx)`；`getMessage(…, tx)` |
| 5 | `ai.on_user_message`（chat.message_created） | 同上 | `getConversation()` → `getParticipants(id, tx)`，放在 `store.lock` 之前（联系人原来就传 tx） |
| 6 | `ai.memory_on_message`（chat.message_created） | 同上 | 顺序为：`getParticipants(id, tx)` → **新增** `store.lock(tx, 用户, 会话)` → `getActiveContactEpoch(…, tx)` → `getMessage(…, tx)`。与回复引擎、记忆整理的加锁顺序一致 |
| 7 | `ai.on_contact_removed`（contacts.contact_removed） | 同上 | `getActiveContact(…, tx)` |
| 8 | `ai.on_contact_purged`（contacts.contact_purged） | 同上 | `getActiveContact(…, tx)` |
| 9 | `ai.on_balance_restored`（billing.balance_restored） | 同上 + ecology-settings.ts | `ecologySettings.resume(userId, tx)`（方法加了可选 `tx`） |
| 10 | `ai.group_on_user_message`（chat.message_created） | ai-runtime/application/group-chat.ts + group-reply-store.ts | `onUserMessage` 先 `replies.lockOwner(tx, 用户, 会话)`（新方法，转调已有的用户 / 会话咨询锁），再 `getConversation(id, tx)` |
| 11 | `official.on_user_message`（chat.message_created） | official-assistant/application/lifecycle.ts | `getConversation(id, tx)` |
| 12 | `official.on_user_registered`（identity.user_registered） | 同上 | 补齐官方会话本来就要单独提交（失败只记 warn，不能让收件箱记录跟着回滚）。改为 `tx.afterCommit(…)`，在提交之后做，不再在拿着事务时另开连接 |
| 13 | `proactive.on_user_message`（chat.message_created） | proactive/application/lifecycle.ts | `getConversation()` → `getParticipants(id, tx)`，放在主动消息用户锁之前 |
| 14 | `growth.familiarity_on_user_message`（chat.message_created） | growth/application/growth-events.ts + growth.service.ts | 顺序为：`getParticipants(id, tx)` → 按角色 ID 排序拿 `lockFamiliarity`（改为公开方法）→ `getMessage(…, tx)` |

另外一处不是订阅者，但同属「拿着事务读会话」：通话结束写通话记录 `calls.writeRecord`（calls/application/calls.ts）改为 `getParticipants(id, tx)`。

### 为什么要调整加锁顺序（不能只是机械地补 `tx`）

传 `tx` 后，端口加的锁会持有到事务结束。如果只是把原来的 `getConversation()` 改成 `getConversation(id, tx)`，订阅者就变成先锁会话行，再拿本模块的咨询锁。而回复引擎、联系人删除、好感度加分都是先拿咨询锁或联系人锁、后写会话，两边顺序相反，会出现真正的数据库死锁。数据库能检测出来，但会让某个用户的请求失败。所以这次做了三件事：

- `getParticipants(id, tx)` 不锁会话行；
- 订阅者先拿本模块的锁，最后才读消息（读消息会锁会话行）；
- 群聊、好感度、记忆三处显式先拿锁。

统一的顺序写在 kernel.md 第 6 节第 2 条：

1. 本模块的锁；
2. 联系人行；
3. 会话行；
4. `realtime:用户`。

### 全服务器扫描：发现的同类写法，这次没改

扫描方法：用 node 脚本列出所有 `bus.subscribe` 的处理函数，以及所有 `database.transaction` 回调里调用端口却没传 `tx` 的地方，再逐个人工核对。

| 位置 | 为什么没改 | 建议 |
|---|---|---|
| `ai.shared_episode_message` → `moments.getPostVisibleToCharacter`（ai-runtime/application/shared-episodes.ts） | `MomentsReadPort` 契约没有 `tx`，这个方法自己开事务加 `FOR UPDATE`。它是订阅者里的第一句，前面没有写入，现在不会卡。 | architect：走变更申请，给 `MomentsReadPort` 加可选 `tx` |
| library 订阅者 → `moments.getPost` | 契约没有 `tx`，是不加锁的普通读（规则第 1 条允许） | 无 |
| model-access → `charges.getBillingStatesByHoldIds` | 普通读 | 无 |
| growth → `contacts.listActiveContacts` | 普通读，契约没有 `tx` | 无 |
| 事务里调 `policy.getCharacterPolicy` | 普通读，`PolicyPort` 没有 `tx` | 无 |
| `ai.call_ended` → `calls.onCallEnded` 在分发器事务里调模型 | 违反第 3 条（事务里不调外部服务）。目前 `PROACTIVE_CALLS_ENABLED=false`，没有生效。 | ai-lead：开启前改为在事务里投递 pg-boss 任务，由任务调模型 |
| `ai.play_*`、moments 订阅者不用 `tx` 读数据 | 它们的事务里只有收件箱记录，只投递任务，没问题 | 无 |

## 3. 规则入文档

- `docs/backend/kernel.md` 第 6 节新增「事务与端口」（四条加一段订阅者示例代码）；第 7 节事件订阅处加一句引用。
- `apps/server/src/platform/db/database.ts` 文件头删除了原来的规则段落，改为引用 kernel.md 第 6 节，只说明本文件实现了哪些兜底、数值在哪两个常量里。

## 4. 上游权限类拒绝提醒

**参数**：只在 `apps/server/src/platform/config/product-params.ts` 的 `UPSTREAM_AUTH_REJECTED_ALERT` 定义一处，总经理可调。

| 参数 | 值 |
|---|---|
| `threshold` | 20 次 |
| `windowMs` | 10 分钟（滑动窗口） |
| `cooldownMs` | 1 小时 |

**提醒内容**：
- `kind = upstream_auth_rejected`，`severity = warning`；
- 去重键 `upstream_auth_rejected:{upstreamId}`，后台同一上游的提醒会累加次数；
- `refs.upstreamId`；
- 说明文字（≤200 字）只有上游名称（截断到 40 字）、分钟数、次数和处理建议，不含用户 ID、用户消息、密钥。

**在哪计数**：`UpstreamService.confirmAuthRejection(upstreamId)`（model-access/application/upstreams.ts）。只有两个主入口调用它：文本网关 `gateway.ts` 的 `callUpstreams`，和媒体网关 `media-gateway.ts` 的 `confirmInvalidKey`。它先走原来的密钥自检（`keyStillWorks`，结论缓存 60 秒）。自检通过才计一次；自检失败说明密钥真坏了，照旧标 invalid，不计数。兜底入口（`reportStatus`、`scheduler.recordFailure`）仍只调 `keyStillWorks`，所以同一次调用不会重复计数。

**冷却怎么保证**：
- 次数存在进程内存里（滑动窗口，和自检缓存同一口径；生产是单进程，够用）。
- 到阈值时，在一个事务里依次做三件事：
  1. 往 `model_access.settings` 写键 `upstream_auth_rejected_alerted:{upstreamId}`，值为 `{at: 发送时间}`，用条件写入：上次发送不到 1 小时就写不进去；
  2. 写进去了才发件箱发 `platform.admin_alert_raised`；
  3. 写审计 `upstream.auth_rejected_alert`（只有次数和分钟数）。
- 所以进程重启、多进程同时到阈值，都不会在 1 小时内重复发。
- 发出时打一条结构化日志 `upstream_auth_rejected_alert`（上游 ID、次数、分钟数）。
- 写提醒失败只记 warn，不影响用户这次请求（用户照常收到推托语）。

**后台显示**：`apps/admin/src/features/alerts.tsx` 的类型文案加了「上游权限类拒绝」。push 模块存提醒的表没有种类约束，不用迁移。

## 5. 测试

| 测试 | 内容 |
|---|---|
| `apps/server/test/subscriber-tx.test.ts`（新，真库） | 测试订阅者在事务里先写系统提示（锁住会话行），再传 `tx` 调 6 个读方法。分发要在 5 秒内完成（远小于 10 秒锁超时），并能读到本事务刚写的系统提示。同一条用户消息的全部 `chat.message_created` 订阅者都要处理成功（收件箱有记录，含上表 1–6、10、11、13、14），无失败。不传 `tx` 的读法结果与事务内一致。 |
| `apps/server/test/upstream-isolation.test.ts`（加 1 例，真实网关 + 假上游） | 19 次不发。滑动窗口：10 分钟前的次数不算。凑满 20 次发 1 条，字段正确，不含用户消息、用户 ID、密钥，上游仍是正常。冷却期内再拒 25 次不发。模拟重启（清空内存）后再拒 20 次仍不发。满 1 小时后再凑满 20 次发第 2 条。日志 2 条。push 收下后后台列表按正式种类显示，同一上游累加为 2 次。 |
| `apps/server/test/proactive.test.ts`（改假端口） | 假 chat 端口补 `getParticipants`（proactive 订阅者现在调它）。 |
| `model-access/application/upstream-isolation.test.ts`（单元，加 3 例） | 参数值；文案长度和截断；自检失败不计数、自检通过才计数。 |
| 契约 `schemas.test.ts`、`service-unit-pricing.test.ts` | 新提醒种类能解析；旧版后台显示 `unsupported`；版本 5.7。 |

本机检查结果见第 7 节。

## 6. 行为上的细微变化（都是期望的）

- `ai.memory_on_message` 新增了用户 / 会话咨询锁。与回复引擎同时处理同一会话时会排队（咨询锁很快），不再交叉。
- 订阅者传 `tx` 后，`getParticipants`、`getActiveContact` 等会检查账号状态（`requireActive` / `getAccountStatus` 本来就会查）。账号已停用时订阅者提前返回，以前不传 `tx` 时也会返回空，结果相同。
- `official.on_user_registered` 的补齐挪到提交之后，仍在同一次分发里完成（`afterCommit` 在事务结束前执行完）。时序对外没有变化。

## 7. 本机检查结果

| 检查 | 结果 |
|---|---|
| contracts 类型检查 | 通过 |
| contracts 测试 | 101 / 101 通过 |
| server 类型检查 | 通过 |
| admin 类型检查 | 通过 |
| eslint（全部改动的 ts/tsx 文件）、prettier（改动文件）、depcruise 依赖规则 | 通过 |
| `pnpm android:generate:check` | 通过（Kotlin contracts 5.7） |
| server 相关测试 | 117 个文件、1166 例，真库。第一次跑有 1 例失败：`test/proactive.test.ts` 的假 chat 端口没有 `getParticipants`（proactive 订阅者现在调它）。补上假方法后，重跑 proactive 和两份记忆测试（memory-persona、memory-vector，覆盖 `ai.memory_on_message` 新加的锁），3 个文件、36 例全过。 |

server 相关测试的范围：
- 单元测试：`src/modules/` 下 ai-runtime、chat、growth、official-assistant、proactive、calls、model-access、play；
- 真库测试：subscriber-tx（新）、upstream-isolation、play-tx-deadlock、db-session-guards、chat、model-gateway、model-access、official-assistant、ai-runtime、ai-runtime-queue、proactive、growth-familiarity-stage6、contacts、moments-contact-reset、server-flow、simulation、outbox-inbox。

真库测试用自建的临时库 `weiban_test_txhard`，用完已删除，没有碰 `weiban_test`。合并以 CI 为准。

## 8. 遗留问题

1. **进程内计数重启会清零**：最多少算 10 分钟内的次数，下一轮照样会触发。冷却时间存在数据库，不受影响。
2. **上游删除后 settings 里留一个孤立键** `upstream_auth_rejected_alerted:{id}`：只有一行几十字节，没有功能影响。以后如果做 settings 清理，可以顺带处理。
3. `MomentsReadPort.getPostVisibleToCharacter` 没有 `tx`（第 2 节表格）：现在不会卡，需要契约变更申请。
4. `ai.call_ended` 在分发器事务里调模型（第 2 节表格）：功能开关关着，开启前要改成任务。
5. 文档未同步提醒种类（这次的范围只含 kernel.md）：
   - `docs/architecture/billing.md` 8.4 的提醒种类表需要补 `upstream_auth_rejected` 一行（architect）；
   - `docs/backend/model-access.md` 第 91 行的上游提醒清单需要补一句（backend，下次碰 model-access 时顺带）。

## 9. 给其他负责人的交接

- **architect**：
  - `docs/architecture/billing.md` 8.4 提醒表补 `upstream_auth_rejected`（warning，去重键 `upstream_auth_rejected:{upstreamId}`，阈值见 `UPSTREAM_AUTH_REJECTED_ALERT`）；
  - 评估给 `MomentsReadPort` 加可选 `tx` 的变更申请。
- **ai-lead**：开启 `PROACTIVE_CALLS_ENABLED` 之前，把 `ai.call_ended` 里的模型调用改成 pg-boss 任务（kernel.md 第 6 节第 3 条）。以后在 ai-runtime 订阅者里加读写，按第 6 节的顺序拿锁。
- **devops-lead**：
  - 生产日志关注 `upstream_auth_rejected_alert`（这是管理员提醒，不是故障）；
  - 出现 55P03、`deadlock detected` 时按 kernel.md 第 6 节第 4 条交给后端改代码，不要调大超时。
- **web-lead / android-lead**：没有影响。客户端不读新提醒种类；安卓生成产物已同步到 5.7。
- **Codex 验收**：
  - 重点看第 2 节加锁顺序的理由是否成立；
  - 看 `subscriber-tx.test.ts` 的超时断言；
  - 看提醒的冷却在重启后仍成立（测试里模拟了重启）。
