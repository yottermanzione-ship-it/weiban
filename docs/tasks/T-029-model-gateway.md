# T-029 模型网关（AI 部分，D-L0-09）

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-06 |
| 状态 | 进行中 |
| 分支 | `T-029-model-gateway` |

## 目标

实现模型网关：服务器里所有调用 AI 模型的请求都从这里走。流程是：估价并冻结余额 → 调用上游 → 按实际用量结算，或失败时解冻。另外做一个假上游，在没有真实密钥的情况下也能完整测试。

## 输入文档（必读）

- `docs/architecture/dev-plan.md` D-L0-09 行
- `docs/handoffs/2026-10-06-backend-lead-T-027.md`（「给 AI 负责人」7 条，必读）
- `docs/backend/model-access.md`、`docs/backend/billing.md` 第 5 节（计费端口用法）
- `docs/architecture/billing.md` 第 6 节、`message-reliability.md` 第 6 节（错误分类与重试）
- `packages/contracts/src/ports/model-gateway.ts`、`src/ports/billing.ts`
- `docs/ai/runtime-overview.md`（网关、安全兜底 9.1 节）、`docs/ai/model-catalog.md`
- `docs/architecture/engineering-standards.md` 第 3 节（R4：只有 model-access 能引用供应商 SDK；R9：只有 model-access 能引用冻结 / 结算端口）

## 工作内容

按 dev-plan D-L0-09：
- 上游适配器：OpenAI 兼容格式为主，个别非兼容接口单独适配
- 统一生成接口，接入计费端口（结算和解冻时带上 `upstreamId`）
- 错误分类与重试
- 上游状态探测任务
- 模型目录、排行榜、价目表的初始数据（种子脚本）：价格按 `model-catalog.md` 录入；**总经理之后才配置真实密钥**，种子数据不含密钥
- 假上游（测试用），以及安全透支只能在安全关怀路径上打开的约束

## 范围

- 可以改：`apps/server/src/modules/model-access/`（网关代码）、种子脚本、`docs/ai/`、`docs/backend/model-access.md`
- 不可以改：`packages/contracts/`（需要改的写进交接说明）、`docs/quality/`、`.github/`
- 不要执行 `pnpm db:down`
- 并行任务 T-028（后端）会改 billing、identity，以及 model-access 的模块装配那一行。交付前请合并最新 origin/main

## 验收标准

- [ ] 用假上游跑通：冻结 → 调用 → 结算，多退少补；调用失败全额解冻；余额不足时拒绝调用；同一个幂等键重复调用只扣一次
- [ ] 错误分类与重试有测试；上游故障会上报状态
- [ ] 平台密钥只在 `UpstreamService.withApiKey` 内使用，日志里搜不到（测试）
- [ ] 需要真实密钥才能验证的项目，在交接说明中列为「待配置后验证」
- [ ] 节省额度：本机只完整跑一次 `pnpm check`，推送后以 CI 为准
- [ ] 提交格式 `T-029 类型: 说明`

## 交付物

- 分支 `T-029-model-gateway`；交接说明 `docs/handoffs/2026-10-06-ai-lead-T-029.md`（提交在分支上）
