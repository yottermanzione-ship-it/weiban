# 交接：私密模式通话摘要写入私密范围（方案 20 §2.4 问题 2）

日期：2026-10-21　分支：`call-scope-fix`（基于 `local/trunk`，未推送、未合入）

## 结论

私密模式通话结束后生成的那条「我们打了电话，……」记忆，现在写成 `scope = adult`（私密范围），只会在私密模式里被想起、只交给私密模型；日常模式通话仍写 `normal`。无迁移、无契约改动。

## 改了什么

| 文件 | 改动 |
|---|---|
| `apps/server/src/modules/ai-runtime/application/memory.ts` | `addEpisode` 增加第 6 个参数 `scope`（默认 `normal`，宠物 / 专注等现有调用不变），写库时用它代替写死的 `'normal'`；`addCallSummary` 增加必填参数 `scope` 并透传 |
| `apps/server/src/modules/ai-runtime/application/call-agent.ts` | `summarize()` 调 `addCallSummary` 时传本通电话的范围 `this.info.scope`（打开通话时按「场景模式 = 私密 且 角色有私密资格」决定，与摘要选私密模型的条件一致） |
| `apps/server/src/modules/ai-runtime/application/call-agent.test.ts` | 测试辅助函数加可选参数（私密模式 / 用户说一句话）；新增 1 条参数化测试：私密通话摘要用 `adult` 模型并以 `adult` 范围写入，日常通话用 `background` 模型并以 `normal` 写入 |

adult 记忆的下游已有隔离：`memory.context` / 稳定记忆块 / 日摘要都按范围过滤，非私密场景只读 normal；`memoryShareable` 排除 adult，不参与跨角色转述；`sharedFrom` 只查 normal。

## 同类路径排查

| 路径 | 结论 |
|---|---|
| 通话中抽取记忆 | 通话各轮不写成聊天消息，不走消息抽取；通话唯一的记忆写入就是结束摘要，已修 |
| 私聊里的通话记录卡片（`call_record`） | 消息范围跟随会话 `contentScope`（私密模式下即 adult），卡片只含方向、结局、时长，不含通话内容，无泄露 |
| 来电未接 / 拒接后的补发消息（`call-scheduler.onCallEnded`） | 提示词只含人设和「没接 / 挂断」，不读通话内容或私密记忆，消息范围跟随会话，无泄露 |
| 通话开场读历史与记忆（`openSession`） | 已按范围读（私密读 normal+adult，日常只读 normal），符合 §2.4 |

## 自查

- `git merge local/trunk`：已是最新
- server `typecheck`：通过
- 改动 3 个文件 eslint + prettier：通过
- depcruise：无违规
- server build：通过
- `call-agent.test.ts`：7/7 通过（含新增 2 例）

## 遗留 / 需要上报

1. **私密通话中触发危机关怀时的模型选择**：`call-agent.ts respond()` 里 `adult = scope === 'adult' && !careActive`。私密通话一旦检测到自伤风险，该轮改用普通聊天模型（关怀优先），但发出的提示词里仍带着开场时读到的私密历史和私密记忆，与 §2.4 第 3 条「含 adult 内容只能给 adult 模型」冲突。修法有两种（关怀轮剔除 adult 历史与记忆后再发普通模型 / 关怀轮仍走私密模型），涉及安全取舍，本次未改，建议与 §2.4 第 3 条硬检查一起由 AI 系统负责人定。
2. 已有的私密通话摘要数据仍是 `normal`：库里无法区分哪些是私密通话产生的（通话表不存当时范围），本次不做数据回填；如需清理需另行评估（可按通话时会话 `contentScope` 变更记录推断）。
3. §2.4 问题 1（日常私聊读私密内容）按要求未动，等总经理拍板。
