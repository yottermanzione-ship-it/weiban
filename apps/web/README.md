# apps/web · 用户端网页 / PWA（占位）

- 负责人：Web 负责人
- 技术：React 19 + Vite + vite-plugin-pwa（ADR-0003）
- 内部结构：见 `docs/architecture/repo-structure.md` 第 4 节
- 由 D-L0-12（网页骨架）建立工程：届时新增 `package.json`（名称 `@weiban/web`）、`tsconfig.json`（extends `@weiban/tsconfig/react.json`）、`vitest.config.ts`（用 `defineProject`）。浏览器全局变量和 React 相关 ESLint 规则在根 `eslint.config.js` 追加带 `files: ['apps/web/**']` 的配置块。
