# T-016 服务器平台内核（D-L0-05）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |
| 分支 | `T-016-server-kernel` |

## 目标

建立 `apps/server` 的平台内核，后续所有业务模块（账号、计费、模型接入、聊天……）都在它上面搭建。完成后服务器能启动，能连本机数据库，有健康检查接口。

## 输入文档（必读）

- `docs/architecture/dev-plan.md`（D-L0-05 行，以 main 上最新版为准）
- `docs/architecture/overview.md`、`repo-structure.md`、`engineering-standards.md`（全部，尤其第 3 节模块边界规则）
- `docs/architecture/security-and-privacy.md`（日志脱敏、信封加密）
- `docs/architecture/message-reliability.md`（事件发件箱、幂等收件箱）
- `docs/decisions/ADR-0003`、`ADR-0004`、`ADR-0006`、`ADR-0014`（契约包怎么被引用）
- `packages/contracts/README.md`
- `docs/ops/local-dev.md`（本机数据库怎么起）
- `docs/handoffs/2026-10-05-architect-T-014.md`（给后端的部分：生产环境运行契约代码的方式由你在本任务选定；计费模块两个 Symbol 注入令牌的约定）

## 工作内容

按 dev-plan D-L0-05：配置加载与校验、数据库连接与迁移工具、事务工具、事件发件箱与幂等收件箱、pg-boss 任务队列封装、平台时钟（规则 R7）、结构化日志与脱敏、加密工具（信封加密）、鉴权守卫骨架、统一错误格式（与契约错误码一致）、健康检查接口、`product-params.ts`（产品参数唯一定义处）。

## 范围

- 可以改：`apps/server/`；根目录 `package.json` / `pnpm-lock.yaml`（加依赖时）；`docs/backend/`
- 不可以改：`packages/contracts/`（需要改契约请在交接说明中提变更申请）、`packages/eslint-config/`（运维 T-015 在改）、`docs/quality/`、其他负责人的文档
- 在任务分支上提交，不合并 main

## 验收标准

- [ ] `pnpm check` 在仓库根目录通过（包括服务器的 lint、typecheck、test）
- [ ] 本机 `pnpm db:up` 后，服务器能启动，`GET /health` 返回正常，并能报告数据库连接状态
- [ ] 数据库迁移能执行和回滚；集成测试使用 `TEST_DATABASE_URL`
- [ ] 发件箱：业务写入和事件写入在同一事务中，事务回滚则事件不发出；收件箱：同一事件重复投递只处理一次。两者都有集成测试
- [ ] 日志脱敏：故意放一个可识别的假密钥，走完流程后在日志输出中搜不到（有测试）
- [ ] 信封加密：加密、解密往返正确；主密钥不在数据库中（有测试）
- [ ] 当前时间一律经平台时钟获取，测试中可以固定时间
- [ ] `docs/backend/kernel.md`：说明内核各部分怎么用，供后续模块开发者阅读
- [ ] 提交格式 `T-016 类型: 说明`

## 交付物

- 分支 `T-016-server-kernel`
- 交接说明：`docs/handoffs/2026-10-05-backend-lead-T-016.md`（提交在分支上）
