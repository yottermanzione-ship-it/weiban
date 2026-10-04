# apps/server · 服务器（占位）

- 负责人：后端负责人（`src/modules/ai-runtime/` 归 AI 负责人）
- 技术：Node.js 24 + NestJS 11，模块化单体（ADR-0003、ADR-0004）
- 内部结构：见 `docs/architecture/repo-structure.md` 第 3 节
- 由 D-L0-05（服务器平台内核）建立工程：届时新增 `package.json`（名称 `@weiban/server`）、`tsconfig.json`（extends `@weiban/tsconfig/node.json`）、`vitest.config.ts`（用 `defineProject`），根目录的 `pnpm lint / typecheck / test` 会自动包含它。

模块边界规则 R1～R9 已在 `packages/eslint-config` 中按 `apps/server/src/modules/<模块名>/` 的路径约定生效，新增模块目录前先在 `packages/eslint-config/architecture.js` 登记层级（否则 lint 报错）。
