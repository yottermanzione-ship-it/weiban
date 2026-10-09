# T-046 L2 记忆深化：向量检索与分层摘要

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-08 |
| 状态 | 待开始 |

## 目标

把 L2 记忆从「关键词排序 + 单一滚动摘要」升级为**向量检索 + 分日/分月分层摘要**，让角色在长对话里真正记得住、找得回。这是 T-043 交接里明确留下的两项遗留。

## 背景

T-043 已交付记忆的完整工程骨架（加密存储、抽取任务、删除屏障、并发幂等、记忆管理接口、网页与安卓界面），但两处明确未做：

- 检索：`docs/ai/l2-memory-implementation.md` 第 7 行写明「每次同角色检索按关键词 0.7 / 重要性 0.2 / 时间 0.1 排序」，**没有向量模型实测结果，不声称向量检索已完成**。
- 摘要：同文件第 11 行写明「摘要每个抽取批次最多 250 字，按 normal/adult 分别加密滚动保留 4000 字；**尚未实现分月/分日摘要层级**，1000 轮质量留待真实评测」。

## 输入文档

开工前必须读：
- `docs/ai/l2-memory-implementation.md`（现状全貌，含删除屏障与 scope 规则）
- `docs/ai/runtime-overview.md`、`docs/ai/eval-plan.md` 第 3.2 节（记忆评测用例）
- `docs/product/prd-v1/05-memory.md`（MEM-01～MEM-06）
- `docs/architecture/` 中的数据域与模块职责文档；`docs/backend/model-access.md`（后台网关与用途）
- `packages/contracts/src/http/memory.ts`、`packages/contracts/src/ports/model-gateway.ts`
- `docs/team/dev-environment-notes.md`（本机环境，必读）
- 参考实现：`apps/server/src/modules/ai-runtime/application/memory.ts`、`domain/memory.ts`、`infra/db/schema.ts`

## 范围

- **可以改**：`apps/server/src/modules/ai-runtime/**`；新增迁移 `apps/server/drizzle/0015_*`（**编号 0015 已为你保留，不要用别的编号**）；`packages/ai-evals/**`；`docs/ai/**` 中你负责的说明文档。
- **不可以改**：其他模块（`characters`、`contacts`、`chat`、`model-access` 的代码只读，通过端口调用）；`packages/contracts/**`——若确需改接口，**先在交接说明里写契约变更申请**，不要自己改契约；`docs/quality/**`（归 Codex）。
- 迁移必须同时提供 `.up.sql` 与 `.down.sql`（见 `docs/backend/kernel.md`「数据库迁移」）。

## 必须处理的设计问题

1. **向量检索与加密的冲突**。记忆正文用用户 DEK 加密，而向量要能相似度搜索就不可能加密存储。请明确你选择的方案（例如：只存向量 + 加密正文、向量是否可逆推出语义、是否接受该泄露面），写清理由与代价。**这属于重大技术决策，请写 ADR 到 `docs/decisions/`**，并在交接里说明没人代签原架构负责人。
2. **嵌入模型的调用**。嵌入必须走 `model-access` 的后台网关（`background` 角色用途），计入真实预算与用量记录，不允许绕过计费直连上游。
3. **降级路径**。嵌入模型不可用、余额不足、上游故障时，检索必须**回退到现有关键词排序**，不能让回复失败。
4. **分层摘要与删除屏障**。分日/分月摘要同样用用户 DEK 加密；摘要层必须遵守 T-043 已建立的删除屏障规则（删除/手改后不再提交屏障之前的原文），不要把被删除的事实从旧摘要里带回来。
5. **normal / adult 隔离**。摘要仍按 normal/adult 分开加密滚动，成人内容不得进入普通摘要（MODE-05）；经期词句仍不写入记忆。

## 验收标准

逐条可检查，质量负责人照此验收：
- [ ] 向量检索生效：新增集成测试证明语义相近但用词不同的记忆能被检索到，而关键词排序会漏掉它
- [ ] 嵌入调用走后台网关并产生用量记录与计费（测试断言用量行存在）
- [ ] 嵌入不可用时自动回退关键词排序，回复不失败（有专门测试）
- [ ] 分日与分月摘要生效：测试证明超过单层 4000 字预算的长对话仍能保留早期要点
- [ ] 摘要加密存储，normal 与 adult 分开；测试断言成人内容不进入普通摘要
- [ ] 删除屏障仍然生效：删除一条记忆后，旧摘要与旧原文都不再注入上下文（测试）
- [ ] 迁移 0015 有 up 与 down，`pnpm --filter @weiban/server db:migrate` 与回滚都跑通
- [ ] 本机相关测试**跳过 0 条**（`docs/team/dev-environment-notes.md` 有 `.env` 说明）
- [ ] 新增评测用例覆盖 MEM-01/02/03/05；`docs/ai/l2-memory-implementation.md` 更新为实际状态
- [ ] 没有为让检查通过而放宽断言、跳过测试或改门禁

## 交付物

- 代码 / 文档路径：`apps/server/src/modules/ai-runtime/**`、`apps/server/drizzle/0015_*`、`packages/ai-evals/**`、`docs/decisions/`（如需要）、`docs/ai/l2-memory-implementation.md`
- 交接说明：`docs/handoffs/2026-10-08-ai-lead-T-046.md`
- 分支：`T-046-l2-memory-vector`（已建好，worktree 在 `C:\wb-dev\wb-t046`）


## 2026-10-09 Codex CI 接续

本轮仅修PR #8的测试属性引用与扩展评测清单断言；源码 `f1ef42cd1e7aff1f6093467cc2eaf23737649b07`。最终本地完整476条零跳过，类型/边界/格式及安卓生成一致性通过；最终远端CI与遗留见 `docs/handoffs/2026-10-09-ai-lead-T-046.md` 追加记录。只登记开发自测，独立验收另行安排；原任务清单不由本轮勾选。
