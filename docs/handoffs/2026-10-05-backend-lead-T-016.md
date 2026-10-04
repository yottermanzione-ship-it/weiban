# 交接说明：T-016 服务器平台内核（D-L0-05）

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人（backend-lead） |
| 日期 | 2026-10-05 |
| 分支 | `T-016-server-kernel`（基于 origin/main，已合并 T-015 `cde2628` 及之后的 main） |

## 做了什么

结论：`apps/server` 工程已建立，服务器能启动、能连本机数据库，`GET /health` 报告数据库状态；平台内核的 12 个部分全部实现并有测试；仓库根 `pnpm check` 通过（125 条测试，其中服务器 50 条）。

1. **工程**：`@weiban/server`（NestJS 11 + Express），`tsconfig`（继承 `@weiban/tsconfig/node.json`，开 `experimentalDecorators`）、`vitest.config.ts`、`drizzle.config.ts`、生产构建脚本 `scripts/build.mjs`。
2. **配置**（`platform/config/config.ts`）：Zod 校验环境变量，出错只报变量名不回显值；生产必须配主密钥；生产强制关闭 `DEBUG_LLM_PAYLOAD`；本机自动读根目录 `.env`。
3. **`product-params.ts`**：PRD v1.2 第 5.1 节 P-01～P-33 全部映射，常量带编号和来源注释，金额用微元。
4. **数据库与迁移**：连接池 + Drizzle；事务工具 `database.transaction(tx => …)`，`tx` 满足契约 `Tx`，支持 `afterCommit`；迁移执行器支持执行、回滚、状态，校验和防篡改、每个迁移单独事务、咨询锁；首个迁移 `0000_platform_kernel`（platform schema：`outbox`、`event_inbox`、`audit_log`、`user_data_keys`）及手写回滚脚本。
5. **事件发件箱与幂等收件箱**：`Outbox.publish(tx, …)` 与业务同事务写入、按契约严格校验；`EventBus` 登记订阅者；`EventDispatcher` 租约 + `SKIP LOCKED` 领取、订阅者与收件箱记录同事务、退避重试、10 次后标记 dead；提交后立即唤醒分发器。
6. **pg-boss 封装**：`JobQueue.send/work`，可在业务事务内投递，延迟按平台时钟，队列名校验，web 角色只投递不消费；启动失败可重试。
7. **平台时钟**（R7）：`Clock` / `SystemClock` / `TestClock`。
8. **结构化日志与脱敏**：pino JSON；按字段名 + 按内容两层打码，输出前整行再打码；日志自动带 requestId / eventId / jobId / userId；NestJS 框架日志也经过它。
9. **信封加密**：AES-256-GCM；KEK（文件）→ DEK（`platform.user_data_keys`，被 KEK 包装）→ 数据；AAD 绑定 owner 与行；平台数据密钥 owner = `platform`；`destroyKey` 供注销使用。
10. **鉴权守卫骨架**：全局守卫，`@RequireAuth('none'|'user'|'admin')`，**未标注默认要求登录**；令牌只读 `Authorization: Bearer`；校验由 identity 提供的 `SESSION_VERIFIER` 完成（平台不依赖 identity）。
11. **统一错误**：`AppError(错误码, 说明)`，全局过滤器输出契约 `ApiError`；`DEFAULT_ERROR_STATUS` 覆盖契约全部错误码；未知异常 500 不泄露细节；`ContractPipe` 用契约 schema 校验请求。
12. **健康检查**：`GET /health`，数据库正常 200 / 连不上 503，报告主密钥是否配置；数据库暂时不可用时进程不退出，后台工作退避重试。
13. **审计日志** `AuditLog.record()`（details 自动脱敏）。
14. **生产构建方式**（ADR-0014 交后端选定）：esbuild 打包源码与契约，npm 依赖外部化；`node dist/main.js` 运行，不需要构建契约。取舍写成 **ADR-0015（提议，待架构批准）**。
15. 文档：`docs/backend/kernel.md`（各部分怎么用）、`apps/server/README.md`。

## 验收标准逐条验证（均已实际运行）

| 验收项 | 结果 | 实际验证 |
|---|---|---|
| 仓库根 `pnpm check` 通过（含服务器 lint、typecheck、test） | 通过 | format:check 通过；`eslint .` 无报错；depcruise「no dependency violations found」；三个子项目 typecheck Done；`Test Files 14 passed`、`Tests 125 passed`；tokens 检查通过 |
| `pnpm db:up` 后服务器能启动，`GET /health` 正常并报告数据库状态 | 通过 | 开发方式（tsx）启动后：`200 {"status":"ok","role":"all","contractVersion":"1.0",…,"checks":{"database":{"ok":true,"latencyMs":2},"crypto":{"configured":false}}}`；生产包 `node dist/main.js`（配主密钥）：200，`crypto.configured: true`；数据库地址不可达时：`503 {"status":"degraded",…"database":{"ok":false}}` 且进程不退出 |
| 迁移能执行和回滚；集成测试用 `TEST_DATABASE_URL` | 通过 | 开发库命令行：`db:migrate` → 「已执行迁移 0000_platform_kernel」；`db:rollback` → 「已回滚」；`db:status` → `[未执行]`；再 `db:migrate` → `[已执行]`。测试 `test/migrations.test.ts`：执行→回滚→再执行、改动已执行迁移被拒绝、失败迁移整体回滚、每个迁移都有回滚脚本。集成测试只连 `TEST_DATABASE_URL`（指向开发库 `weiban` 时拒绝运行） |
| 发件箱同事务、回滚不发出；收件箱重复投递只处理一次（集成测试） | 通过 | `test/outbox-inbox.test.ts` 10 条：提交后业务和事件都在；回滚后两者都不存在且分发器领取 0 条；不合法事件写不进；`afterCommit` 只在提交后执行；人为把事件改回未投递再分发两次，订阅者只执行 1 次、副作用 1 行；`processOnce` 返回 duplicate；失败订阅者写入回滚、按时钟退避后重试、成功订阅者不重复；10 次后 dead；租约过期可重新领取 |
| 日志脱敏：假密钥走完流程后日志里搜不到（有测试） | 通过 | `test/http-kernel.test.ts`：金丝雀 `sk-weiban-canary-…` 放进请求体，接口把它写进日志字段、消息文本、`Bearer` 文本并抛出含它的异常（500），再用它当令牌请求；断言日志确实写了这些记录、且全部日志文本和接口响应中金丝雀出现 0 次；另有 `sanitize.test.ts` 5 条单元测试；分发器的 `last_error` 也经打码 |
| 信封加密往返正确；主密钥不在数据库中（有测试） | 通过 | `test/envelope-crypto.test.ts` 7 条：往返正确、密文无明文；数据密钥表十六进制导出中搜不到主密钥、`position(主密钥 in wrapped_dek)` 为假；AAD 不同 / 换用户 / 换主密钥都解不开；删除 DEK 后不可解；事务回滚不留 DEK；未配主密钥报不可用 |
| 当前时间一律经平台时钟，测试中可以固定时间 | 通过 | 内核中所有写库时间、事件 `occurredAt`、任务延迟、退避、健康检查时间都取 `Clock`；测试用 `TestClock`：事件 `occurredAt` 固定为设定值、任务 `startAfter` 精确为 `2030-01-01T00:00:05Z`、健康检查 `time` 为设定值、重试靠 `advance()` 不等待；R7 lint 通过 |
| `docs/backend/kernel.md` | 完成 | 15 节，含示例代码 |
| 提交格式 `T-016 类型: 说明` | 通过 | 本分支提交均符合 |

## 改了哪些文件

- 新增 `apps/server/`：`package.json`、`tsconfig.json`、`vitest.config.ts`、`drizzle.config.ts`、`scripts/build.mjs`、`drizzle/0000_platform_kernel.sql`、`drizzle/0000_platform_kernel.down.sql`、`drizzle/meta/*`
- 新增 `apps/server/src/`：`main.ts`、`app.module.ts`、`cli/migrate.ts`、`platform/index.ts`、`platform/platform.module.ts`，以及 `platform/` 下 `config/`（config、local-env、product-params）、`clock/`、`logging/`（logger、sanitize、log-context、nest-logger）、`db/`（database、migrator、schema、ids）、`events/`（outbox、event-bus、inbox、dispatcher）、`jobs/job-queue.ts`、`crypto/envelope.ts`、`audit/audit-log.ts`、`auth/auth.ts`、`http/`（app-error、error-filter、contract-pipe、request-context.middleware、health.controller）；单元测试 5 个
- 新增 `apps/server/test/`：`migrations`、`outbox-inbox`、`envelope-crypto`、`job-queue`、`http-kernel` 五个集成测试，`support/`（setup-env、db、fixtures）
- 修改 `apps/server/README.md`、`pnpm-lock.yaml`
- 新增 `docs/backend/kernel.md`、`docs/decisions/ADR-0015-server-kernel-implementation.md`（提议）、本交接说明

## 新增第三方依赖（全部为宽松许可证，均有预编译或纯 JS，不需要本机 C++ 编译）

| 包 | 用途 | 许可证 |
|---|---|---|
| @nestjs/common、core、platform-express 11.2.7；@nestjs/testing（开发） | 服务器框架（ADR-0003） | MIT |
| reflect-metadata 0.2.2、rxjs 7.8.2 | NestJS 必需 | Apache-2.0 |
| drizzle-orm 0.45.3 / drizzle-kit 0.31.11（开发） | ORM / 生成迁移 | Apache-2.0 / MIT |
| pg 8.23.1、@types/pg | PostgreSQL 驱动（纯 JS） | MIT |
| pg-boss 12.36.0 | 任务队列（ADR-0003） | MIT |
| pino 10.4.0 | 结构化日志 | MIT |
| uuid 14.0.2 | UUIDv7 | MIT |
| zod 4.6.5 | 配置校验（契约同版本） | MIT |
| esbuild 0.28.2、tsx 4.23.15（开发） | 生产打包 / 开发运行（`allowBuilds` 已有 `esbuild: false`，用预编译二进制） | MIT |
| supertest 7.3.1、@types/supertest、@types/express（开发） | HTTP 测试 / 类型 | MIT |

## 遗留问题

1. **ADR-0015 待架构负责人批准**（迁移回滚做法、生产构建、显式 `@Inject`、事件分发方式）。批准后 TD-018 可关闭。
2. **CI 没有数据库**：没有 `TEST_DATABASE_URL` 时服务器集成测试整组跳过（30 条），只跑单元测试；实测无 `.env` 时 `20 passed | 30 skipped`。需要运维在 CI 加 PostgreSQL 服务。
3. **主密钥轮换脚本**未实现（表结构和 `kek_version` 已支持多版本主密钥，`EnvelopeCrypto` 已能用旧版本解包）。建议在 D-L0-08（上游登记）或 D-L0-14（部署）前补一个命令行脚本。
4. **启动时不自动迁移**：部署流程要先执行 `node dist/migrate.js up`（或 `pnpm --filter @weiban/server db:migrate`）。
5. `/health` 不在 `/api/v1` 下，也不在契约里（它面向运维，不面向客户端）。若 Caddy 只转发 `/api/*`，健康检查从容器内部访问即可。
6. 错误码默认 HTTP 状态码表中，契约没写明状态码的几项是后端按规范第 4 节自定的（例如 `client_too_old` 426、`account_locked` 429、`insufficient_balance` 422、`character_not_available` 422），各模块实现时如与契约说明冲突以契约为准，可用 `AppError` 的 `status` 覆盖。
7. 事件分发器在 `APP_ROLE=web` 的进程不运行：拆成 web + worker 两个进程部署时，事件由 worker 投递（web 进程提交事件后的「立即唤醒」只在 all 角色生效，worker 按 500 毫秒轮询）。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- **给架构负责人**：请评审 **ADR-0015**（提议）；批准后在 `tech-debt.md` 关闭 TD-018。无契约变更申请。提醒：契约 `ports/common.ts` 的 `Tx` 品牌类型由平台 `DbTx` 实现，端口实现用 `asDbTx(tx)` 取回。
- **给运维负责人**：
  1. CI 加 PostgreSQL 18 + pgvector 服务容器，设置 `TEST_DATABASE_URL`（库名不能是 `weiban`），否则服务器集成测试会被跳过。
  2. 部署（D-L0-14）：生产构建 `pnpm --filter @weiban/server build`，镜像需包含 `apps/server/dist` 与服务器的生产依赖 `node_modules`；启动前执行 `node dist/migrate.js up`；环境变量 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT`、`DATABASE_URL`、`PLATFORM_KEK_FILE`（Docker secret，内容为 32 字节的 base64 或 64 位十六进制）、可选 `APP_ROLE`、`LOG_LEVEL`；容器健康检查用 `GET /health`（200 正常，503 数据库不可用）。
  3. `.env.example` 可以补一行注释说明 `PLATFORM_KEK_FILE`（开发可不填，此时加密功能不可用）——`.env.example` 归运维，我没有改。
  4. 新增模块目录前要在 `architecture.js` 登记——本任务没有新增模块目录，无需改 eslint-config。
- **给后续后端任务（D-L0-06 identity 等）**：先读 `docs/backend/kernel.md`。identity 需实现 `SessionVerifier` 并提供 `SESSION_VERIFIER`；注销时用 `ENVELOPE_CRYPTO.destroyKey(userId, tx)`；billing 的 `index.ts` 导出 `BILLING_RESERVATION_PORT`、`BILLING_READ_PORT` 两个 Symbol 令牌；各模块测试工具放 `testing.ts`。
- **给 AI 负责人**：ai-runtime 用 `JOB_QUEUE`（队列名以 `ai.` 开头）做延迟与定时任务、用 `EVENT_BUS` 订阅事件、用 `CLOCK` 取时间；产品参数（P-01、P-02、P-28 等）从 `platform/config/product-params.ts` 导入，不要另写数字。
- **给质量负责人（Codex）**：复核命令：`pnpm install && pnpm db:up && pnpm check`；手动：`pnpm --filter @weiban/server db:migrate`、`db:rollback`、`dev` 后访问 `http://127.0.0.1:3000/health`。关键测试见上表；日志金丝雀测试在 `apps/server/test/http-kernel.test.ts` 最后一条。
- **给项目总负责人**：①ADR-0015 转架构批准；②CI 数据库服务转运维；③主密钥轮换脚本建议排进 D-L0-08 或 D-L0-14 之前。
