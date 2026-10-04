# T-019 CI 接入数据库、补充环境变量样例

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |
| 分支 | `T-019-ci-database` |

## 目标

GitHub 上的 CI 也能跑需要数据库的集成测试。现在 CI 里有 30 个服务器测试会因为没有数据库被跳过。

## 输入文档

- `docs/handoffs/2026-10-05-backend-lead-T-016.md`（给运维的部分）
- `docs/ops/ci.md`、`.github/workflows/ci.yml`、`docker-compose.yml`、`deploy/dev/postgres-init/`
- `docs/backend/kernel.md`（环境变量表）

## 工作内容

1. CI 加 PostgreSQL 18 + pgvector 服务容器，和本机开发库同一版本、同一初始化脚本；设置 `TEST_DATABASE_URL`，库名不能叫 `weiban`
2. 在 CI 里**确认集成测试确实执行了、没有被跳过**：skipped 数为 0，或明确列出合理的剩余跳过
3. `.env.example` 补 `PLATFORM_KEK_FILE`、`PLATFORM_KEK_VERSION`、`HOST`、`PORT` 的说明（开发可空，生产必填）
4. 更新 `docs/ops/ci.md`

## 范围

- 可以改：`.github/`、`.env.example`、`deploy/dev/`、`docs/ops/`
- 不可以改：`apps/server/`（后端 T-018 在改）、`packages/`、`docs/quality/`
- 在任务分支上提交，不合并 main；推送后用 gh 确认 CI success（`C:\Program Files\GitHub CLI\gh.exe`，已登录）

## 验收标准

- [ ] 分支 CI success，日志中服务器集成测试实际执行（附测试数量）
- [ ] 本地 `pnpm check` 通过
- [ ] 提交格式 `T-019 类型: 说明`

## 交付物

- 分支 `T-019-ci-database`
- 交接说明：`docs/handoffs/2026-10-05-devops-lead-T-019.md`（提交在分支上）
