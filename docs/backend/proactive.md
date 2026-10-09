# 主动消息与日报数据层（T-052）

公开出口：`apps/server/src/modules/proactive/index.ts`，上层模块通过契约端口调用。架构和契约申请见 [ADR-0023](../decisions/ADR-0023-proactive-data-ports.md)。迁移 0021，新 schema `proactive`，回滚可删除该模块所有表。

- `DAILY_EVENT_PORT`：日报发布与分页。`eventId` 复用来源 UUID；重投相同内容返回 0，异内容冲突。每批最多 50 条，同批整笔事务；仅有效账号与联系人可写/读。响应不暴露任意原始模型 JSON。用户 HTTP 不接受 userId，归属取鉴权身份。
- `HOLIDAY_EVENT_PORT`：`getUpcoming(fromDate, daysAhead)` 接受当地起始日期；`getUpcomingForUser(userId, daysAhead)` 读取 identity 的 IANA 时区推导今天。范围含起始日，1–366 天。年度 02-29 在非闰年跳过；农历节日使用管理员维护的当年一次性公历日期，不错误使用固定公历月日。
- `PROACTIVE_MESSAGE_PORT`：配额预检、每日计数、待回复、发送账本。P03 每角色 3 次、P04 全角色 8 次；节日也计数。可配置的低频上限可在预检传 1–3，最终账本仍强制产品硬上限。

## T-053 的消息发送事务

生成之前做 `canSendProactive` 预检，但它不预留发送名额。生成后使用 `database.transaction`，先 `recordSent(..., tx)`，然后 `ChatWritePort` 写入同一消息/气泡批次，传入同一个 Tx。配额或待回复失败时抛 conflict，整笔事务回滚；消息写入失败也回滚账本。幂等键在用户范围内唯一，重投不得换日期、角色或理由。发送调用方必须复用 ChatWritePort 的消息幂等键，并在生成前后核对关系 epoch，防止跨恢复关系的迟到消息。

支持理由：`daily_event`、`follow_up`、`absence`、`holiday`、`anniversary`、`public_feed`、`safety_follow_up`、`interactive_play`。`isHoliday=true` 只允许 holiday/anniversary；节日不覆盖普通消息待回复。用户真实私聊消息事件触发 `markReplied`，旧事件只能清理事件发生之前建立的待回复状态。

调度器仍负责主动开关、免打扰、活跃时段、话题去重、后台预算、角色排序和生成守卫；本模块没有开启实际自动发消息。

## HTTP 与数据清理

管理端节日 GET/POST/PATCH/DELETE：`/api/v1/admin/proactive/holidays`；必须管理员管理会话。日报管理员写入/纠错 `/api/v1/internal/proactive/daily-events`；内部消费方使用端口。用户分页 `/api/v1/characters/:characterId/daily-events`。UUID/查询/请求体由契约校验，分页游标绑定用户与角色。初始种子仅固定公历节日。

日报保留最近 90 天，小时任务清理过期日，全球 UTC-12 边界采用保守截止日（可能多保留一天，不提前删除）。联系人彻底删除清理此用户/角色所有三表；已恢复为有效联系人时迟到清理事件不删除新关系。账号删除清单登记 proactive，同用户锁下清理日报/账本/待回复，迟到写入重新核对账号。

T-051 推演暂存事件与本模块发布表还未接线；由 T-053 使用来源 UUID 调用日报端口，后续完整时间线只读发布记录。不能把当前日报接口称作所有朋友圈、关系互动、公开动态的完整时间线。
