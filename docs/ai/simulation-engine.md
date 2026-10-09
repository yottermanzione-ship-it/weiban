# 推演引擎实现说明 v1.0

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 任务 | T-051 |
| 版本 | 1.0 |
| 日期 | 2026-10-09 |
| 相关文档 | PRD `docs/product/prd-v1/08-simulation.md`（SIM-01/02/12/13）；运行时方案 `docs/ai/runtime-overview.md` 2.4 节；计费 `docs/backend/billing.md` |

## 0. 一句话

推演引擎每天为每个活跃角色调用一次模型，生成 2-8 条日常事件和一个整体心情，作为主动消息调度（T-052）的数据源；余额不足或角色长期不活跃时静默暂停，不影响聊天。

## 1. 数据库（迁移 0019）

新增三张表，全在 `ai_runtime` schema：

| 表 | 用途 |
|---|---|
| `simulation_states` | 每个（用户×角色）的推演控制状态：上次推演日期、上次活跃时间、今日事件数、暂停原因 |
| `daily_events` | 生成的日常事件流水，按 (user, character, date, seq) 唯一 |
| `mood_states` | 每个（用户×角色）当前心情，随推演 upsert |

## 2. 推演流程

```
每天 UTC 18:00（北京 02:00）
  ↓
RUN_DAILY_SIMULATIONS_JOB：扫描 simulation_states 中近 14 天内活跃的角色对
  ↓  （每个未推演角色入队 SIMULATE_CHARACTER_JOB）
simulateCharacter(userId, characterId)
  │
  ├─ 今天已推演过？→ 幂等返回
  ├─ 长期不活跃（>= 14 天）？→ pausedReason = 'inactive'，返回
  │
  ├─ gateway.generateText({ purpose: 'simulation', modelRole: 'background',
  │                          countAsBackground: true, responseFormat: 'json' })
  │
  ├─ ok = false？→ pausedReason = 'budget_exceeded' / 'model_unavailable'，返回
  └─ ok = true？→ 写 daily_events + mood_states，清空 pausedReason
```

## 3. 规模控制（SIM-12）

- 每角色每天至多 1 次模型调用（幂等键 `sim:{userId}:{characterId}:{date}`）。
- 每次至多生成 8 条事件（`MAX_EVENTS_PER_RUN = 8`，Zod 约束强制）。
- `maxOutputTokens = 512`，减少后台费用。
- `countAsBackground = true`，计入用户后台每日上限，受 budget_exceeded 限制。

## 4. 降级路径

| 情况 | 行为 |
|---|---|
| `budget_exceeded` / `insufficient_balance` | `pausedReason = 'budget_exceeded'`，当天不再尝试 |
| 模型不可用 | `pausedReason = 'model_unavailable'` |
| 长期不活跃 | `pausedReason = 'inactive'` |
| 模型输出 JSON 格式错误 | 静默跳过，不写任何状态，下次仍可尝试（同日幂等键已用，实际当天不重试） |
| 余额恢复后 | 下次推演周期（次日凌晨）自动继续 |

## 5. 隔离性

推演生成的日常事件和心情状态**不直接注入聊天上下文**，只暴露给 T-052 主动消息调度通过 `SimulationReadPort` 读取。

## 6. 给主动消息调度（T-052）的接口

`SimulationReadPort`（injection token `SIMULATION_READ_PORT`，由 `AiRuntimeModule` exports）：

```typescript
interface SimulationReadPort {
  // 查询某角色某日的全部日常事件（按 seq 升序），date 格式 YYYY-MM-DD
  getDailyEvents(userId: string, characterId: string, date: string): Promise<DailyEventEntry[]>;
  // 查询某角色当前心情，不存在时返回 'neutral'
  getCurrentMood(userId: string, characterId: string): Promise<SimulationMood>;
}
```

T-052 在 `AiRuntimeModule` 里注入即可，无需额外导入。

## 7. 活跃时间更新

聊天消息到达时，`lifecycle.ts` 已订阅 `chat.message_created` 事件。T-052 或后续版本若需要更细粒度的活跃追踪，可调用 `SimulationService.markActive(tx, userId, characterId)`。

## 8. 评测集

`packages/ai-evals/cases/l3.ts` 新增 14 道用例，覆盖 SIM-01（10 道，通过线 90%）和 SIM-02（4 道，追问细节一致性）。

## 9. 成本估算

每角色每天：1 次调用 × ~500 input token × ~200 output token × 后台模型价 ≈ 0.015 元，10 个角色约 0.15 元/天，符合 `cost-estimate.md` 第 0 节的估算。
