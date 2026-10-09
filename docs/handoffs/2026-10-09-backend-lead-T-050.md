# 交接说明：T-050 L3 growth 模块第一部分 — 熟悉度、认识天数与纪念日

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-09 |

## 做了什么

实现 GRW-03 熟悉度等级与 GRW-04 认识天数、纪念日的完整后端模块（`growth`），为推演引擎（T-051）和主动消息调度（T-052）的熟悉度依赖做好准备。

主要内容：
- 数据库迁移 0018（`growth` schema，三张表：familiarity / familiarity_events / anniversaries，含 up 与 down）
- 契约 v2.5（新增 `packages/contracts/src/http/growth.ts`，5 个 HTTP 接口）
- 后端模块 `apps/server/src/modules/growth/`（领域规则、服务层、控制器、NestJS 模块装配）
- `app.module.ts` 注册 `GrowthModule`
- 同步 Android Kotlin 生成代码

## 改了哪些文件

**新增**
- `apps/server/drizzle/0018_growth.sql`
- `apps/server/drizzle/0018_growth.down.sql`
- `packages/contracts/src/http/growth.ts`
- `apps/server/src/modules/growth/domain/familiarity-rules.ts`
- `apps/server/src/modules/growth/application/growth.service.ts`
- `apps/server/src/modules/growth/http/growth.controller.ts`
- `apps/server/src/modules/growth/growth.module.ts`
- `apps/server/src/modules/growth/tokens.ts`
- `apps/server/src/modules/growth/index.ts`
- `apps/server/src/modules/growth/infra/db/schema.ts`

**修改**
- `packages/contracts/src/version.ts`（2.4 → 2.5）
- `packages/contracts/src/index.ts`（新增 growth 导出）
- `apps/server/src/app.module.ts`（新增 GrowthModule 导入与注册）
- `apps/android/core/contracts-generated/`（Android Kotlin codegen 同步）

## 遗留问题

1. 认识天数目前用服务器 UTC 日期做本地日期的代理（`occurredAt.toISOString().slice(0, 10)`）。精确计算需要 identity 模块的 `timeZone` 字段，`GrowthService.addPoints` 中已有注释说明。待 identity 模块暴露时区端口后可替换 `familiarity-rules.ts` 中的 `daysKnownFromDate`，无需改接口。

2. `SYSTEM_ANNIVERSARY_DAYS` 目前只预生成到第 3 年（1095 天）的节点。GRW-04 规定之后每 100 天和每个周年都是节点，第 3 年后的节点目前只能靠 `computeNextOccurrence` 按周年循环。对 3 年以上长期用户的纪念日节点覆盖不够完整，后续可扩展此数组或改为动态生成。

3. 本次按总经理最新指示未在本机跑测试，检测交 CI，审核交 Codex。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 ai-lead：熟悉度加分接口已就绪（`POST /api/v1/growth/:characterId/familiarity/points`）。推演引擎（T-051）可通过该接口触发 `active_chat_day`、`reply_to_proactive`、`moments_interaction`、`anniversary_chat`、`first_time_interaction` 五类事件。每次传 `idempotencyKey` 确保幂等，格式建议 `{eventType}:{conversationId}:{localDate}`。

- 给 architect（信息通报）：契约版本升至 2.5（次版本，向后兼容）。`growth` 模块已按 architecture.js 中预登记的 layer=upper、schema=growth 实现，无架构边界违规。
