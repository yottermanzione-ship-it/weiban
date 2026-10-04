# T-011 仓库骨架与本机开发数据库（D-L0-01 + D-L0-02）

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-04 |
| 状态 | 进行中 |
| 分支 | `T-011-repo-skeleton` |

## 目标

搭好代码仓库的骨架和本机开发数据库：后续所有开发任务都能在这上面直接开工，一条命令就能起数据库。

## 背景

这是第一个代码类任务，按 `docs/ops/git-workflow.md` 在任务分支上开发，完成后由质量负责人验收，总负责人合并。
本机环境已就绪（总负责人已验证）：Node.js 24.21.0、pnpm 11.28.4、git 2.56、Docker 29.8.1 + Compose v5.5.1（能正常拉取镜像）、PowerShell 执行策略 RemoteSigned。

## 输入文档

- `docs/architecture/dev-plan.md`（D-L0-01、D-L0-02 行）
- `docs/architecture/repo-structure.md`（含第 6 节 `.gitignore` 清单）
- `docs/architecture/engineering-standards.md`（第 3 节，模块边界规则 R1～R9）
- `docs/decisions/ADR-0003-tech-stack.md`、`docs/decisions/ADR-0011-android-native-client-stack.md`
- `docs/ops/git-workflow.md`、`docs/ops/dev-env-setup.md`

## 范围

- 可以改：仓库根目录配置文件（`package.json`、`pnpm-workspace.yaml`、tsconfig、ESLint、Prettier、Vitest 配置等）、`.gitignore`、`docker-compose.yml`、`.env.example`、按 `repo-structure.md` 建立的空目录骨架（含占位文件）、`docs/ops/`
- 不可以改：`packages/contracts/src/` 的内容（D-L0-04 由架构负责），其他 docs 目录；不写业务代码
- 不要合并到 `main`，不要推送 `main`

## 验收标准

- [ ] `pnpm install` 在干净克隆上一次成功；`devEngines.packageManager` 锁定 pnpm 11，Node 版本锁定 24
- [ ] 根脚本可用：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format`（空项目下也能跑通，返回成功）
- [ ] ESLint 模块边界规则 R1～R9 已配置，并附一个最小示例或测试，证明越界导入会报错
- [ ] 目录结构与 `repo-structure.md` 一致（安卓工程目录先占位，Gradle 工程由 Android 负责人在 D-L0-18 建立）
- [ ] `.gitignore` 按 `repo-structure.md` 第 6 节补齐
- [ ] `docker compose up -d` 起 PostgreSQL 18 + pgvector：数据用命名卷；能用 `.env.example` 中的配置连上；`CREATE EXTENSION vector` 成功
- [ ] `docs/ops/local-dev.md`：给总经理的本机开发说明（怎么起停数据库、怎么跑检查），一步一步写
- [ ] `docs/ops/dev-env-setup.md` 第五节的 pnpm 版本更新为 11（总负责人已在本机装好 11）
- [ ] 提交信息遵循 `T-011 类型: 说明` 格式，提交在分支 `T-011-repo-skeleton` 上

## 交付物

- 分支 `T-011-repo-skeleton` 上的提交
- 交接说明：`docs/handoffs/2026-10-04-devops-lead-T-011.md`（提交在任务分支上）
