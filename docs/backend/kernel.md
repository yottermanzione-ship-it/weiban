# 服务器平台内核使用说明（apps/server/src/platform）

> 负责人：后端负责人 · v1.0 · 2026-10-05 · 来源任务：T-016（D-L0-05）；T-023 补充计费配置项与定时任务 `JobQueue.schedule`
> 读者：之后写业务模块（identity、billing、model-access、chat……）的负责人。
> 规则来源（本文不重复）：`docs/architecture/engineering-standards.md`、`security-and-privacy.md`、`message-reliability.md`、ADR-0004、ADR-0006、ADR-0014。实现取舍见 `docs/decisions/ADR-0015-server-kernel-implementation.md`。

## 0. 一句话

平台内核是所有业务模块共用的「地基」：配置、时钟、日志、数据库与事务、事件发件箱与收件箱、任务队列、加密、审计、鉴权、错误格式、健康检查。**业务模块只从 `platform/index.ts` 导入**（相对路径，例如 `'../../platform/index.js'`），用 `@Inject(令牌)` 拿到服务。

## 1. 目录

| 目录 / 文件 | 内容 | 注入令牌 |
|---|---|---|
| `config/config.ts` | 环境变量校验 → `AppConfig` | `APP_CONFIG` |
| `config/product-params.ts` | PRD 第 5.1 节 P-01～P-33 的唯一映射 | 直接 import 常量 |
| `clock/clock.ts` | 平台时钟（R7）；测试用 `TestClock` | `CLOCK` |
| `logging/` | pino 结构化日志 + 脱敏；日志上下文（requestId 等） | `LOGGER` |
| `db/database.ts` | 连接池、Drizzle、事务 `transaction()` | `DATABASE` |
| `db/migrator.ts`、`cli/migrate.ts` | 迁移执行与回滚 | — |
| `db/schema.ts` | platform schema 的表 | （业务模块不得访问） |
| `events/` | 发件箱 `Outbox`、订阅登记 `EventBus`、幂等收件箱 `EventInbox`、分发器 | `OUTBOX`、`EVENT_BUS`、`EVENT_INBOX`、`EVENT_DISPATCHER` |
| `jobs/job-queue.ts` | pg-boss 封装 | `JOB_QUEUE` |
| `crypto/envelope.ts` | 信封加密 `seal` / `open` / `destroyKey` | `ENVELOPE_CRYPTO` |
| `audit/audit-log.ts` | 审计日志 | `AUDIT_LOG` |
| `auth/auth.ts` | 鉴权守卫（全局）、`@RequireAuth`、`@CurrentPrincipal` | 业务方提供 `SESSION_VERIFIER` |
| `deletion/user-data-registry.ts` | 删除清单登记处（注销用，见第 16 节） | `USER_DATA_REGISTRY` |
| `http/` | `AppError`、全局异常过滤器、请求 ID、`ContractPipe`、`GET /health` | — |
| `platform.module.ts` | 全局 Nest 模块，装配以上全部 | — |

## 2. NestJS 写法约定（重要）

- **构造函数注入一律显式写 `@Inject(令牌)`**，不依赖参数类型推断。原因：开发运行用的 tsx 和生产打包用的 esbuild 都不生成装饰器元数据（`emitDecoratorMetadata`），不写 `@Inject` 会注入 `undefined`。
  ```ts
  @Injectable()
  export class SendUserMessage {
    constructor(
      @Inject(DATABASE) private readonly database: Database,
      @Inject(OUTBOX) private readonly outbox: Outbox,
      @Inject(CLOCK) private readonly clock: Clock,
    ) {}
  }
  ```
- 模块自己的类也用令牌或 `@Inject(类名)` 显式注入。
- 服务器内部 import 一律写相对路径并带 `.js` 后缀（禁止路径别名，lint 拦截）。

## 3. 配置

环境变量只在 `config.ts` 里读取并用 Zod 校验，不合法时拒绝启动（只报变量名，不回显值）。本机开发自动读仓库根目录 `.env`（生产不读文件）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `NODE_ENV` | development | development / test / production |
| `APP_ROLE` | all | web（只开 HTTP，任务只投递不消费，不跑分发器）/ worker（不开 HTTP）/ all |
| `HOST`、`PORT` | 127.0.0.1、3000 | 容器内需设 `HOST=0.0.0.0` |
| `HTTP_TRUST_PROXY` | 不信任 | 反向代理（Caddy）后面**必须设置**，否则取不到真实客户端 IP，按 IP 的登录锁定会把所有人当成同一个 IP。Caddy 在前面一层填 `1`；也可填 `loopback`、网段等（Express trust proxy 语法）。T-018 新增 |
| `DATABASE_URL` | 必填 | |
| `DATABASE_POOL_MAX` | 10 | |
| `LOG_LEVEL` | info | |
| `PLATFORM_KEK_FILE` | 开发可空，**生产必填** | 主密钥文件：32 字节的 base64 或十六进制 |
| `PLATFORM_KEK_VERSION` | 1 | 轮换主密钥时加一 |
| `EVENTS_POLL_INTERVAL_MS` | 500 | 分发器轮询间隔 |
| `DEBUG_LLM_PAYLOAD` | 关 | 生产强制关闭 |
| `BILLING_PLATFORM_DAILY_CAP_MICROS` | 开发 / 测试 20 元；**生产必填** | 平台每日总上限（按成本价，微元；billing.md 第 7 节）。生产不配置拒绝启动（T-023） |
| `BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS` | 不设（用 billing.md 6.6 的 2 元） | 安全优先透支上限覆盖值，运维一般不用设（T-023） |
| `BILLING_UPSTREAM_DIFF_RATIO` | 0.03 | 对账第 ③ 层上游账单偏差阈值（T-023） |

新增配置项：加到 `EnvSchema` 和 `AppConfig`，并在交接说明中告诉运维（`.env.example` 归运维维护）。模块专用变量带模块前缀（`MODEL_ACCESS_…`）。

产品参数一律从 `product-params.ts` 导入（例：`P23_RECALL_WINDOW_MS`），不要在别处写同样的数字。

## 4. 时间

```ts
const now = this.clock.now(); // Date，UTC
```
业务代码禁止 `new Date()` / `Date.now()`（R7，lint 拦截）。写数据库时间也用时钟的值（不要用 SQL 的 `now()`），这样测试能用 `TestClock` 固定或拨快时间（`set()` / `advance()`），禁止在测试里真的等待。

## 5. 日志

```ts
this.log = logger.child({ module: 'chat' });
this.log.info({ conversationId }, '会话已创建');
```
- 每条日志自动带 `requestId`（HTTP）/ `eventId`（事件分发）/ `jobId`（任务）/ `userId`（鉴权后）。
- **源头不写**：不要把密钥、令牌、密码、聊天正文、记忆、导入原文、模型请求全文传给日志。
- 兜底脱敏（自动）：字段名像 `authorization / apiKey / secret* / *token / password / content / text / prompt / messages` 的整值换成 `[REDACTED]`；任何字符串里的 `sk-…`、`Bearer …`、连续 32 位以上字母数字换成 `[REDACTED]`；最后整行输出前再按内容打码一次。UUID 不受影响。
- Error 对象会转成 `{type, message, stack}`（同样打码）。

## 6. 数据库与事务

```ts
await this.database.transaction(async (tx) => {
  await tx.db.insert(messages).values({...});           // Drizzle（本模块 pgSchema 下的表）
  await this.sync.appendUpdate(tx, ...);                  // 把 tx 传给其他模块的端口：同一事务
  await this.outbox.publish(tx, 'chat.message_created', 'chat', {...});
  tx.afterCommit(() => this.realtime.push(...));          // 提交成功后才做；回滚则不执行
});
```
- `tx` 满足契约的 `Tx` 类型，可以直接传给端口；端口实现里用 `asDbTx(tx)` 转回来。
- `tx.query(sql, params)` 执行原生 SQL（只能访问本模块 schema，R8）。
- 表定义放 `modules/<模块>/infra/db/schema.ts`，用 `pgSchema('<模块 schema>')`；主键用 `newId()`（UUIDv7）。
- 数据库健康：`database.ping()`。

### 数据库迁移

| 命令（仓库根目录运行） | 作用 |
|---|---|
| `pnpm --filter @weiban/server db:generate` | 根据表定义生成迁移 SQL（drizzle-kit）到 `apps/server/drizzle/` |
| `pnpm --filter @weiban/server db:migrate` | 执行所有未执行的迁移 |
| `pnpm --filter @weiban/server db:rollback` | 回滚最近 1 个；`db:rollback -- 3` 回滚 3 个 |
| `pnpm --filter @weiban/server db:status` | 列出迁移及是否已执行 |

规则：
1. 生成后**必须手写**同名回滚脚本 `NNNN_名字.down.sql`（drizzle-kit 不生成回滚）。缺少回滚脚本时迁移拒绝执行，测试也会失败。
2. 迁移只增不改：已执行的迁移文件被改动（校验和不一致）时执行器拒绝继续。
3. 每个迁移在自己的事务里执行，失败整体回滚；执行记录在 `public.schema_migrations`；多个进程同时迁移会排队（咨询锁）。
4. 服务器启动时**不自动迁移**，部署时先执行迁移（生产：`node dist/migrate.js up`）。

## 7. 事件：发件箱与幂等收件箱

**发布**（必须在业务写入的同一事务里）：
```ts
await this.outbox.publish(tx, 'contacts.contact_accepted', 'contacts', { ... });
```
事件结构按契约 `Events.DomainEvent` 严格校验，不合法直接抛错（事务随之回滚）。事务回滚 → 事件不存在；提交 → 分发器保证**至少投递一次**。

**订阅**（模块启动时登记，例如在模块类的 `onModuleInit` 里）：
```ts
this.bus.subscribe({
  consumer: 'push.on_message_created',   // 「模块.on_事件」，全局唯一，上线后不要改名（去重靠它）
  eventType: 'chat.message_created',
  handle: async (event, tx) => {
    // 只做快速、可重复的事；耗时工作在 tx 里投递 pg-boss 任务
    await this.jobs.send('push.notify', { messageId: event.payload.messageId }, { tx });
  },
});
```
- `handle` 和收件箱记录在同一事务：成功 → 一起提交，之后重复投递直接跳过；抛错 → 一起回滚，稍后重投。
- 失败重试按 1、2、4……秒退避（最长 10 分钟），累计 10 次仍失败标记 `dead_at` 并写错误日志，需人工处理（修好后把 `platform.outbox.dead_at` 清空即重投）。
- 每个订阅者必须有「重复投递不产生重复效果」的测试（engineering-standards.md 第 7 节）。
- pg-boss 任务等其他「至少一次」场景也可以直接用 `inbox.processOnce(名字, id, async (tx) => …)` 去重。

## 8. 任务队列（pg-boss）

```ts
await this.jobs.work('ai.generate_reply', async (job) => { ... });                 // 启动时登记
await this.jobs.send('ai.generate_reply', { conversationId }, { tx, delayMs: 3000 }); // 投递
```
- 队列名「模块.动作」，第一次使用自动创建。传 `tx` 则与业务写入同一事务。
- `delayMs` 按平台时钟计算；`singletonKey` 防重复；`retryLimit` 等重试参数可选。
- 任务至少执行一次，处理函数要幂等；任务数据只放 ID。
- `APP_ROLE=web` 的进程只投递不消费。需要防抖等高级用法时用 `jobs.boss`（pg-boss 原对象），并在交接说明里说明。
- **定时任务**（T-023）：`await jobs.schedule('billing.expire_holds', '* * * * *', { tz })`（cron，默认按北京时间解释），处理函数照常用 `work()` 登记；只在消费任务的进程生效，多个进程登记同一个名字只保留一份。触发时刻按真实时间，处理函数里取「现在」仍用平台时钟。

## 9. 加密（信封加密）

```ts
const sealed = await this.crypto.seal(PLATFORM_KEY_OWNER, `upstream:${id}`, apiKey, tx); // 存 bytea
const apiKey = (await this.crypto.open(PLATFORM_KEY_OWNER, `upstream:${id}`, sealed)).toString('utf8');
await this.crypto.destroyKey(userId, tx); // 注销：该用户的加密数据永久不可解
```
- owner 只能是 `PLATFORM_KEY_OWNER`（平台数据密钥，上游密钥用）或用户 ID（导入原文用）。
- AAD 按 `security-and-privacy.md` 3.1：上游密钥 `upstream:{upstreamId}`，导入原文 `import:{jobId}:{userId}`。
- 主密钥只从 `PLATFORM_KEK_FILE` 读，**不进数据库**；数据库里只有被主密钥包装过的数据密钥。
- 未配置主密钥时 `seal/open` 抛 `CryptoUnavailableError`（接口返回 503）。
- 解密结果用完即弃，不缓存、不写日志。任何模块不得自己写加密代码。
- 主密钥轮换脚本尚未实现（见交接说明遗留问题）。

## 10. 鉴权

```ts
@Controller('api/v1/contacts')
export class ContactsController {
  @Get() list(@CurrentPrincipal() me: AuthPrincipal) { ... }       // 默认：需要登录（user）
  @Post('x') @RequireAuth('none') open() { ... }                   // 不需要登录
  @Get('admin/y') @RequireAuth('admin') admin() { ... }            // 管理会话
}
```
- 取值与契约 `defineEndpoint` 的 `auth` 一致；**没标注的接口默认要求登录**。
- 令牌只从 `Authorization: Bearer` 读取。
- identity 模块已实现 `SessionVerifier` 并提供 `SESSION_VERIFIER`（T-018，见 `identity.md`）；未提供时所有需要登录的接口一律 401。集成测试要换成假的校验器时用 `Test.createTestingModule(...).overrideProvider(SESSION_VERIFIER)`（参考 `test/http-kernel.test.ts`）。
- admin 要求 `role = admin` 且 `adminSession = true`。

## 11. 错误与请求校验

```ts
throw new AppError('contact_limit_reached', '通讯录已满');          // 默认状态码见 DEFAULT_ERROR_STATUS
@Body(new ContractPipe(AddContactRequest)) body: AddContactRequest   // 契约 schema 校验
```
- 返回格式即契约 `ApiError`：`{"error": {"code", "message", "requestId", "details?"}}`。
- 错误码只能用契约 `ErrorCode` 中已有的；默认状态码表 `DEFAULT_ERROR_STATUS` 覆盖全部错误码（契约新增错误码而这里没补，类型检查失败）。
- 未知异常对外一律 500「服务器内部错误」，细节只进日志（会脱敏）。路由不存在 404 `not_found`，请求体不是合法 JSON 400 `bad_request`。
- 校验失败的 `details.issues` 只有字段路径和原因，不回显值。

## 12. 审计日志

```ts
await this.audit.record({ module: 'model_access', action: 'upstream.created', actorType: 'admin',
  actorId, targetType: 'upstream', targetId: upstreamId }, tx);
```
details 自动脱敏，但仍不要放密钥和正文。

## 13. 健康检查

`GET /health`（不需要登录，不在 `/api/v1` 下，不属于客户端契约）：数据库正常 200 `{"status":"ok",…}`，连不上 503 `{"status":"degraded",…}`；同时报告主密钥是否已配置、进程角色、契约版本。数据库暂时连不上时进程不退出，后台工作按退避重试启动。

## 14. 运行与构建

| 场景 | 命令 |
|---|---|
| 本机开发（热重载） | `pnpm db:up` 后 `pnpm --filter @weiban/server dev` |
| 本机运行一次 | `pnpm --filter @weiban/server start` |
| 生产构建 | `pnpm --filter @weiban/server build` → `apps/server/dist/main.js`、`dist/migrate.js` |
| 生产运行 | 先 `node dist/migrate.js up`，再 `node dist/main.js`（工作目录 `apps/server`，需要 `node_modules`） |

**生产构建方式（ADR-0014 结论 1 交后端选定）**：用 esbuild 把服务器源码和 `@weiban/contracts`（源码形式）打包进 `dist/`，其他 npm 依赖不打包、运行时从 `node_modules` 加载。因此运行生产包**不需要**先构建契约、也不需要 `--conditions=weiban-dist`。Docker 镜像需要包含 `apps/server/node_modules`（`pnpm install --prod --filter @weiban/server...` 或 `pnpm deploy`），细节由运维在 D-L0-14 定。

## 15. 测试

- 单元测试与源码放一起（`*.test.ts`）；集成测试放 `apps/server/test/`，只 import 模块 `index.ts`、`testing.ts`、`platform/**`、`app.module.ts`、`main.ts`（R10）。
- 集成测试连 `TEST_DATABASE_URL`（`weiban_test` 库）；没设置时整组跳过并打印提示，设置了但连不上则失败。测试文件依次运行（不并行），因为会清空重建测试库。
- 工具在 `apps/server/test/support/`：`resetTestDatabase()`（清空并执行全部迁移）、`describeDb`、`captureLogger()`（把日志收集到内存搜索）、`canaryKey()`（`sk-weiban-canary-…` 金丝雀密钥）、`testKekRing()`。
- HTTP 测试用 `Test.createTestingModule({ imports: [AppModule.forRoot({..., background: false})] })` + supertest，参考 `test/http-kernel.test.ts`。

## 16. 删除清单（注销账号）

每个拥有用户数据的模块**必须**登记删除清单（security-and-privacy.md 第 5.1 节；契约 `UserDataOwner`），在模块类的 `onModuleInit` 里：

```ts
constructor(@Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry) {}
onModuleInit() {
  this.registry.register({
    module: 'chat',                                   // 契约 Events.ModuleName 的取值
    purgeUser: async (userId) => { /* 物理删除本模块该用户全部数据（含对象存储文件），返回删除行数；必须可重复调用 */ },
    countUserData: async (userId) => { /* 剩余条数，注销完成后必须为 0 */ },
  });
}
```

- **不用自己写订阅者**：identity 收到 `identity.user_deletion_requested` 后，为每个登记的模块投递一个 pg-boss 任务 `identity.purge_user_data`，任务里调用 `purgeUser` 并发布 `platform.user_data_purged`；全部模块回报后 identity 删除账号本身。流程见 `identity.md` 第 6 节。
- `purgeUser` 在任务里执行（不在事件订阅者里，可以慢），自己开事务；任务至少执行一次、失败会重试，`purgeUser` 会被再调用（第二次通常返回 0），所以必须可重复调用。
- 注销核验：`pnpm --filter @weiban/server identity verify-purged <用户ID>` 列出每个模块的 `countUserData`。
