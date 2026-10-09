# 公开动态后端（D-L3-02）

需求：PRD SIM-03、ADM-03；搜索方案：`docs/architecture/prd-answers.md` 第 7 节；系统层保证：`docs/architecture/hard-boundaries.md`（只有 effective 动态给 AI）。
接口：`packages/contracts/src/http/public-updates.ts`（`PublicUpdateAdminEndpoints`）、`ports/public-updates.ts`（`PublicUpdateReadPort`）。

## 归属与表

- 模块：`characters`（overview.md 第 4 节：公开动态属于角色库）。
- 迁移 `0025_public_updates`：`characters.public_updates`、`characters.public_update_settings`（单行 `default`）。
- 日期列用 `text`（YYYY-MM-DD），与契约 `LocalDate` 一致。`source_key` = 规范化来源链接（去 www、查询串、锚点、末尾斜杠），用于去重。

## 状态机

```
draft ─submit→ pending ─approve(可带修改)→ effective ─withdraw→ withdrawn
                  └─reject→ rejected
```

- 手动录入可直接以 draft / pending / effective 创建；只能录给「预设 + 真人」角色。
- 自动候选一律 pending，永不自动生效。
- 编辑只允许 draft、pending；删除只允许 draft、rejected；其他返回 `409 conflict`。
- 并发：迁移用「WHERE status = 旧状态」的条件更新，两次审核只有一次成功，另一次 409。
- 每次迁移写 `platform.audit_log`（module = characters，action = `public_update.*`）。

## 自动候选搜索

- 每周一北京时间 03:00（pg-boss 任务 `characters.public_updates_weekly`），只针对「预设、已上架、真人、至少被一个用户添加」的角色，每角色一个任务 `characters.public_updates_search`（singletonKey = 角色 + ISO 周，重复投递只跑一次）。
- 管理员可对单个真人角色手动触发（不受自动开关限制，角色不必已上架）。
- 搜索经 `WEB_SEARCH_PROVIDER`（model-access，形状 = 契约 3.0 `ModelGatewayMediaPort.webSearch`）：当前实现是让网关上的模型返回 JSON 搜索结果，`purpose = admin_public_update_search`、`billingOwner = platform`，记平台账户；开发环境走假上游。定时任务用第一个管理员账号作为记账发起人（网关要求平台计费的调用方是管理员）。
- 每次最多 5 条候选；按来源链接和内容相似度（二元组 Dice ≥ 0.8 或包含）去重，与任何状态（含已驳回）的已有动态重复都丢弃。
- 搜索失败返回 `outcome = unavailable`，不报错；关闭自动开关后只保留手动录入（SIM-03 兜底）。

## 给 AI 运行时

- `PUBLIC_UPDATE_READ_PORT`（characters 导出）→ `listEffective(characterId, asOfDate, {limit, pastDays})`：只返回 effective 且生效日期已到的动态；`phase` = recent / past（结束日期或开始日期早于今天 = past）。
- 推演引擎（`ai-runtime/application/simulation.ts`）已接入：把最近 30 天内的已生效动态作为「已审核事实」放进推演提示词。
