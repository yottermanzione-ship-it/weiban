# T-020 架构跟进：ADR-0015 评审、规范同步、安全透支设计

| 项 | 内容 |
|---|---|
| 负责人 | architect |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |

## 目标

清掉 T-015、T-016 留给架构的待确认事项；在计费模块（D-L0-16）开工前，把安全优先透支（裁定 B4）写进计费设计。

## 输入文档

- `docs/decisions/ADR-0015-server-kernel-implementation.md`（后端提议）
- `docs/handoffs/2026-10-05-backend-lead-T-016.md`
- `docs/handoffs/2026-10-05-devops-lead-T-015.md`（「最严格理解」的四处取舍，以及总负责人对 R10 的裁定）
- `docs/architecture/engineering-standards.md`、`billing.md`、`tech-debt.md`
- `docs/product/input/2026-10-04-pm-rulings-2.md`（B4：余额为零时，安全关怀允许小额透支，设单独上限；A1：历史人物可以生成古风插画）
- `docs/product/prd-v1.md`（v1.3）第 15～17 章、`docs/handoffs/2026-10-05-product-lead-T-017.md`、`docs/product/input/2026-10-04-pm-rulings-2.md` C1
- `docs/ai/runtime-overview.md` 第 15 节（AI 负责人的接口变更申请，尤其是「安全关怀跟进」用途）

## 工作内容

1. 评审 ADR-0015：批准或提出修改意见，更新状态；TD-018 视结果关闭
2. 同步 `engineering-standards.md` 第 3 节，使措辞与已实现的规则一致：
   - R10 允许集成测试引用装配入口（总负责人裁定）
   - dependency-cruiser 只用于检查循环依赖
   - R9 规则 A/B/C 的实际范围和豁免
   - 确认运维提出的四处取舍
3. **B4 安全透支**：在 `billing.md` 中设计「安全关怀」用途的小额透支，包括：上限、怎么记账、透支后怎么恢复、怎么防止滥用；同时评估 AI 申请的「安全关怀跟进不受后台预算限制」。需要改契约的，直接在契约里改，并升次版本
4. **A1 历史人物形象**：同步 `hard-boundaries.md` 和 policy 推导规则说明（代码实现留给 D-L0-11）
5. **PRD v1.3 的架构工作**（见 `docs/handoffs/2026-10-05-product-lead-T-017.md` 中给架构的部分）：在 `dev-plan.md` 补充 v1.3 的任务（人设广场、经期日记、共同领养宠物、行为规划决策层、后台用量查询），设计经期数据加密与隔离、广场的数据结构与「分类锁定」的系统级执行；确认后台用量查询接口够用；契约中成人模式模型的注释已在 T-014 按 B1、B2 修正，复核即可
6. 更新 `tech-debt.md`

## 范围

- 可以改：`docs/architecture/`、`docs/decisions/`、`packages/contracts/`
- 不可以改：`apps/server/`、`packages/eslint-config/`、`.github/`、`docs/quality/`；不执行 git 命令（契约改动由总负责人提交；改了契约必须在本机跑 `pnpm check` 确认通过）

## 验收标准

- [ ] 上述 5 项都有结论并写入对应文档
- [ ] 如改了契约，`pnpm check` 通过，并在交接说明中写明版本号

## 交付物

- 交接说明：`docs/handoffs/2026-10-05-architect-T-020.md`
