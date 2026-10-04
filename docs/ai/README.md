# docs/ai 目录（AI 系统负责人）

| 文档 | 内容 | 是否唯一定义处 |
|---|---|---|
| `runtime-overview.md` | AI 运行时总方案：模型网关（平台中转）、上下文、记忆、推演、群聊、识图、硬性边界执行、小巧思、多媒体、导入 | 是（AI 内部设计；网关各用途默认 `maxOutputTokens`） |
| `character-card-spec.md` | 角色卡规范 WB-Card 1.0（含两个示例卡、酒馆卡导入映射） | 是（卡片字段；分类字段以契约 / `architecture/hard-boundaries.md` 为准） |
| `character-distillation.md` | 预设角色蒸馏流程与更新流程 | 是 |
| `cost-estimate.md` | 费用估算、默认后台预算与执行规则、「大约每条回复 X 元」估算方法 | 是（费用估算数字） |
| `model-catalog.md` | 上游选择、上架候选模型、能力与标签（含无审查模型）、价目表成本价初始值、排行榜数据来源 | 是（模型目录与成本价） |
| `eval-plan.md` | 评测集方案、人设稳定检查、模型选型评测 | 是（通过线） |
| `prd-8.2-answers.md` | PRD 8.2 十五问答复（第 10 问的禁止清单 v1.1 起停用，仅作历史记录） | — |
| `samples/` | 成人模式测试样本：6 张原创成年角色卡 + 跨模式测试清单 | 是（样本卡） |
| `eval-runs/` | 每次评测报告（首次评测时创建） | — |
| `cost-report-YYYY-MM.md` | 按月成本报告（开发跑通后开始） | — |

相关决策：`docs/decisions/ADR-0010-native-android-and-relay-billing.md`、`ADR-0012-relay-billing-and-wallet.md`（平台中转计费，取代已作废的 ADR-0008）、`ADR-0007-hard-boundary-enforcement.md`（含成人模式修订）、`ADR-0009-character-card-format.md`（提议）。计费设计见 `docs/architecture/billing.md`。
