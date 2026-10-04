# T-014 契约包工程化与规范确认（D-L0-04）

| 项 | 内容 |
|---|---|
| 负责人 | architect |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |
| 分支 | `T-014-contracts-build` |

## 目标

让 `packages/contracts` 通过编译、能导出 JSON Schema 与接口文档，契约升到 1.0，成为后端、网页、安卓开工的可靠基础；同时确认 T-011 验收中需要架构拍板的规范问题。

## 输入文档

- `docs/architecture/dev-plan.md`（D-L0-04、D-L0-17）
- `packages/contracts/README.md` 与 `src/`
- `docs/quality/T-011-acceptance.md`（建议 2、3、4 及「对开发者遗留问题的意见」）
- `docs/handoffs/2026-10-04-devops-lead-T-011.md`
- `docs/product/input/2026-10-04-pm-rulings-2.md`（B1：成人模式模型标签只作信息标签，契约注释需修正）
- `docs/architecture/engineering-standards.md`、`docs/decisions/ADR-0004-module-boundaries-and-events.md`

## 工作内容

1. 契约包改用共享 tsconfig（`@weiban/tsconfig`），修正全部编译问题，`pnpm --filter @weiban/contracts typecheck` 和 `build` 通过
2. `generate` 脚本导出 JSON Schema（给安卓 Kotlin 端用）和 OpenAPI 文档到 `generated/`（不进仓库）
3. 删除 `.prettierignore` 中跳过契约包的那一行，格式化契约包，`pnpm format:check` 通过
4. 修正 B1 相关注释；清理 PRD 已取消的 `age_not_confirmed`、`group_conversation` 错误码（如确已无用）
5. 契约升为 1.0，更新 README 变更记录
6. 为契约写最基本的单元测试：关键 schema 能正确接受合法数据、拒绝非法数据
7. 规范确认（更新你自己的文档）：
   - 用本地 ESLint 规则代替 `eslint-plugin-boundaries`：确认并修改 `engineering-standards.md` 第 3 节措辞
   - `library` 模块在 ADR-0004 分层图中的位置
   - `apps/server/test/` 集成测试能否引用模块内部（QA 建议 3）
   - `packages/ai-evals` 能否直连模型 SDK（QA 建议 4，可与 AI 方案对照后决定）
   - R9 加固方案：其他模块不得引用 `BillingPort` 类型 / 注入令牌（QA 建议 2）；你定方案，写进规范，实现由运维在 T-015 中完成——请在交接说明里写清楚

## 范围

- 可以改：`packages/contracts/`、`.prettierignore`、`docs/architecture/`、`docs/decisions/`（你自己的 ADR）
- 不可以改：`packages/eslint-config/`（运维 T-015 在改）、`.github/`、其他目录
- 在分支上提交，不合并 main

## 验收标准

- [ ] 在仓库根目录 `pnpm check` 通过（含契约包的 lint、typecheck、format:check、test）
- [ ] `pnpm --filter @weiban/contracts generate` 产出 JSON Schema 与 OpenAPI 文件，抽查结构正确
- [ ] 契约版本 1.0，变更记录完整
- [ ] 规范确认 5 项都有结论并写进对应文档
- [ ] 提交格式 `T-014 类型: 说明`

## 交付物

- 分支 `T-014-contracts-build`
- 交接说明：`docs/handoffs/2026-10-05-architect-T-014.md`（提交在分支上）
