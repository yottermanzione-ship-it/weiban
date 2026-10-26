# 2026-10-26 批 EJ：生态主循环接入 Jev 判定 + 记忆整理截断（server，可含后台）

| 项 | 内容 |
|---|---|
| 派发人 | 项目总负责人（Claude） |
| 依据 | 总经理 10-26 分工（`docs/refactor/11-plan-and-open-topics.md` C15）；方案 `docs/ai/2026-10-23-ecology-native-decision-spec.md`、`docs/decisions/ADR-20261024-independent-action-decisions.md`、`docs/refactor/25-jev-ecology-decisions.md` |
| 生产实查（10-26） | `ai_runtime.ecology_config.decisionModelKey = null`，生态暂停，近 3 天 0 次运行；目录里有 `jev/jev-latest`（B.ai 上游，有价目与计费上限）；`Ecology.executeWake`（`apps/server/src/modules/ai-runtime/application/ecology.ts`）仍用 `generateText(JSON)` + `modelKeyOverride`，Jev 不是文字模型，接不上 |

## 公共约定

- 基线 `local/trunk`（已与 GitHub `origin/main` 同步，契约 4.2、迁移 0143）。worktree：`git -C C:/wb-dev/wb-int worktree add C:/wb-dev/wb-eco-jev -b eco-jev local/trunk`；`.env` 从 `C:\wb-dev\wb-t052\.env` 复制。
- 不 push、不合入主线、不碰服务器、不打印密钥、**不发起真实付费调用**（用离线夹具 / 假适配器）。迁移从 0144 起、契约如需改从 4.3 起，改契约先在报告写明理由。
- 交付前 `git merge local/trunk`；server（及改到的包）typecheck、lint、相关测试各一次。交接 `docs/handoffs/2026-10-26-eco-jev.md` 随代码提交，通俗中文汇报。

## 要做的事

1. **分工落地**（总经理原话归纳）：
   - 动作判定（这次醒来做不做、做哪几个）＝**平台内部选择的 Jev**，走已有原生判定接口 `ModelGatewayMediaPort.decide`（`jev-adapter.ts`，参考 `Planner.callJev` 的调用方式）；
   - 动作执行（想具体内容、写朋友圈 / 消息 / 碎碎念、发语音）＝**用户自己选的模型**（角色单独指定优先，其次用户场景设置）；缺了对应模型就不把该动作放进候选，**不偷偷换模型**；
   - 角色处于私密模式时按 H2 规则用私密模型执行，Jev 只收净化后的候选特征，不收私密原文。
2. **改造 `executeWake`**：按方案文档 §四：先查能不能做 → 整理候选（固定 ID）→ 同情境候选尽量一次请求批量问 Jev（允许多项通过）→ 程序排除互斥 / 重复 / 过度打扰 → 用户模型逐项执行 → 成功才记「已做」。低把握（沿用 0.55）、超时、陌生 ID 一律不做，不重试刷钱、不回落到文字模型判定。无候选时不调用 Jev。
3. **后台**：生态设置里的「决策模型」只允许选具备判定能力的模型（Jev 类），说明文字写清「Jev 只判断做不做，内容由用户自己选的模型生成」；未选时生态暂停的提示保留。确认 Jev 目录条目所需的能力标记 / 场景（现在 capabilities 为空），必要时加一个能力值并迁移。
4. **计费**：Jev 判定费用沿用现有归属（用户付，`countAsBackground`），按 Jev 价目（输入 0.28 元/百万 token）记账；同一次批量请求只记一次。先用后扣、欠费即停的规则照旧。
5. **记忆整理截断**：生产近 4 天记忆整理（purpose `memory`）失败 9 次，其中 7 次是 `truncated`（DeepSeek V4.1 Flash 6 次、私密模型 1 次）；另 `simulation` 用途截断 4 次。查明输出上限设置与截断后的处理（是否可续写 / 拆小批 / 调大上限），修好并加针对用例。只看调用元数据，不读用户正文。
6. 交接里写清：总经理在后台要选什么（生态决策模型选 Jev）、选完后第一次运行怎么看效果（后台生态运行记录）。
