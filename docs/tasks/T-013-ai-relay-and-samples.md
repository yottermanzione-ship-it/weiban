# T-013 AI 方案修订：中转计费、模型目录与价目、成人模式测试样本

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-04 |
| 状态 | 已完成（总负责人复核；冲突裁定见 input/2026-10-04-pm-rulings-2.md B1～B5） |

## 目标

把 `docs/ai/` 从 BYOK 改为平台中转，产出模型目录与价目表初稿，并制作成人模式测试用的原创角色卡。

## 输入文档（必读）

- `docs/decisions/ADR-0010-native-android-and-relay-billing.md`、`ADR-0012-relay-billing-and-wallet.md`、`ADR-0007`（含修订记录）
- `docs/architecture/billing.md`、`docs/architecture/hard-boundaries.md`（v1.1）
- `docs/product/input/2026-10-04-manager-feedback-2.md`、`2026-10-04-pm-rulings-2.md`
- `docs/product/prd-v1.md`（v1.2）、`prd-v1/02-model-billing.md`、`prd-v1/10-hard-boundaries.md`、`prd-v1/11-scenario-modes.md`
- `docs/handoffs/2026-10-04-architect-T-009.md`、`docs/handoffs/2026-10-04-product-lead-T-010.md`（给 AI 的部分）
- 你自己的 `docs/ai/` 全部文档

## 工作内容

1. **去 BYOK**：更新 `runtime-overview.md`、`model-catalog.md`、`cost-estimate.md` 等。模型网关接入计费端口（冻结 / 结算）；订阅模型状态和余额事件；删除「自定义兼容地址」；图片和语音由平台提供
2. **模型目录与价目表初稿**：
   - 列出上架候选模型，分国内官方渠道（如阿里云百炼、DeepSeek 直连）和境外聚合（如 OpenRouter）
   - 写明各模型的用途标签：角色扮演强、便宜、识图、长上下文、无审查等
   - 写明成本价，并给出「大约每条回复 X 元」的估算方法；价格要标来源，未核实的要标出
   - 在目录中标记无审查模型；无审查模型只能给有成人资格的角色使用（ADR-0007 修订）
3. **成本与预算**：按余额模式更新措辞；确认安全关怀的次日跟进不受后台预算和 P-33 限制
4. **成人模式测试样本**：
   - 制作 4～6 张**原创成年角色**卡，严格按 `character-card-spec.md`，分类为「原创成年角色」
   - 覆盖不同人设类型：如高冷、温柔、傲娇、成熟御姐 / 熟男、虚构明星类
   - 可以以某类明星气质为灵感，但必须用新名字，不得包含任何真实人物的真名、真实作品、真实人际关系、真实经历
   - 每张卡附「成人模式下的人设表现要点」，用于测试人设在不同情景模式下是否稳定
   - 放在 `docs/ai/samples/`
5. **评测集**：补 SAFE-03 第 6 条（内容层面的两条底线）用例，以及无审查模型闸门用例

## 范围

- 可以改：`docs/ai/`
- 不可以改：其他目录；不执行 git 命令

## 验收标准

- [ ] `docs/ai/` 不再残留 BYOK 表述
- [ ] 模型目录与价目表初稿完成，有来源和「未核实」标注
- [ ] 测试样本卡 4～6 张，符合规范与上述约束
- [ ] 评测集补充完成
- [ ] 交接说明列出需要架构 / 后端配合的点

## 交付物

- 更新后的 `docs/ai/`
- 交接说明：`docs/handoffs/2026-10-04-ai-lead-T-013.md`
