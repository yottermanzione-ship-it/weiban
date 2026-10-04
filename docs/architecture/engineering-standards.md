# 工程规范

> 负责人：架构负责人 · v1.1 · 2026-10-04 · 来源任务：T-004，T-009 修订（R9、金额规则、安卓第 10 节）
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

PRD 参数（P-01～P-30）在代码中**只在一个文件**里映射：`apps/server/src/platform/config/product-params.ts`，常量名带编号，如 `P03_PROACTIVE_PER_CHARACTER_PER_DAY = 3`，注释写明「来源：PRD 第 5 节 P-03」。PRD 改数字时只改这个文件。

## 3. 模块边界规则（CI 强制）

依据 ADR-0004，由运维在 `packages/eslint-config` 中用 `eslint-plugin-boundaries`（或 `dependency-cruiser`）实现：

| 规则 | 允许 | 禁止 |
|---|---|---|
| R1 公开出口 | `import { X } from '../chat'` | `import ... from '../chat/infra/db/schema'` |
| R2 层级方向 | 上层 → 中层 → 底层 → platform | 下层 import 上层 |
| R3 聊天不依赖 AI | — | `modules/chat/**` 出现任何对 `modules/ai-runtime` 的 import |
| R4 模型出口唯一 | 只有 `modules/model-access/**` 可以 import 供应商 SDK 或向供应商域名发请求 | 其他模块直接调用模型 API |
| R5 推送出口唯一 | 只有 `modules/push/**` 可以 import 推送 SDK | 其他模块直接发推送 |
| R6 契约来源 | 前后端接口类型只从 `@weiban/contracts` 导入 | 在 web / server 里另写一份接口类型 |
| R7 时间 | 使用 `platform/clock` | 业务代码直接 `new Date()` / `Date.now()`（平台内核和测试除外） |
| R8 数据表 | 模块只访问自己 `pgSchema` 下的表 | 原生 SQL 里出现别的 schema 名 |
| R9 扣费出口唯一（T-009） | 只有 `modules/model-access/**` 调用 `BillingPort.estimateAndReserve / settle / release`；其他模块只能读 `getSpendStatus` | 其他模块自行冻结、扣费或改余额 |

## 4. 接口与错误

1. HTTP 接口统一前缀 `/api/v1`。成功返回业务对象；失败返回统一格式（定义在 `contracts/src/common.ts` 的 `ApiError`）：
   `{"error": {"code": "contact_limit_reached", "message": "通讯录已满", "requestId": "..."}}`
2. HTTP 状态码：400 参数错、401 未登录、403 无权限或被硬性边界拒绝、404 不存在、409 冲突（重复、需要选择）、410 同步游标过期、422 业务校验失败、429 频率限制、500 服务器错误、503 依赖不可用。
3. 所有「创建」类请求必须支持**幂等**：客户端带 `clientMsgId` / `Idempotency-Key`，重复请求返回同一结果，不重复创建。
4. 接口变更流程：在任务卡或交接说明中写「契约变更申请」（改什么、为什么、影响谁）→ 架构负责人批准 → 架构负责人改 `packages/contracts` → 实现方再改代码。不兼容的改动要升级 `CONTRACT_VERSION` 主版本。

## 5. 数据库

1. 每个模块用 Drizzle 的 `pgSchema('模块名')` 定义自己的表；**禁止跨 schema 外键和跨 schema JOIN**。
2. 主键统一使用 **UUIDv7**（按时间递增的全局唯一 ID，存为 `uuid` 类型）。
3. 时间统一 `timestamptz`，存 UTC。「用户当地日期」类字段（生日、认识日期）用 `date`。
4. 迁移文件由 drizzle-kit 生成，放 `apps/server/drizzle/`，**只增不改**：已合并到 `main` 的迁移文件禁止修改，要改就新增一个迁移。
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
4. 界面颜色、字号、间距只用由 `docs/design/tokens.json` 生成的令牌常量；主题（默认微信风格 / 微伴粉等）只在客户端切换，不影响接口。
5. 推送 SDK、通话、前台服务只出现在 `platform/` 包内（对应服务器的 R5 精神）。
6. 日志：不写令牌、聊天正文、个人资料；发布包关闭调试日志。
7. 测试：同步引擎与协议用例用 JUnit（JVM 上跑，不需要真机）；界面关键流程用 Compose UI 测试；每层验收前在至少一台国产品牌真机上手测推送与保活（Android 负责人记录机型）。
