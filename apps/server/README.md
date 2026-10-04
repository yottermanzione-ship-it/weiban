# apps/server · 服务器（@weiban/server）

- 负责人：后端负责人（`src/modules/ai-runtime/` 归 AI 负责人）
- 技术：Node.js 24 + NestJS 11，模块化单体（ADR-0003、ADR-0004）；实现取舍见 ADR-0015
- 内部结构：`docs/architecture/repo-structure.md` 第 3 节
- **平台内核怎么用：`docs/backend/kernel.md`**（写业务模块前必读）

常用命令（仓库根目录运行，先 `pnpm db:up`）：

| 命令                                                                    | 作用                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm --filter @weiban/server db:migrate` / `db:rollback` / `db:status` | 数据库迁移执行 / 回滚 / 查看                          |
| `pnpm --filter @weiban/server dev`                                      | 本机启动（热重载），默认 http://127.0.0.1:3000/health |
| `pnpm --filter @weiban/server build`                                    | 生产构建到 `dist/`                                    |
| `pnpm --filter @weiban/server identity <命令>`                          | 账号运维：创建管理员、重置密码、生成邀请码等          |

账号模块（identity）说明：`docs/backend/identity.md`。

模块边界规则 R1～R10 由 `packages/eslint-config` 检查；新增 `src/modules/<模块名>/` 前先在 `packages/eslint-config/architecture.js` 登记层级（运维维护）。
