# 交接说明：积分制、后台消耗由用户承担、模型倍率、上游账号池与用量监控

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人（受托做契约改动与 ADR 登记） |
| 日期 | 2026-10-13 |
| 依据 | 总经理 2026-10-13 裁定；`docs/refactor/06-old-ui-spec.md` 第 6、9 节；ADR-0032 |
| 自测 | 按总经理裁定**不写测试、不跑测试**，只保证 typecheck / lint / build 与 `pnpm android:generate:check` 通过 |

## 做了什么

### 第一批（裁定 1～3、5，契约 3.3，迁移 0088）

1. **积分制**：账本仍按微元，1 积分 = 10,000 微元。用户端钱包、流水、用量汇总、价目表、管理端账户概况都带积分字段；每条扣费流水与角色消息都带 `usageRecordId`，消息带 `pointsCost`（一次回复多个气泡时记在第一个正式气泡）；新增按调用查消息摘要的接口；充值档位 / 赠送比例 / 联系说明后台可配（第一版不开真实支付）；管理员可按积分加扣。
2. **后台消耗由用户承担**：后台调用本来就扣用户钱包；本次把平台每日成本上限改为只约束平台账户，用户付费调用不再占用平台预算。后台用途余额不足直接停（不透支）；安全检查 / 关怀跟进仍可透支到 −2 元（规则未改）。
3. **模型倍率**：后台合并接口 `GET/PUT /admin/model/models`，一次保存目录 + 三个倍率（元 / 百万 token）；后端自动生成并发布新价目表版本。旧价目表就是旧数据，无需迁移。用户端模型列表的价格档位改为真实计算，并给「约每条积分」。
4. **文档**：ADR-0031 与 `docs/refactor/05-sub2api-integration.md` 标为已废弃；新写 ADR-0032；`docs/backend/{billing,model-access,chat}.md` 增补实现说明；契约 README 变更记录 3.3。

### 第二批（裁定 4，契约 3.4，迁移 0089）

1. **上游账号池**：一个服务商可登记多个账号；模型可配多个账号（路由），按优先级 → 权重调度，同一会话尽量落在同一账号（粘性，利于缓存命中）；失败立即切换到下一个账号；连续失败 3 次自动暂停 5 分钟，密钥失效 / 额度耗尽立即摘除，后台每分钟探测恢复；每账号、每用户的并发与每分钟上限。
2. **用量监控**：按用户 / 模型 / 上游账号 / 天 / 小时聚合的调用数、积分消耗、上游成本、平均耗时、失败率、缓存命中率；调用明细带积分与实际上游模型名；看板概览接口。
3. 实现说明见 `docs/backend/model-access.md`「契约 3.4」一节；设计取舍见 ADR-0032 第 4 条。

## 改了哪些文件（第一批）

- 契约：`packages/contracts/src/http/{billing,model-access,chat}.ts`、`src/ports/{billing,chat}.ts`、`src/version.ts`（3.3）、`README.md`
- 迁移：`apps/server/drizzle/0088_points_rates.sql` / `.down.sql`、`meta/_journal.json`
- billing：`application/{wallet,admin,prices,reservations,recharge(新),model-rates(新)}.ts`、`http/billing.controller.ts`、`billing.module.ts`、`tokens.ts`、`index.ts`、`infra/db/schema.ts`
- model-access：`application/{models(新),catalog}.ts`、`http/model-access.controller.ts`、`model-access.module.ts`、`tokens.ts`
- chat：`application/{charges(新),store,write}.ts`、`http/charges.controller.ts`（新）、`chat.module.ts`、`infra/db/schema.ts`
- ai-runtime：`application/{reply-engine,proactive-scheduler,group-chat}.ts`（把扣费交给 chat）
- 安卓生成物：`apps/android/core/contracts-generated/**`
- 文档：`docs/decisions/ADR-0032-points-and-upstream-pool.md`（新）、ADR-0031、`docs/refactor/05-sub2api-integration.md`、`docs/backend/{billing,model-access,chat}.md`

## 接口清单（第一批，给网页 / 安卓 / 后台）

换算：**积分 = 微元 ÷ 10,000**（契约 `MICROS_PER_POINT`、`microsToPoints`）。显示规则见 06-old-ui-spec 6.1（最多 2 位小数、千位逗号、`< 0.01`）。

| 接口 | 用途 | 新增字段 / 说明 |
|---|---|---|
| `GET /api/v1/billing/wallet` | 积分页 | `balancePoints`、`availablePoints`、`heldPoints`、`lowBalanceThresholdPoints`、`backgroundBudget.dailyLimitPoints` / `spentTodayPoints` |
| `PATCH /api/v1/billing/wallet/settings` | 提醒线、每日后台预算 | 可传 `lowBalanceThresholdPoints`、`backgroundDailyLimitPoints` |
| `GET /api/v1/billing/ledger` | 积分明细 | 每条 `points`（扣费为负）、`balanceAfterPoints`、`usageRecordId`（扣费类） |
| `POST /api/v1/messages/by-usage` | 积分明细「每条消息」 | 请求 `{ usageRecordIds: [≤100] }`，返回 `{ items: [{ usageRecordId, messageId, conversationId, excerpt(前 30 字), pointsCost, createdAt }] }` |
| `GET /api/v1/billing/usage-summary` | 用量统计 | 每行 `points`，合计 `totalPoints` |
| `GET /api/v1/billing/prices` | 价目表（高级） | 每项 `points` |
| `GET /api/v1/model/models` | 价目表「约每条 X 积分」 | `pointsPerReply`（可能为 null） |
| `GET /api/v1/billing/recharge-options` | 充值页 | `{ paymentEnabled:false, tiers:[{ tierId, priceMicros, points, bonusPercent, bonusPoints }], contactHint, pointsPerYuan:100 }`；`paymentEnabled=false` 时按钮为「联系管理员充值」+ 弹窗显示 `contactHint` |
| 消息（WebSocket / 同步 / 列表） | 每条消息消耗 | `Message.pointsCost`、`Message.usageRecordId`（聊天页不显示积分） |
| `GET /api/v1/admin/billing/accounts` | 后台「用户与积分」 | `balancePoints`、`spentLast30DaysPoints` |
| `POST /api/v1/admin/billing/accounts/:userId/adjustments` | 后台按积分加 / 扣 | 传 `points`（与 `amountMicros` 二选一） |
| `GET/PUT /api/v1/admin/billing/recharge-options` | 后台充值档位配置 | PUT `{ tiers:[{ tierId, priceMicros, bonusPercent }], contactHint }` |
| `GET /api/v1/admin/model/models` | 后台「模型」标签 | 目录字段 + `rates`、`costRates`（元 / 百万 token）、`hasTimeBands`、`pointsPerReply` |
| `PUT /api/v1/admin/model/models/:modelKey` | 添加 / 编辑模型（向导保存） | 目录字段 + `rates`（null = 不改价）、`costRates`（可省 = 同售价）；模型键需 URL 编码 |

## 改了哪些文件（第二批）

- 契约：`packages/contracts/src/http/model-access.ts`、`src/version.ts`（3.4）、`README.md`
- 迁移：`apps/server/drizzle/0089_upstream_pool.sql` / `.down.sql`、`meta/_journal.json`
- model-access：`application/{scheduler(新),limits(新),gateway,gateway-maintenance,upstreams,catalog,models,usage}.ts`、`infra/{db/schema,upstream-probe}.ts`、`http/model-access.controller.ts`、`model-access.module.ts`
- 管理后台：`apps/admin/src/features/usage.tsx` 只补了新维度 hour 的中文名（保证类型检查通过，页面改造仍归网页负责人）
- 安卓生成物、`docs/backend/model-access.md`

## 接口清单（第二批，给后台「模型管理」页，06-old-ui-spec 第 9 节）

| 接口 | 页面 | 说明 |
|---|---|---|
| `GET /api/v1/admin/model/upstreams` | 上游账号表 | 每行新增 provider、priority、weight、maxConcurrency、rpmLimit、enabled、note、cooldownUntil、consecutiveFailures、lastError、lastUsedAt、lastTestedAt、inFlight、todayCalls、todayCostMicros。状态显示：enabled=false →「已停用」；status≠active 或 cooldownUntil 未到 →「异常」，原因看 lastError |
| `POST /api/v1/admin/model/upstreams` | 添加账号 | 可带调度参数；`saveOnTestFailure: true` = 测试不通过也保存（状态记异常） |
| `PATCH /api/v1/admin/model/upstreams/:id` | 编辑账号 | 名称、地址、服务商、优先级、权重、并发 / 每分钟上限（null = 不限）、启用、备注 |
| `PUT /api/v1/admin/model/upstreams/:id/key` | 更换密钥 | 不变 |
| `POST /api/v1/admin/model/upstreams/:id/test` | 测试 | 不变（通过时清暂停） |
| `POST /api/v1/admin/model/upstreams/batch` | 批量测试 / 启用 / 停用 | `{ upstreamIds, action: 'test' / 'enable' / 'disable' }` → `{ items }` |
| `GET /api/v1/admin/model/upstreams/:id/models` | 添加模型向导第 ② 步 | `{ items: [{ id }] }`；失败 422 upstream_test_failed，界面允许手填 |
| `GET / PUT /api/v1/admin/model/models` | 模型标签 | 第一批接口，新增 `routes: [{ upstreamId, upstreamModelId, priority, weight, enabled }]`（PUT 时整体替换，至少 1 条） |
| `GET / PUT /api/v1/admin/model/limits` | 设置（表头问号说明里的数值） | `{ perUserConcurrency, perUserRpm, failureThreshold, cooldownSeconds }` |
| `POST /api/v1/admin/model/usage/overview` | 概览：汇总数字、可用账号、最近错误 | `{ from, to, upstreamIds?, modelKeys? }` → totals / previousTotals / accounts / recentErrors |
| `POST /api/v1/admin/model/usage/summary` | 趋势图、模型分布、账号排行 | 维度新增 `hour`；合计新增 chargedPoints、avgLatencyMs、failureRate、cacheHitRate |
| `POST /api/v1/admin/model/usage/records` / `export` | 调用记录 | 每条新增 chargedPoints、upstreamModelId |

## 遗留问题

- 消息上的积分只覆盖私聊回复、主动消息、群聊发言；朋友圈、通话、宠物、玩法等的消耗只在积分明细（流水）里，不挂在消息上。
- 私聊回复记的是「这次回复」各次调用的合计，但输入审查 / 成人边界检查、行为规划、语音 / 表情等附加调用走各自路径，计入流水但不计入该消息的 `pointsCost`。
- 倍率保存会把该模型的分时价改为全天价（ADR-0032 代价）。
- 安卓生成物已更新；Kotlin 侧未编译验证（未改安卓业务代码，新增字段全部可空）。
- 第二批：并发 / 频率 / 粘性计数在进程内存，服务重启清零，多实例部署前须改共享存储。
- 第二批：语音、图片、搜索（media-gateway）仍按目录主上游调用，没有接入账号池与失败切换。
- 第二批：每用户限流超出时用户看到的是「模型暂时不可用」（契约没有专门的错误码）。
- 未写、未跑任何测试（总经理裁定）。Codex 验收时建议重点看：失败切换后结算记的上游、暂停与恢复、旧目录接口与路由同步、0088 / 0089 迁移在已有数据上的执行、平台每日上限范围变化。

## 需要总经理决定的事

无（是否开放真实支付已在 06-old-ui-spec 10.3 第 1 条，等总经理决定；本次按「不开」实现）。

## 给其他负责人的交接

- 给网页负责人：按上表把余额改为积分（只用 `*Points` 字段）；积分明细「每条消息」页先拉 `ledger`，再用其中的 `usageRecordId` 批量调 `POST /messages/by-usage` 取摘要；充值页按 `recharge-options` 渲染档位，`paymentEnabled=false` 时只显示联系管理员。后台：「用户与积分」加扣改为按积分输入（传 `points`）；「模型」标签用 `/admin/model/models`。
- 给安卓负责人：同网页用户端；生成物已更新到契约 3.3。
- 给 AI 负责人：`cost-estimate.md` 7.2 的「标准回复」现在直接驱动用户端「约每条积分」与后台 `pointsPerReply`；平台每日上限已不再拦用户付费调用（ADR-0032 第 2 条）。
- 给运维负责人：香港服务器上的 sub2api 按 ADR-0031 废弃可下线（总负责人转交）。
- 给架构负责人：ADR-0032 请复核；`billing.md` 第 7 节第 2 条（平台上限范围）与 10.1 节、`docs/product/glossary.md`「余额 / 积分」术语需按 ADR-0032 同步（不在后端职责内，未改）。
