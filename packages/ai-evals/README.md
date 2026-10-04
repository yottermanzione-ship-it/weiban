# packages/ai-evals · AI 评测集（占位）

- 负责人：AI 负责人
- 内容：AI 评测集用例与运行器，方案见 `docs/ai/eval-plan.md`
- 建立工程时新增 `package.json`（名称 `@weiban/ai-evals`）、`tsconfig.json`（extends `@weiban/tsconfig/node.json`）；需要并入 `pnpm test` 时再加 `vitest.config.ts`（用 `defineProject`）。
