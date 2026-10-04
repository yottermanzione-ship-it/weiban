# ADR-0003 技术选型

| 项 | 内容 |
|---|---|
| 状态 | 已采纳；安卓壳（Capacitor）一项被 ADR-0010 推翻，由 **ADR-0011**（Kotlin + Jetpack Compose 原生客户端）取代；pnpm 版本基线于 T-009 改为 11（见「版本基线」） |
| 日期 | 2026-10-04 |
| 提出人 | 架构负责人（T-004） |
| 批准人 | 架构负责人 |

## 背景

要定下微伴的技术底座，让后端、Web、Android、运维能开工。约束（来自 ADR-0001、ADR-0002、T-004 任务卡）：

1. 总经理技术基础弱，代码主要由 AI 负责人编写：技术要**主流、资料多、AI 熟悉**，**语言种类越少越好**。
2. 开发机 Windows 11；生产是**香港单机云服务器 + Docker**。
3. Android 原生壳 + WebView 复用 Web 界面；iOS 走 PWA（可安装到主屏幕的网页应用）。
4. 模块化单体：一个程序，内部模块严格分开；消息是唯一事实来源。
5. 推演、主动消息、延迟回复都是**定时任务**，服务器重启不能丢。
6. 实际只有 1 个用户（总经理），按成熟产品设计。性能不是瓶颈，**可靠性和简单**才是。

## 结论一览（先看这张表）

| 项 | 选择 | 一句话理由 |
|---|---|---|
| 编程语言 | **TypeScript**（服务器、网页、管理后台、契约同一种语言）；安卓原生客户端用 **Kotlin**（T-009 修订，见 ADR-0011） | 一种语言贯穿服务器与网页，类型共享，AI 最熟；安卓按总经理决定做原生 |
| 前端 | **React 19 + Vite + vite-plugin-pwa**，本地数据库 IndexedDB（Dexie），虚拟滚动 react-virtuoso | 资料最多；PWA 插件成熟；聊天场景的虚拟列表现成 |
| 后端 | **Node.js 24 LTS + NestJS 11** | NestJS 自带「模块」概念，天然适合模块化单体 |
| 数据库 | **PostgreSQL 18**（含 pgvector 扩展），ORM 用 **Drizzle**；每个模块一个独立 schema | 一个数据库同时承担业务数据、任务队列、事件发件箱、向量检索，少一个组件少一份运维 |
| 实时通信 | **原生 WebSocket（ws 库）+ 自定义协议**；可靠性靠「递增序号 + 补拉」而不是靠连接 | 协议简单透明，浏览器、iPhone PWA、安卓原生（OkHttp）都原生支持 |
| 任务调度 | **pg-boss**（基于 PostgreSQL 的持久化任务队列，支持延迟、定时、重试、防抖） | 不引入 Redis；任务和业务数据在同一数据库，重启不丢 |
| 对象存储 | **自写存储接口，两个实现**：开发用本机磁盘；生产用云厂商的 **S3 兼容对象存储**（香港区域，厂商由运维选） | 文件不和单机服务器同生死；**不用 MinIO**（社区版 2026 年已停止维护） |
| Android 客户端 | ~~Capacitor 8 壳~~ → **Kotlin + Jetpack Compose 原生客户端**（ADR-0011） | 总经理要求原生体验（ADR-0010） |
| 部署 | **Docker Compose 单机**：`caddy`（自动 HTTPS）+ `app`（一个 Node 进程）+ `postgres` | 一条命令启动；HTTPS 证书自动申请续期 |
| 契约格式 | **Zod 4（TypeScript 校验库）为唯一源头**，自动导出 JSON Schema / OpenAPI 文档 | 同一份定义既是类型、又是运行时校验、又能生成文档 |
| 包管理与仓库 | **pnpm workspace monorepo**（一个仓库多个子项目） | 前后端、契约、管理后台共享代码最方便 |
| 测试 | **Vitest**（单元 / 集成）、**Playwright**（网页端到端） | 与 Vite 同源，配置最少 |

术语：
- **ORM**：让代码用对象方式读写数据库的工具。Drizzle 的写法接近 SQL，生成的 SQL 一眼能看懂。
- **schema**（数据库里的）：数据库内的「文件夹」。每个模块的表放在自己的 schema 里，方便检查有没有越界。
- **pgvector**：PostgreSQL 的向量检索扩展，AI 记忆可能需要按「语义相近」查找，提前备好。
- **任务队列**：把「5 秒后发这条气泡」「每天 6 点推演」这类要以后做的事记进数据库，到点由程序取出来执行。

## 方案对比

### 1. 语言

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 全栈 TypeScript**（选） | 一种语言；前后端共享类型和契约；AI 编写质量高；npm 生态覆盖所有需求 | 重 CPU 计算不如 Go/Java（本项目没有） |
| B. 后端 Python + 前端 TS | Python 的 AI 生态强 | 两种语言、两套工具链；契约要跨语言生成；我们只调用模型 API，用不到 Python 专属能力 |
| C. 后端 Go / Java | 性能和类型强 | 两种语言；对 1 个用户的系统没有收益 |

### 2. 前端

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. React + Vite**（选） | 资料和组件最多；AI 最熟；虚拟滚动、PWA 方案成熟 | 需要自己选状态管理（定为 Zustand + TanStack Query） |
| B. Vue 3 + Vite | 国内资料多、上手容易 | 生态略小；与 B 端组件库绑定更深 |
| C. Svelte | 包体积小 | 资料少，AI 出错多 |

### 3. 后端框架

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. NestJS**（选） | 内置模块、依赖注入、守卫（权限检查）、WebSocket 网关；结构统一，AI 写出来的代码风格一致 | 装饰器写法偏重；学习曲线比 Express 高一点 |
| B. Fastify / Express 裸写 | 轻、自由 | 模块边界全靠自觉，AI 多人协作容易写散 |
| C. tRPC / Hono | 类型体验好 | 生态较小；WebSocket、任务调度要另配 |

### 4. 数据库与 ORM

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. PostgreSQL + Drizzle**（选） | 事务可靠；一个库同时做业务数据、任务队列、事件发件箱、全文与向量检索；Drizzle 原生支持多 schema，SQL 透明 | Drizzle 比 Prisma 年轻一些 |
| B. PostgreSQL + Prisma | 资料最多 | 多 schema 支持较晚才稳定；生成的 SQL 不透明；有额外的查询引擎 |
| C. MySQL | 国内常见 | 缺少 pgvector、可靠的 SKIP LOCKED 队列生态（pg-boss） |
| D. MongoDB | 灵活 | 消息顺序、事务、约束都要自己保证，违背「消息可靠优先」 |

### 5. 实时通信

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 原生 WebSocket + 自定义帧协议**（选） | 浏览器、WebView、PWA 都原生支持；协议在契约里一目了然 | 断线重连、心跳要自己写（几十行） |
| B. Socket.IO | 自带重连和房间 | 自有协议层，排查问题多一层；它的「送达确认」不能替代业务层的序号补拉 |
| C. SSE（服务器单向推送）+ HTTP 发送 | 最简单 | 「正在输入」等双向实时信号别扭 |

不论选哪种，**可靠性都不依赖连接本身**：连接只是「快递车」，丢了就按序号补拉（见 ADR-0005）。

### 6. 任务调度（推演、主动消息、延迟回复、重试）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. pg-boss**（选） | 任务存在 PostgreSQL，重启不丢；支持延迟执行、cron 定时、重试、单例与防抖（`sendDebounced`，正好实现「用户连发多条后 3 秒统一回复」）；可以和业务写入放在同一事务 | 吞吐量不如 Redis 队列（本项目远用不完） |
| B. BullMQ + Redis | 最流行的 Node 队列 | 多一个 Redis 要部署、备份；任务和业务数据不在一个事务里 |
| C. node-cron / setTimeout | 最简单 | 进程重启任务全丢，违背 CHAT-03 |

### 7. 对象存储（头像、图片、语音、表情包）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 存储接口 + 本机磁盘（开发）/ 云 S3 兼容对象存储（生产）**（选） | 生产文件存在云上，服务器坏了文件还在，备份压力小；开发机零依赖 | 生产有少量存储费用；需要运维开一个存储桶 |
| B. 自建 MinIO | 曾经的标准自建方案 | 社区版 2025 年起停发镜像，2026 年仓库已归档、不再维护，不适合新项目 |
| C. 只存本机磁盘 | 最简单 | 文件和单机服务器同生死，备份恢复更复杂 |

### 8. Android 壳（已被 ADR-0011 取代，以下保留作历史）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. Capacitor 8**（选） | 官方维护的「原生壳 + WebView」框架；推送、本地通知、分享、文件、状态栏等有现成插件；需要原生的部分（全屏来电、前台服务、厂商推送）写 Kotlin 插件 | 多一层框架；需要了解它的插件机制 |
| B. 手写 Kotlin + WebView | 完全掌控 | 桥接、推送、文件选择、权限等全部从零写，Kotlin 代码量大，违背「少语言」 |
| C. React Native / Flutter | 原生体验好 | 要重写界面，违背 ADR-0001「复用 Web 页面」 |

网页资源**打包进 APK**（Capacitor 默认方式），好处是断网也能打开、看到本地聊天记录；代价是网页更新要重新打包 APK（由 CI 自动打包，见代价）。

### 9. 部署

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. Docker Compose 单机**（选） | 一份配置文件描述全部服务；与 ADR-0001 一致；可脚本化重建 | 无高可用（ADR-0001 已接受） |
| B. Kubernetes | 可扩展 | 对单机单用户是巨大浪费 |
| C. 直接在服务器装 Node / Postgres | 少一层 | 环境难复现，违背运维「一切可用脚本重建」 |

反向代理选 **Caddy**（自动申请和续期 HTTPS 证书，配置几行）而不是 Nginx。

### 10. 契约格式

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. Zod 4 schema 为源头**（选） | TypeScript 类型 + 运行时校验 + JSON Schema（Zod 4 内置导出）一份定义三用；前后端直接 import | 非 TS 端（Android Kotlin）只能读导出的 JSON Schema |
| B. 手写 OpenAPI YAML | 语言无关、标准 | 还要再生成 TS 类型；YAML 冗长；WebSocket 和内部事件描述不了 |
| C. Protobuf / gRPC | 强类型、高效 | 浏览器支持差，调试不直观 |

## 版本基线

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | 24 LTS | 支持到 2028-04；Node 26 进入 LTS 后由运维评估升级 |
| TypeScript | 5.x，`strict: true` | |
| PostgreSQL | 18 + pgvector | |
| NestJS | 11 | |
| React | 19 | |
| ~~Capacitor~~ | ~~8~~ | 已取消（ADR-0011） |
| Android | Kotlin 2.x + Jetpack Compose（Compose BOM 由 Android 负责人锁定），minSdk 26，targetSdk 36 | ADR-0011 |
| Zod | 4 | |
| pnpm | **11**（T-009 修订，原为 10） | 见下方说明 |

**pnpm 选 11 的理由**（T-007 交接提出，T-009 决定）：
- pnpm 10 的支持期到 2027-04-30，正好落在开发期内，届时还要再迁移一次；
- pnpm 12 是 2026-08-26 发布的 Rust 重写版，刚满一个多月，新实现的隐藏问题还没充分暴露；它**沿用 pnpm 11 的命令、配置、锁文件格式**，所以从 11 升到 12 以后几乎没有迁移成本；
- pnpm 11 要求 Node 22+，与我们的 Node 24 一致；默认开启供应链防护（新发布的包默认等 1 天才安装）。
- 写法影响（交给运维 D-L0-01）：除认证和镜像源地址外的设置写进 `pnpm-workspace.yaml`，不写 `.npmrc`；根 `package.json` 用 `devEngines.packageManager` 锁定 pnpm 11.x；安装命令 `npm install -g pnpm@11`。
- 何时升 12：12.x 发布满 3 个月、主要工具（CI 的 setup 动作、Docker 镜像）支持后，由运维评估，按 ADR-0003 版本基线流程修改。

具体小版本由运维在搭建骨架时锁定（lockfile）。

## 代价

- ~~Kotlin 无法完全避免~~ / ~~网页打包进 APK~~：随 ADR-0011 失效。安卓改为 Kotlin 原生客户端，代价见 ADR-0011；客户端过旧时仍用契约中的 `minClientVersion` 提示更新。
- **不用 Redis**：所有队列、事件、限流都压在 PostgreSQL 上。1 个用户毫无压力；若将来用户数上千，再评估引入 Redis。
- **生产对象存储依赖云厂商**：有少量费用，且换厂商需要迁移文件。用 S3 兼容接口降低迁移成本。
- **Node 单进程同时跑接口和任务**：一个慢任务理论上会拖慢接口。模型调用都是网络等待，不占 CPU，风险低；代码支持按环境变量拆成 `web` / `worker` 两个进程（同一镜像），需要时再拆。
- **Drizzle 相对年轻**：如遇严重缺陷，迁移到 Kysely（同为 SQL 风格）成本可控。

需要重新评估的情况：开放给他人使用、用户数显著增长、或 pg-boss 停止维护。

## 参考（T-009 补充）

- pnpm 11 发布说明（要求 Node 22+、默认供应链防护）：https://pnpm.io/blog/releases/11.0
- pnpm 12 Rust 重写版（2026-08-26 发布，沿用 11 的配置与锁文件）：https://socket.dev/blog/pnpm-12 、https://infoq.com/news/2026/09/pnpm-12-rust
- pnpm 10 支持期（至 2027-04-30）：https://endoflife.ai/pnpm/10

## 参考

- MinIO 社区版停止维护：https://glukhov.org/data-infrastructure/object-storage/minio-dead/
- pg-boss 防抖任务：https://deepwiki.com/timgit/pg-boss/12.2-debouncing-jobs
- Node.js 24 LTS 周期：https://endoflife.ai/article-nodejs-eol.html
- Capacitor 8 升级说明（minSdk 24、targetSdk 36）：https://capawesome.io/blog/how-to-upgrade-your-capacitor-plugin-to-capacitor-8/
