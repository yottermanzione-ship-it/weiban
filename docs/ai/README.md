# docs/ai 目录（AI 系统负责人）

| 文档 | 内容 | 是否唯一定义处 |
|---|---|---|
| `runtime-overview.md` | AI 运行时总方案：模型接入、上下文、记忆、推演、群聊、识图、硬性边界执行、小巧思、多媒体、导入 | 是（AI 内部设计） |
| `character-card-spec.md` | 角色卡规范 WB-Card 1.0（含两个示例卡、酒馆卡导入映射） | 是（卡片字段；分类字段以契约 / `architecture/hard-boundaries.md` 为准） |
| `character-distillation.md` | 预设角色蒸馏流程与更新流程 | 是 |
| `cost-estimate.md` | 费用估算、默认后台预算 | 是（所有费用数字） |
| `model-catalog.md` | 供应商、候选模型、标签、价格表、排行榜数据来源 | 是（模型目录数据） |
| `eval-plan.md` | 评测集方案、人设稳定检查、模型选型评测 | 是（通过线） |
| `prd-8.2-answers.md` | PRD 8.2 十五问答复；成人模式法律禁止内容清单 | 是（禁止清单） |
| `eval-runs/` | 每次评测报告（首次评测时创建） | — |
| `cost-report-YYYY-MM.md` | 按月成本报告（开发跑通后开始） | — |

相关决策：`docs/decisions/ADR-0020-platform-model-call-billing.md`、`ADR-0021-character-card-format.md`（均为提议）。
