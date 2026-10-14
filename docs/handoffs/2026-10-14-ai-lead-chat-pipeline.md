# 交接说明：聊天链路改造（请求组装、缓存命中、长期记忆、人设保持）

| 项 | 内容 |
|---|---|
| 负责人 | AI 系统负责人（ai-lead） |
| 日期 | 2026-10-14 |

依据：总负责人转交的总经理要求；`docs/refactor/03-aiyu-learnings-ai.md` 改进清单 #4 #5 #7 #8；酒馆 SillyTavern 设计调研。设计与对照全文见 `docs/refactor/09-chat-pipeline.md`。分两批合入主干：第一批 `840e63f`（#4 #5 #7 #8，契约 3.6，迁移 0091），第二批（酒馆借鉴 + 文档，契约 3.7）。

## 做了什么

1. 私聊回复请求改为「① 稳定开头（1 条 system）→ ② 聊天记录（深度 4 插写作提示）→ ③ 动态结尾（1 条 system）」；十来条系统消息合并；角色卡 JSON 改短行文字；示例固定 6 条。模板版本 `chat-v3`。
2. 分段稳定窗口 12 / 30 / 50 用户轮（+1.6 万字触发）；摘要片段带消息序号，边界只移到片段结尾，原文与摘要不重叠；常驻记忆 + 摘要冻结为「稳定记忆块」，只在窗口前移或记忆被改删时重算。
3. 常驻记忆（基础资料 / 重要度 ≥8，≤8 条）在开头，检索记忆 Top 8 短行在结尾。
4. 模型目录 `systemMessageMode`（multi / single_system / no_system），网关发送前改写。
5. 用量记录 `stable_prefix_tokens`、看板 `stablePrefixRate`（理论可缓存占比）；假上游模拟前缀缓存；成本报告 `docs/ai/cost-estimate.md` 7.6。
6. 角色卡 `prompting`（系统补充、后置指令、角色笔记按深度、示例保留策略）；世界书合并进原公开资料：常驻进开头、触发进结尾、扫描深度、预算、1 层递归、防递归；作者注释式写作提示固定深度 4（「自动」风格从末尾挪到这里）；`{{user}}` / `{{char}}` 占位符替换。
7. 对比工具 `ai-runtime/tools/prompt-compare.ts`：60 轮模拟，每次输入 2,199 → 1,818 token，命中率 61% → 83%，未命中 853 → 318 token。

## 改了哪些文件

- 契约：`packages/contracts/src/http/model-access.ts`、`ports/model-gateway.ts`、`character-card.ts`、`version.ts`（3.7）、`README.md`；安卓生成物 `apps/android/core/contracts-generated/**`
- 迁移：`apps/server/drizzle/0091_chat_pipeline(.down).sql`、`meta/_journal.json`
- model-access：`application/{gateway,catalog,resolver,usage}.ts`、`domain/{system-messages,prefix-cache}.ts`（新）、`infra/db/schema.ts`、`index.ts`
- ai-runtime：`application/{reply-context,reply-engine,memory}.ts`、`domain/{prompt-assembly,character-prompt,memory-window}.ts`（新）、`domain/{knowledge,persona,reply-rules}.ts`、`infra/db/schema.ts`、`tools/prompt-compare.ts`（新）
- 文档：`docs/refactor/09-chat-pipeline.md`（新）、`docs/ai/character-card-spec.md`（1.1）、`docs/ai/cost-estimate.md`（1.3）、`docs/ai/runtime-overview.md`（第 4 节指向 09）、本文件

## 遗留问题

- 按授权未写新测试。跑了一次相关集成测试（13 文件 116 项，在第一批代码上）：115 通过，1 项 `model-gateway.test.ts`「上游持续故障……unavailable」失败，**主干未改动时同样失败**（账号池改连续失败阈值后测试未更新），非本次引入。第二批后又跑了 `ai-runtime.test.ts`、`memory-persona.test.ts`（29 项全过）。
- 改了聊天提示词：评测集没有真实执行器，人设一致 / 记忆 / 边界需真实模型前后对比（交 Codex 时重点看：安全关怀不受写作提示影响、卡片 prompting 不能绕过平台规则、窗口前移后记忆不丢、删记忆后不再出现）。
- 群聊、主动消息、通话的上下文未改造；记忆「置顶」未做（需契约变更）；各平台缓存粒度与多 system 支持未实测。
- 角色卡规范原先「删除 system_prompt / post_history」的决定已按总经理要求调整为「包装后追加」，见 `character-card-spec.md` 1.1；如架构负责人对安全有异议请提出。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给网页负责人（管理后台）：按 `09-chat-pipeline.md` 第 11 节加页面——模型页「系统消息放法」下拉；用量看板「理论可缓存占比」与明细「稳定开头 token」；角色卡编辑「高级：提示词写法」与世界书设置、条目「不触发别的条目」勾选。
- 给安卓负责人：契约 3.6 / 3.7 生成物已重新生成并提交；角色卡是严格对象，旧版客户端本地校验带新字段的卡会失败，请确认安卓是否本地校验卡片。
- 给后端 / 运维：上线需执行迁移 0091（只加列与约束，回退脚本已备）。
- 给架构：契约 3.6 / 3.7 均为向后兼容新增可选字段，已登记 README 变更记录。
- 给 Codex：见上面「遗留问题」的验收重点。
