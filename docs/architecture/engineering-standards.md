# 工程规范

> 负责人：架构负责人 · v1.3 · 2026-10-05 · 来源任务：T-004，T-009 修订（R9、金额规则、安卓第 10 节），T-014 修订（第 3 节实现方式、R4 范围、R9 加固、R10 测试引用、10.4 主题同步），T-020 修订（第 3 节措辞与 T-015 实现对齐：工具、R7 范围、R9 范围与豁免、R10 装配入口、新增 R11 循环依赖；新增 3.4 服务器代码约定与第 5 节迁移回滚，依据 ADR-0015），T-024 修订（第 4 节第 2 条：客户端只按 `unauthenticated` 退出登录）
> 适用于所有写代码的负责人。git 分支与提交格式见 `docs/ops/git-workflow.md`，本文不重复。违反「必须」条款的代码，质量负责人可以直接判定验收不通过。

## 1. 语言与通用规则

1. 服务器、网页、管理后台、契约**必须**使用 TypeScript，`strict: true`，禁止 `any`（确实需要时用 `unknown` 再校验）。安卓原生客户端使用 Kotlin（ADR-0011），规则见第 10 节。
2. **必须** 用 Prettier 统一格式（默认配置 + `printWidth: 100`、单引号）；用 ESLint 检查（共享配置在 `packages/eslint-config`）。CI 中格式或 lint 不通过即失败。
3. 代码里的标识符用英文；注释和提交说明可以用中文。界面文案用中文，并遵循 `docs/product/glossary.md` 的标准用词。
4. **一个文件做一件事**，超过 300 行要考虑拆分。
5. 所有外部输入（HTTP 请求、WebSocket 帧、事件载荷、环境变量、模型返回的 JSON）**必须**用 `packages/contracts` 里的 Zod schema 校验后再使用。

## 2. 命名

| 对象 | 规则 | 例子 |
|---|---|---|
| 目录、文件 | 小写短横线（kebab-case） | `send-user-message.ts`、`model-access/` |
| 类、类型、Zod schema | 大驼峰（PascalCase） | `ChatMessage`、`SendMessageRequest` |
| 变量、函数 | 小驼峰（camelCase） | `clientMsgId`、`assignNextSeq()` |
| 常量 | 全大写下划线 | `MAX_GROUP_MEMBERS` |
| 数据库 schema、表、列 | 小写下划线（snake_case），表名用复数 | `chat.messages.client_msg_id` |
| HTTP 路径 | `/api/v1/` + 小写短横线复数名词 | `/api/v1/billing/price-versions` |
| JSON 字段（接口、事件） | 小驼峰 | `{"conversationId": "..."}` |
| 事件类型 | `模块.过去式动作`，小写下划线 | `chat.message_created` |
| 任务队列名 | `模块.动作` | `ai.generate_reply`、`contacts.accept_request` |
| 错误码 | 小写下划线 | `contact_limit_reached` |
| 环境变量 | 全大写下划线，模块前缀 | `MODEL_ACCESS_KEK_FILE` |

PRD 参数（P-01 起，编号以 PRD 第 5.1 节为准）在代码中**只在一个文件**里映射：`apps/server/src/platform/config/product-params.ts`，常量名带编号，如 `P03_PROACTIVE_PER_CHARACTER_PER_DAY = 3`，注释写明「来源：PRD 第 5 节 P-03」。PRD 改数字时只改这个文件。

## 3. 模块边界规则（CI 强制）

依据 ADR-0004，由运维在 `packages/eslint-config` 中实现，两种工具分工如下（规则与实现的对照表见该包 README；分层和 schema 名单只在 `packages/eslint-config/architecture.js` 一处映射，内容以 ADR-0004 第 3 节、`overview.md` 第 4 节为准）：

| 工具 | 负责的规则 | 说明 |
|---|---|---|
| **本地 ESLint 规则**（自写插件 `weiban`，按文件路径和 import 语句判断） | R1～R10 | 不使用 `eslint-plugin-boundaries`（T-014 确认：它只能覆盖 R1～R3，还要额外的 TypeScript 路径解析器） |
| **dependency-cruiser**（`pnpm lint:deps`，并入 `pnpm lint`） | **只用于 R11**（跨模块循环依赖） | 循环要看整张引用图，单个文件的 lint 看不出来；纯 JavaScript、无原生二进制（T-015 选型）。**不用它检查 R1～R10**，避免同一条规则两处实现 |

> 规则只按「名字」静态判断（R7、R9 尤其如此）：先把 `Date` 赋给别的变量再用、运行时拼字符串取属性之类的写法拦不住，由代码评审兜底（技术债 TD-021）。

| 规则 | 允许 | 禁止 |
|---|---|---|
| R1 公开出口 | `import { X } from '../chat'` | `import ... from '../chat/infra/db/schema'`；服务器代码使用路径别名（如 `@/modules/chat`），一律用相对路径，lint 对别名直接报错（否则 R1～R3 会悄悄失效） |
| R2 层级方向 | 上层 → 中层 → 底层 → platform | 下层 import 上层 |
| R3 聊天不依赖 AI | — | `modules/chat/**` 出现任何对 `modules/ai-runtime` 的 import |
| R4 模型出口唯一 | 只有 `modules/model-access/**` 可以 import 供应商 SDK 或向供应商域名发请求 | 其他模块、**`packages/ai-evals/**`**（T-014，见 3.3）直接调用模型 API |
| R5 推送出口唯一 | 只有 `modules/push/**` 可以 import 推送 SDK | 其他模块直接发推送 |
| R6 契约来源 | 前后端接口类型只从 `@weiban/contracts` 导入 | 在 web / server 里另写一份接口类型 |
| R7 时间 | 使用 `platform/clock` | `new Date()`、`Date()`、`Date.now`（含不调用的引用）及经 `globalThis` / `global` / `window` / `self` 访问的同等写法。范围：`apps/server/src` 下**除 `platform/` 和测试文件以外的全部文件**（含 `main.ts`、`app.module.ts`、`cli/` 等，T-015） |
| R8 数据表 | 模块只访问自己 `pgSchema` 下的表 | 原生 SQL 里出现别的 schema 名 |
| R9 扣费出口唯一（T-009，T-014 加固，T-020 按实现确认范围） | 只有 `modules/model-access/**`、`modules/billing/**`、装配入口（`main.ts`、`app.module.ts`）、集成测试 `apps/server/test/**` 可以出现 `BillingReservationPort`、`BILLING_RESERVATION_PORT`、`estimateAndReserve` 这些名字；其他地方只能用 `BillingReadPort.getSpendStatus` | 其他代码自行冻结、扣费或改余额；范围是 `apps/server/src` **全部**（含 `platform/`、其他目录、模块目录内的单元测试）；检查方式见 3.1 |
| R10 测试引用（T-014，T-020 补装配入口） | `apps/server/test/**`（集成测试）只 import 各模块公开出口 `index.ts`、各模块测试出口 `testing.ts`、`platform/**`，以及**装配入口 `src/app.module.ts`、`src/main.ts`**（启动整个应用用，扩展名可省略）；模块目录内与源码放在一起的单元测试（`*.test.ts`）可以引用**本模块**内部文件，也可以引用其他模块的 `testing.ts` | 集成测试 import 某个模块的内部文件（`domain/`、`infra/` 等）或 `src/` 下其他目录（`config/`、`cli/` 等）；**生产代码 import 任何 `testing.ts`（含本模块的）**；见 3.2 |
| R11 无跨模块循环（ADR-0004 第 3 节，T-015 实现） | 模块之间单向依赖 | `modules/A` 的文件沿 import 绕一圈回到 `modules/A`、且途中经过别的模块（`import type` 也算）。同一模块内部文件之间的循环、测试文件不查（ADR-0004 未要求，若以后出现问题再收紧） |

### 3.1 R9 加固方案（Q-009；实现：运维 T-015）

原规则按「调用对象的变量名里有没有 billing」判断，换个变量名（`port.settle`）或用计算属性（`billingPort['estimateAndReserve']`）就能绕过。加固思路：**不猜名字，管住「拿到扣费端口」的唯一途径——import**。

1. **契约拆分（已在契约 1.0 完成）**：原 `BillingPort` 拆为 `BillingReservationPort`（冻结 / 结算 / 解冻）与 `BillingReadPort`（`getSpendStatus`）。不 import 前者，就写不出调用它的合法代码。
2. **注入令牌**：billing 模块在自己的 `index.ts` 导出两个注入令牌 `BILLING_RESERVATION_PORT`、`BILLING_READ_PORT`，**必须是 `Symbol`**（不能是字符串，否则不 import 也能凭字符串取到）。实现类只在 billing 内部，受 R1 保护。
3. **lint 规则 A（主检查）**：在 `apps/server/src` **全部文件**中（含 `platform/`、`src` 下其他目录、模块目录里的单元测试；豁免见第 6 条），以下任何写法出现名为 `BillingReservationPort` 或 `BILLING_RESERVATION_PORT` 的名字都报错——按**名字本身**判断（导入时按被导入的原名），与本地变量名无关：
   - `import { BillingReservationPort } …`、`import type { … }`、`import { BillingReservationPort as X } …`；
   - 再导出 `export { BillingReservationPort } from …`、`export * from` 后经他处使用；
   - 命名空间导入后访问：`import * as c from '@weiban/contracts'` 之后的 `c.BillingReservationPort`、`c['BillingReservationPort']`（值或类型位置，含 `TSQualifiedName`）；`import('…').BillingReservationPort` 类型；
   - 动态导入 `import('…')` 后解构出这两个名字；字符串形式的导入名。
4. **lint 规则 B（兜底）**：同一范围内，名为 `estimateAndReserve` 的任何访问都报错，包括 `x.estimateAndReserve`、`x['estimateAndReserve']`、无插值模板字符串键、解构 `const { estimateAndReserve } = x`、字符串常量。`settle` / `release` 是常见单词，不按名字查，由规则 A 覆盖。
5. **lint 规则 C**：除 `platform/**`、装配入口（`main.ts`、`app.module.ts`）、`apps/server/test/**` 外，**任何名为 `ModuleRef` 的标识符**都报错（不限来源包，含别名导入、`core.ModuleRef`）——动态按令牌取服务会绕开 import 检查。规则 C 对 `model-access`、`billing` **同样生效**（它们也不需要 `ModuleRef`）。
6. **豁免**（只对规则 A、B）：`modules/model-access/**`、`modules/billing/**`、装配入口、`apps/server/test/**`（集成测试需要直接测计费）。
6a. **T-020 确认的四处取舍**（运维 T-015 按「最严格理解」实现，架构确认全部保留）：
   - R10 允许集成测试引用装配入口 `app.module.ts`、`main.ts`（总负责人裁定），`src/` 下其他目录仍禁止；
   - 规则 A、B 的范围是 `apps/server/src` 全部，不只 `modules/**`——`platform/` 是全体模块的底座，更不应该接触扣费端口；
   - 规则 C 对 `model-access`、`billing` 也生效，集成测试豁免；
   - 只按名字判断：受限范围内**自己声明**同名变量 / 接口（例如本地写一个 `estimateAndReserve` 函数）也会报错。这是有意的：这几个名字在业务代码里本来就不该出现，换个名字即可，误报成本远低于漏报。
7. **测试（运维补齐）**：每种违规写法各一条「报错」用例——至少覆盖 Q-009 的两种绕过（声明为 `BillingReservationPort` 类型的 `port` 调用 `port.settle`、`billingPort['estimateAndReserve']`）、别名导入、命名空间导入、解构；以及「model-access 内调用不报错」「其他模块只用 `BillingReadPort.getSpendStatus` 不报错」两条合规用例。
8. 剩余风险：`any` 被禁止（第 1 节）、跨模块内部文件被 R1 禁止，仍可能存在的绕过只剩人为构造的反射写法，由代码评审兜底（质量负责人评审 billing 相关改动时专门检查）。

### 3.2 集成测试与模块内部（R10，QA 建议 3）

- 集成测试（`apps/server/test/`）站在「模块外面」验证行为：通过 HTTP 接口、端口、事件来驱动和断言，**不直接引用模块内部文件**，否则模块内部一重构，集成测试就大面积失效，也会掩盖越界依赖。
- 测试需要的假实现、测试数据工厂、清表工具，由各模块在 `modules/<模块>/testing.ts` 中导出（第二个公开出口，只给测试用，生产代码 import 它 lint 报错）。模型网关和推送的「假实现」也从各自的 `testing.ts` 导出（第 7 节）。
- 断言数据库状态时，只读被测模块自己的表，并通过该模块 `testing.ts` 导出的查询工具进行。
- 实现：运维在 T-015 把 R1 扩展到 `apps/server/test/**`，并允许 `testing.ts` 作为出口。
- **装配入口**（总负责人裁定，T-020 同步）：集成测试需要启动整个应用时，可以 import `src/app.module.ts`、`src/main.ts`（只此两个；扩展名省略也识别）。这两个文件只负责「把模块装起来」，不含业务逻辑，引用它们不会让测试依赖模块内部。识别扩展名省略后，业务模块 import 不带扩展名的 `app.module` 也会被 R2 拦下（T-015 顺带修正了此前的漏检）。
- `testing.ts` 是给测试用的第二出口：生产代码（任何非测试文件）import 任何模块的 `testing.ts`（含本模块的）都报错；测试文件（集成测试、模块目录内的单元测试）可以引用其他模块的 `testing.ts`。

### 3.3 AI 评测不直连模型（R4 范围，QA 建议 4）

- `packages/ai-evals` 只放评测用例、评分细则和评分逻辑，**不 import 供应商 SDK、不出现供应商域名**（R4 扩展到该目录）。
- 评测要调用被测模型和评审模型时，一律经服务器的模型网关（`ModelGatewayPort`，用途 `admin_eval`，计费账户 `platform`）。这与 AI 方案一致：`docs/ai/eval-plan.md` 规定评测和评审费用记平台账户，而只有经网关调用才会冻结、结算、记用量，平台每日上限也才生效。
- 推荐入口：服务器内的命令行脚本（例如 `apps/server/src/cli/run-evals.ts`）启动平台内核与 model-access，读取 `packages/ai-evals` 的用例逐条调用网关；或在 L2 前由 AI 负责人提出「管理后台评测接口」的契约变更申请。具体选哪种由 AI 负责人建工程时决定，两种都满足本规则。

### 3.4 服务器代码约定（ADR-0015，T-020）

平台内核怎么用见 `docs/backend/kernel.md`（后端维护）；这里只列**必须**遵守、违反即验收不通过的几条：

1. **依赖注入一律显式 `@Inject(令牌)`**：构造函数的每个参数都写 `@Inject(TOKEN)`，令牌是提供方模块 `index.ts` 导出的 `Symbol`。`tsconfig` 只开 `experimentalDecorators`，**不开** `emitDecoratorMetadata`（开发用 tsx、生产用 esbuild、测试用 Vitest 都不生成装饰器元数据，靠参数类型自动注入会在某种运行方式下悄悄失败）。
2. **事件订阅者必须幂等、必须快**：分发器把订阅者和收件箱记录放在同一事务里执行，重复投递只生效一次；订阅者里只做数据库写入，目标 1 秒内完成，模型调用、发推送、批量处理等耗时工作转成 pg-boss 任务（队列名 `模块.动作`）。连续失败 10 次的事件被标记 `dead_at`，需要人工处理。
3. **服务器启动不自动迁移**：部署时先执行迁移命令，再启动新版本（运维写进操作手册）。迁移必须兼容上一版代码（先加列再使用；删列分两次发布）。
4. **生产运行方式**：`pnpm --filter @weiban/server build` 打包（esbuild，契约一起打进去），`node dist/main.js` 运行；不需要先构建契约包，也不使用导入条件 `weiban-dist`。

## 4. 接口与错误

1. HTTP 接口统一前缀 `/api/v1`。成功返回业务对象；失败返回统一格式（定义在 `contracts/src/common.ts` 的 `ApiError`）：
   `{"error": {"code": "contact_limit_reached", "message": "通讯录已满", "requestId": "..."}}`
2. HTTP 状态码：400 参数错、401 未登录、403 无权限或被硬性边界拒绝、404 不存在、409 冲突（重复、需要选择）、410 同步游标过期、422 业务校验失败、429 频率限制、500 服务器错误、503 依赖不可用。
   - **客户端判断「登录已失效、需要退出」只看错误码 `unauthenticated`**（T-024），不只看 HTTP 401。登录接口密码错是 401 `invalid_credentials`（此时本来就没登录）；已登录后需要**再次输入密码**的操作（目前只有注销 `DELETE /me`）密码错返回 **403 `invalid_credentials`**：会话仍然有效，客户端提示「密码错误」即可，不退出登录。以后新增「再次输入密码」的接口沿用同一做法，不新增错误码。
3. 所有「创建」类请求必须支持**幂等**：客户端带 `clientMsgId` / `Idempotency-Key`，重复请求返回同一结果，不重复创建。
4. 接口变更流程：在任务卡或交接说明中写「契约变更申请」（改什么、为什么、影响谁）→ 架构负责人批准 → 架构负责人改 `packages/contracts` → 实现方再改代码。不兼容的改动要升级 `CONTRACT_VERSION` 主版本。

## 5. 数据库

1. 每个模块用 Drizzle 的 `pgSchema('模块名')` 定义自己的表；**禁止跨 schema 外键和跨 schema JOIN**。
2. 主键统一使用 **UUIDv7**（按时间递增的全局唯一 ID，存为 `uuid` 类型）。
3. 时间统一 `timestamptz`，存 UTC。「用户当地日期」类字段（生日、认识日期）用 `date`。
4. 迁移文件由 drizzle-kit 生成，放 `apps/server/drizzle/`，**只增不改**：已合并到 `main` 的迁移文件禁止修改，要改就新增一个迁移（执行器按校验和拦下被改动的已执行迁移）。**每个迁移必须同时提交手写的回滚脚本** `NNNN_名字.down.sql`（ADR-0015；缺少时执行器拒绝执行，测试也会检查），并通过「执行 → 回滚 → 再执行」测试。回滚脚本不参与校验和，发现写错可以经评审修正。生产环境出问题优先用新迁移向前修复；会删除已有数据的回滚，执行前必须先备份数据库。
5. 删除策略：用户可恢复的删除（如角色 30 天恢复）用 `deleted_at` 软删除，到期由定时任务物理删除；注销账号必须物理删除（见 `security-and-privacy.md`）。
6. 每个模块的表结构在其模块负责人的交接说明中列出（表、主要字段、索引、谁写谁读）。
7. **钱一律用整数「微元」**（1 元 = 1,000,000 微元，数据库 `bigint`，接口字段名以 `Micros` 结尾），禁止用浮点数存储或计算金额；换算成「元」只在显示时进行（`billing.md`）。
8. 流水表 `billing.ledger_entries` 只增不改：应用数据库账号对它没有 UPDATE / DELETE 权限（注销删除由专用删除函数执行）。

## 6. 日志与可观测

1. 使用结构化日志（pino，JSON 一行一条），每条带 `requestId` / `jobId` / `eventId`、`module`、`userId`（不写昵称等资料）。
2. **禁止在日志中出现**：密钥、会话令牌、密码、聊天正文、记忆正文、导入原文、模型请求与回复全文。日志器内置脱敏规则（见 `security-and-privacy.md` 第 4 节），但不能依赖它兜底，写日志时就不要传这些字段。
3. 每次模型调用记录用量（`model_access.usage_records`）：用途、模型、输入输出 token、耗时、计费账户、扣费流水 ID、结果（成功 / 错误类型）。这是数据，不是日志，不含正文。
4. 调试需要看模型请求全文时，只允许在开发环境用环境变量 `DEBUG_LLM_PAYLOAD=1` 打开，生产环境该开关被代码强制忽略。

## 7. 测试要求

| 层级 | 工具 | 要求 |
|---|---|---|
| 单元测试 | Vitest | `domain/` 下的纯规则 **必须** 有测试；`policy` 模块的每条判定规则 **必须** 有正反两面测试 |
| 集成测试 | Vitest + 真实 PostgreSQL（Docker 里的测试库） | 每个 HTTP 接口至少一条成功路径 + 一条失败路径；每个事件订阅者有「重复投递不产生重复效果」的测试 |
| 契约测试 | Vitest | 服务器返回的数据必须能通过 contracts 中对应 schema 的校验（在集成测试里统一断言） |
| 可靠性场景测试 | Vitest（服务端）+ Playwright（客户端） | CHAT-03 的 4 条验收场景写成自动化测试（见 `message-reliability.md` 第 8 节） |
| 端到端 | Playwright | 每层（L0～L6）至少覆盖该层「完成后能试用什么」的主流程 |
| AI 评测 | AI 负责人的评测集 | 见 `docs/ai/`（T-005） |

其他规则：
- 测试不能依赖真实模型供应商和真实推送通道：模型网关和推送通道都有「假实现」（fake），由各自模块提供。
- 涉及时间的测试用平台时钟拨时间，**禁止**在测试里真的等待（sleep）。
- 测试数据中出现的「密钥」统一使用金丝雀值（形如 `sk-weiban-canary-...`），用于泄露检查（见 `security-and-privacy.md`）。
- 网页和安卓的同步引擎都必须通过 `packages/contracts/test-vectors/` 的协议用例（`message-reliability.md` 第 11 节）。
- 计费：每个结算 / 解冻路径都要有「重复调用不重复扣费」的测试；对账任务要有「人为制造不一致能被发现」的测试。
- 新功能合并前 `pnpm lint && pnpm typecheck && pnpm test` 必须全绿；CI 跑同样的命令。

## 8. 网页前端额外规则

性能规则以 ADR-0001 第 5 条和 Web 负责人的职责为准（虚拟滚动、只用 transform/opacity 做动画、大图懒加载），这里只补充数据层规则：
1. 所有服务器数据先写入本地 IndexedDB，界面从本地读（「本地优先」），这样断网也能看历史。
2. 发出的消息先进本地发件队列，拿到服务器 `ack` 才标记已送达（见 `message-reliability.md`）。
3. 会话令牌存 IndexedDB，不放 URL、不放 `localStorage`；网页启用严格的内容安全策略（CSP），禁止内联脚本和第三方脚本，降低令牌被恶意脚本偷走的风险。用户端没有任何模型密钥；管理后台录入的平台上游密钥只在登记请求中经 HTTPS 发送一次，页面不保存。

## 9. 依赖管理

- 新增第三方依赖需在交接说明中列出（名称、用途、许可证）。只用 MIT / Apache-2.0 / BSD / ISC 等宽松许可证；AGPL 等需架构负责人批准。
- 依赖版本由 `pnpm-lock.yaml` 锁定；安卓依赖由 `gradle/libs.versions.toml` 集中管理并提交 Gradle 锁文件。

## 10. 安卓原生客户端规则（T-009 新增，ADR-0011）

1. Kotlin，开启全部编译警告视为错误（`allWarningsAsErrors`）；格式与静态检查用 ktlint + detekt（具体配置由 Android 负责人在骨架任务中定，CI 必跑）。
2. **接口类型只能来自 `core/contracts-generated/`**（由契约生成），禁止手写与服务器交互的数据类（对应 R6）。
3. 数据层与网页同规则：本地优先（Room）、发件队列串行发送且复用 `clientMsgId`、`updateSeq` 补拉、会话级缺口自检；必须通过协议用例。
4. 界面颜色、字号、间距只用由 `docs/design/tokens.json` 生成的令牌常量；主题的渲染（换哪套令牌）在客户端完成。**主题的选择（`green` 默认 / `pink` 微伴粉）跟着账号走、所有设备同步**（PRD SVC-01 第 7 条，T-014 起）：读写 `GET/PATCH /api/v1/me/preferences`，收到 `settings.updated(section = preferences)` 后重新拉取；深色模式、字体大小仍是每台设备自己的设置，不经服务器。网页端同样适用。
5. 推送 SDK、通话、前台服务只出现在 `platform/` 包内（对应服务器的 R5 精神）。
6. 日志：不写令牌、聊天正文、个人资料；发布包关闭调试日志。
7. 测试：同步引擎与协议用例用 JUnit（JVM 上跑，不需要真机）；界面关键流程用 Compose UI 测试；每层验收前在至少一台国产品牌真机上手测推送与保活（Android 负责人记录机型）。
