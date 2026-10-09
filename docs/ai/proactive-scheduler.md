# 主动消息调度器实现说明（T-053，D-L3-03）

代码：`apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts`。需求：PRD SIM-05～SIM-10、CHAT-13 第 2 条、ACC-03；参数以 PRD 5.1 节为准（P-03/P-04/P-05/P-06/P-07/P-08/P-09），P-33 见 `cost-estimate.md` 6.2。数据端口见 ADR-0023 与 `docs/backend/proactive.md`。

## 一句话

每 10 分钟给每个用户跑一次：先收集「有理由」的候选，再按规则一条条筛，能发时让聊天模型按人设写文字，和 proactive 发送账本在同一个数据库事务里写进私聊。每次调度最多发一条。

## 流程

1. `ai.proactive_tick`（每 10 分钟）为每个有角色的用户入队 `ai.proactive_user`（同一时段去重）。
2. `runForUser`：
   - 账号必须有效；前一天留下的计划直接放弃（`expired_day`），不排到第二天。
   - 全局开关关闭（ACC-03）→ 当天所有计划放弃（`global_off`）。
   - 免打扰时段内、活跃时段外 → 本轮不动，计划保留到同一天进入时段。
   - 活跃时段：最近 14 天至少 5 天有聊天才启用学习（P-06）；某小时在 ≥20% 的活跃天出现过即算活跃，并向前后各扩 1 小时。数据不足用 09:00–23:00（P-05）。
3. 候选（每条写一行 `ai_runtime.proactive_plans`，带 `reason`、`source_ref`、`topic_key`、`brief`）：
   - `holiday`：proactive 节日端口当天节日；恋爱节日只对关系「恋人」或恋爱情景模式；按熟悉度排序（priority = 100 + 等级）。
   - `anniversary`：用户生日、growth 的认识纪念日 / 自定义纪念日。
   - `follow_up`：记忆里 `commitment` 类、状态仍为「当前」、到期 36 小时内的约定（用户已说过结果时记忆会转为「过去」，不再跟进）。
   - `absence`：超过 P-08（72 小时）没给该角色发消息；来源键用缺席起点，所以每次缺席最多 1 条。
   - `daily_event`：当天推演事件中挑最多 2 件（不选 rest 类），发送时刻按稳定随机分散在 09–22 点之间，避免固定时间规律。
   - 其他服务可调用 `request()` 登记（如 `safety_follow_up`、`interactive_play`），发不发仍走同一套规则。
   - 同一来源对同一角色只登记一次（唯一约束），实现「一个事件最多推一次」。
4. 筛选（按 节日优先 → priority → 到期时间）：
   - P-09：用户 5 分钟内在任一会话（私聊或群聊）发过消息 → 全部延后，记下第一次延后时间；超过 60 分钟放弃（`chat_defer_timeout`）。
   - 余额低于 P-33（1 元）、余额耗尽或当天后台预算用完 → 放弃（`budget`），安全关怀跟进除外。
   - 单角色开关关闭 → `character_off`。
   - P-07：同角色同话题 7 天内发过 → `duplicate_topic`（节日纪念日不受此限）。
   - 频率三档：少 = 1、适中 = 3、多 = 5（见遗留）；当日已发达到档位 → `frequency_limit`。
   - proactive 端口预检：P-03 / P-04 / 上一条未回复 → `daily_limit` 或 `awaiting_reply`（节日纪念日不受「未回复」限制，但仍计入 P-03/P-04）。
5. 发送：认领计划（planned → generating）→ 调后台网关，`purpose=proactive`、`countAsBackground=true`、`modelRole=chat`（产生用量与计费记录）→ 输出守卫 → 事务内：用户锁、核对账号与关系 epoch、`recordSent`（最终闸门）、逐条 `postMessage`（最多 3 个气泡，幂等键 `proactive:<计划ID>:<序号>`）、计划标为 sent、审计日志 `proactive.sent` 记录理由与来源。任何一步失败整笔回滚，计划记为 dropped 并写明原因。

## 理由记录（SIM-05 第 10 条）

每条计划都有 `reason`、`source_ref`、`outcome`（sent 或放弃原因），保留 30 天；发出的还写一条审计日志。验收抽查可直接查 `ai_runtime.proactive_plans`。

## 活跃记录

`chat.message_created` 中用户发的任何消息写 `ai_runtime.user_chat_activity`（用户、当地日期、小时、该小时最后时间），不存内容，保留 16 天。用于 P-06 和 P-09。

## 推演接线（T-051 遗留中与调度相关的部分）

- 推演的「长期不活跃」（P-17）改为：与该角色聊天/添加时间 和 用户打开 App 时间（`IdentityReadPort.getLastActiveAt`）取较晚者，7 天都没有才暂停。
- 调度时把当天推演事件用来源 UUID 发布到 proactive 日报端口（ADR-0023），重投幂等；时间线读发布记录。

## 数据与清理

迁移 `0022_proactive_scheduler`（up/down）。账号注销、联系人彻底删除时一并清理两张表。
