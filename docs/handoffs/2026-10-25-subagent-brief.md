# 微伴 · 子代理统一业务说明（分发时随任务一起给出）

## 产品是什么

微伴是一个「让 AI 角色像真人一样存在于社交软件里」的网页应用：界面与微信高度相似（会话列表、通讯录、发现、我、朋友圈、群聊、语音、表情、角色广场）。用户和角色私聊、群聊、发朋友圈、听角色语音。角色来自旧版 App 迁移，保留原始角色卡格式（`legacy_card`），不要把它们改写成新版卡片结构。

## 代码在哪

- 工作目录：`C:\wb-dev\wb-client-logs`，分支 `codex/voice-v02-v06-20261024`。
- pnpm monorepo：
  - 前端 `apps/web`（React 18 + Vite，移动端优先，视口常见 349×756；PWA）。
  - 后端 `apps/server`（NestJS + Drizzle + PostgreSQL）。
  - 契约 `packages/contracts`（zod 定义接口；改字段必须同步契约）。
  - 客户端基础设施 `packages/client-core`（ApiClient、IndexedDB 本地存储）。
  - 后台 `apps/admin`（只在明确要求时改）。
- node：`C:/Users/lomjy3/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe`
- pnpm：`C:/Users/lomjy3/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs`（用上面的 node 执行该文件；在 PowerShell 里若把 pnpm 的提示行当错误，可用 `cmd /c` 取真实退出码）

## 界面风格约束

- 以微信为准：克制、留白、灰底白卡、绿点缀；不要引入新的视觉体系。
- 颜色、圆角、间距、字号、阴影一律用设计令牌（`--wb-color-*`、`--wb-radius-*`、`--wb-space-*`、`--wb-font-*`、`--wb-shadow-*`），不写死颜色；暗色模式不能崩。
- 动画只用 `transform` / `opacity`，时长用令牌；尊重 `prefers-reduced-motion`。
- 点击区域不小于 44×44（视觉可以更小）。

## 已知的近期改动（避免重复修）

- `packages/client-core/src/api-client.ts`：新增同步内存缓存 `peek()`、GET 并发合并、按账号清空。
- `apps/web/src/data/use-remote.ts`、`character-profile.ts`：首帧用缓存、60 秒新鲜期。
- `apps/web/src/features/avatar-cache.tsx`：媒体链接按 mediaId 复用、按账号隔离、有上限。
- `apps/web/src/features/media.tsx`：语音气泡改用内联 SVG 画的圆点 + 三段弧。
- `apps/web/src/features/role-plaza.tsx` / `plaza.tsx` / `app/plaza.css`：广场 tab 与筛选弹层重做。
- `apps/server/src/modules/policy/application/policy.ts`：空白名单表示「不限制」。
- `apps/web/src/app/chat-old.css`：群自定义头像 `!` 必须铺满方框（已修，别再退回旧写法）。

## 每次任务的硬性纪律

1. 只改任务指定的文件范围；发现必须动别的文件，先在报告里说明原因，不要顺手重构。
2. 不执行 `git commit` / `git push` / 构建镜像 / 部署 / `docker` / 安装依赖 / 跑全量测试。
3. 检查只跑一次与改动直接相关的类型检查或单个测试文件（`pnpm --filter @weiban/web typecheck`、`pnpm --filter @weiban/server typecheck`、或指定 `vitest run <file>`）；失败只修相关错误，最多复测一次。
4. 不碰生产数据库、不改迁移脚本、不改 `docs/`。
5. 结果必须结构化：根因、改动文件、关键改动、跑的检查与结果、残留风险。

## 输出格式（schema）

`{ rootCause, filesChanged[], changeSummary, check, checkResult, risks }`
