# 仓库目录结构（monorepo）

> 负责人：架构负责人 · v1.0 · 2026-10-04 · 来源任务：T-004
> 技术选型见 `docs/decisions/ADR-0003-tech-stack.md`。

## 1. 一句话

**一个 git 仓库装下全部代码**（monorepo，「单一仓库」）：服务器、网页、管理后台、安卓壳、接口契约各是一个子项目，用 pnpm workspace（pnpm 的「工作区」功能）串起来，子项目之间可以直接引用。

## 2. 目录总览

```
weiban/
├─ apps/                          可运行的程序
│  ├─ server/                     服务器：NestJS 模块化单体          负责人：后端（ai-runtime 目录归 AI）
│  ├─ web/                        用户端网页 / PWA（安卓壳也加载它）   负责人：Web
│  ├─ admin/                      管理后台网页                        负责人：Web
│  └─ android/                    Capacitor 安卓壳 + Kotlin 原生插件   负责人：Android
├─ packages/                      被多个程序共享的代码
│  ├─ contracts/                  接口与事件契约（唯一准绳）          负责人：架构
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
│  ├─ native/               原生桥封装：安卓壳里调用 Capacitor 插件，浏览器里走网页实现
│  ├─ components/           通用组件（遵循设计体系）
│  └─ sw/                   Service Worker（离线缓存、Web Push 通知点击）
└─ public/                  图标、manifest
```

`apps/admin` 结构相同但更简单（无离线、无推送）。

## 5. 安卓壳结构 `apps/android`

```
apps/android/
├─ capacitor.config.ts      webDir 指向 ../web/dist（网页构建产物打包进 APK）
├─ package.json
└─ android/                 Capacitor 生成的 Android Studio 工程
   └─ app/src/main/java/.../plugins/   自写 Kotlin 插件（厂商推送、全屏来电、通话前台服务）
```

## 6. 构建产物目录（交接运维补 `.gitignore`）

以下目录由工具自动生成，**不进仓库**。现有 `.gitignore` 已覆盖 `node_modules/`、`dist/`、`build/`、`coverage/`、`.gradle/`、`local.properties`、`*.keystore`、`*.jks`，请运维补充其余项：

| 路径（模式） | 产生者 | 现有 .gitignore 是否覆盖 |
|---|---|---|
| `node_modules/`（各级） | pnpm | 已覆盖 |
| `dist/`（`apps/*/dist`、`packages/*/dist`） | Vite / tsc / Nest 构建 | 已覆盖 |
| `build/` | Android Gradle | 已覆盖 |
| `coverage/` | Vitest 覆盖率 | 已覆盖 |
| `.gradle/` | Gradle 缓存 | 已覆盖 |
| `apps/android/android/app/src/main/assets/public/` | `npx cap sync` 复制进来的网页产物 | **需新增** |
| `apps/android/android/capacitor-cordova-android-plugins/` | Capacitor 生成 | **需新增** |
| `apps/android/android/app/release/`、`*.apk`、`*.aab` | 安卓打包输出 | **需新增** |
| `apps/android/android/.idea/`、`*.iml` | Android Studio | `.idea/` 已覆盖，`*.iml` **需新增** |
| `.pnpm-store/` | pnpm 本地仓库（若配置在项目内） | **需新增** |
| `*.tsbuildinfo` | TypeScript 增量编译 | **需新增** |
| `.turbo/`、`.vite/`、`.cache/` | 构建缓存 | **需新增** |
| `playwright-report/`、`test-results/`、`blob-report/` | Playwright | **需新增** |
| `packages/contracts/generated/` | 契约导出的 JSON Schema / OpenAPI 文件（每次构建重新生成） | **需新增** |
| `apps/server/uploads/`、`.data/` | 开发环境本机对象存储目录 | **需新增** |
| `dev-dist/` | vite-plugin-pwa 开发模式产物 | **需新增** |

`pnpm-lock.yaml` **要进仓库**（锁定依赖版本，保证每台机器装的一样）。
