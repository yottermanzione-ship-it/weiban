# 仓库目录结构（monorepo）

> 负责人：架构负责人 · v1.1 · 2026-10-04 · 来源任务：T-004，T-009 修订（安卓原生客户端）
> 技术选型见 `docs/decisions/ADR-0003-tech-stack.md`、安卓见 `ADR-0011`。

## 1. 一句话

**一个 git 仓库装下全部代码**（monorepo，「单一仓库」）：服务器、网页、管理后台、安卓原生客户端、接口契约各是一个子项目。TypeScript 子项目用 pnpm workspace（pnpm 的「工作区」功能）串起来，可以直接互相引用；安卓是独立的 Gradle 工程，只通过「契约导出的 JSON Schema → 生成 Kotlin 代码」与其他部分连接。

## 2. 目录总览

```
weiban/
├─ apps/                          可运行的程序
│  ├─ server/                     服务器：NestJS 模块化单体          负责人：后端（ai-runtime 目录归 AI）
│  ├─ web/                        用户端网页 / PWA（iPhone、电脑浏览器）负责人：Web
│  ├─ admin/                      管理后台网页                        负责人：Web
│  └─ android/                    安卓原生客户端（Kotlin + Compose，Gradle 工程，不属于 pnpm 工作区）负责人：Android
├─ packages/                      被多个程序共享的代码
│  ├─ contracts/                  接口与事件契约（唯一准绳）；test-vectors/ 同步协议用例  负责人：架构
│  ├─ ai-evals/                   AI 评测集用例与运行器（见 docs/ai/eval-plan.md） 负责人：AI
│  ├─ tsconfig/                   共享 TypeScript 配置                负责人：运维
│  └─ eslint-config/              共享代码检查规则（含模块边界规则）    负责人：运维（规则内容由架构定）
├─ deploy/                        Docker、Compose、Caddy、备份脚本     负责人：运维
├─ scripts/                       开发辅助脚本（生成契约文档、造测试数据等）
├─ docs/                          文档（见 docs/README.md）
├─ package.json                   根：只放工作区脚本，不放业务依赖
├─ pnpm-workspace.yaml
├─ .nvmrc                         锁定 Node 版本
└─ .gitignore / .gitattributes
```

以后如果网页和管理后台需要共享界面组件，再新增 `packages/ui/`（由 Web 负责人提出）。设计令牌的源头是 `docs/design/tokens.json`（设计负责人维护），Web 构建时读取它，不在代码里另抄一份。

## 3. 服务器内部结构 `apps/server`

```
apps/server/
├─ src/
│  ├─ main.ts                     启动入口（按 APP_ROLE 决定启动 HTTP / 任务 / 全部）
│  ├─ app.module.ts               把所有模块装配起来（唯一允许 import 所有模块的地方）
│  ├─ platform/                   平台内核（所有模块都可使用）
│  │  ├─ config/                  环境变量读取与校验；product-params.ts（PRD 第 5 节参数的代码映射）
│  │  ├─ db/                      数据库连接、事务工具、迁移执行
│  │  ├─ events/                  发件箱、分发器、幂等收件箱
│  │  ├─ jobs/                    pg-boss 封装
│  │  ├─ logging/                 结构化日志 + 脱敏
│  │  ├─ crypto/                  信封加密工具
│  │  ├─ auth/                    会话鉴权守卫、管理员守卫
│  │  ├─ clock/                   可替换的时钟（测试可拨时间）
│  │  └─ http/                    统一错误格式、请求 ID、契约校验管道
│  └─ modules/
│     ├─ identity/
│     ├─ realtime/
│     ├─ push/
│     ├─ media/
│     ├─ model-access/
│     ├─ billing/
│     ├─ characters/
│     ├─ contacts/
│     ├─ chat/
│     ├─ policy/
│     ├─ ai-runtime/              内部结构由 AI 负责人决定
│     ├─ moments/                 （L4）
│     ├─ growth/                  （L3）
│     ├─ importer/                （L6）
│     └─ library/                 （L6）
├─ drizzle/                       数据库迁移文件（按时间顺序，所有模块共用一条迁移序列）
└─ test/                          跨模块集成测试、端到端场景测试
```

### 每个模块的固定结构

```
modules/chat/
├─ index.ts                 ★ 唯一公开出口：只导出 NestJS 模块类和端口实现的注入令牌
├─ chat.module.ts           NestJS 模块定义
├─ api/                     HTTP 控制器、WebSocket 处理器（只做参数校验和调用 application）
├─ admin/                   管理后台接口（需要管理员身份）
├─ application/             用例：一个文件一件事，例如 send-user-message.ts
├─ domain/                  纯业务规则（不碰数据库、不碰网络，最好测）
├─ infra/
│  ├─ db/schema.ts          本模块的 Drizzle 表定义（pgSchema('chat')）
│  └─ db/repositories/      数据访问
├─ events/                  本模块的事件订阅者
└─ *.test.ts                就近放单元测试
```

规则：别的模块**只能** `import ... from '../chat'`（即 `index.ts`）。import `../chat/infra/...` 或 `../chat/domain/...` 会被 lint 拦下（规则见 `engineering-standards.md` 第 3 节）。

## 4. 网页结构 `apps/web`

```
apps/web/
├─ src/
│  ├─ app/                  路由、全局布局
│  ├─ features/             按功能分：chat/、contacts/、characters/、settings/、onboarding/ ...
│  ├─ data/                 API 客户端（基于 contracts）、WebSocket 客户端、IndexedDB 本地库、发件队列
│  ├─ components/           通用组件（遵循设计体系）
│  └─ sw/                   Service Worker（离线缓存、Web Push 通知点击）
└─ public/                  图标、manifest
```

`apps/admin` 结构相同但更简单（无离线、无推送）。

## 5. 安卓原生客户端结构 `apps/android`（ADR-0011）

标准 Android Studio / Gradle 工程，用 Android Studio 直接打开 `apps/android/` 即可。下面是架构层面的约定，包内细分由 Android 负责人决定并写入 `docs/android/`。

```
apps/android/
├─ settings.gradle.kts / build.gradle.kts / gradle/libs.versions.toml   依赖版本集中管理
├─ app/                          应用入口、导航、依赖装配
├─ core/
│  ├─ contracts-generated/       由契约 JSON Schema 生成的 Kotlin 数据类（★ 不手改，CI 检查重新生成无差异）
│  ├─ network/                   OkHttp（HTTP + WebSocket）、令牌、错误格式
│  ├─ data/                      Room 本地库、同步引擎（发件队列、updateSeq 补拉、会话级缺口自检）、WorkManager 任务
│  ├─ designsystem/              由 docs/design/tokens.json 生成的令牌常量 + 通用组件（★ 令牌不手抄）
│  └─ testvectors/               运行 packages/contracts/test-vectors 用例的 JUnit 运行器
├─ feature/                      按功能分：chat/、contacts/、characters/、me/（含微伴服务）、settings/ ...
└─ platform/                     推送（厂商通道 / 聚合推送）、通知、前台服务、全屏来电、通话
```

规则：
- `feature/*` 只能依赖 `core/*`，不能互相依赖；推送、来电等系统能力只放在 `platform/`。
- 生成代码（契约、设计令牌）的生成脚本放在 `scripts/`，由 Gradle 任务调用（需要本机有 Node，开发环境已安装）。

## 6. 构建产物目录（交接运维补 `.gitignore`）

以下目录由工具自动生成，**不进仓库**。现有 `.gitignore` 已覆盖 `node_modules/`、`dist/`、`build/`、`coverage/`、`.gradle/`、`local.properties`、`*.keystore`、`*.jks`，请运维补充其余项：

| 路径（模式） | 产生者 | 现有 .gitignore 是否覆盖 |
|---|---|---|
| `node_modules/`（各级） | pnpm | 已覆盖 |
| `dist/`（`apps/*/dist`、`packages/*/dist`） | Vite / tsc / Nest 构建 | 已覆盖 |
| `build/` | Android Gradle | 已覆盖 |
| `coverage/` | Vitest 覆盖率 | 已覆盖 |
| `.gradle/` | Gradle 缓存 | 已覆盖 |
| `apps/android/app/release/`、`*.apk`、`*.aab` | 安卓打包输出 | **需新增** |
| `apps/android/.idea/`、`*.iml`、`apps/android/.kotlin/` | Android Studio / Kotlin 编译缓存 | `.idea/` 已覆盖，`*.iml`、`.kotlin/` **需新增** |
| `apps/android/core/contracts-generated/build/` 等生成产物的中间目录 | 生成脚本 | 由 `build/` 覆盖；**生成后的 Kotlin 源码本身要进仓库**（便于评审与 CI 比对） |
| `.pnpm-store/` | pnpm 本地仓库（若配置在项目内） | **需新增** |
| `*.tsbuildinfo` | TypeScript 增量编译 | **需新增** |
| `.turbo/`、`.vite/`、`.cache/` | 构建缓存 | **需新增** |
| `playwright-report/`、`test-results/`、`blob-report/` | Playwright | **需新增** |
| `packages/contracts/generated/` | 契约导出的 JSON Schema / OpenAPI 文件（每次构建重新生成） | **需新增** |
| `apps/server/uploads/`、`.data/` | 开发环境本机对象存储目录 | **需新增** |
| `dev-dist/` | vite-plugin-pwa 开发模式产物 | **需新增** |

`pnpm-lock.yaml` **要进仓库**（锁定依赖版本，保证每台机器装的一样）。
