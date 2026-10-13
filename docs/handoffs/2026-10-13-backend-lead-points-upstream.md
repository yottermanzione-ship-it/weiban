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

见下方「第二批」一节（第二批提交时补全）。

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

## 遗留问题

- 消息上的积分只覆盖私聊回复、主动消息、群聊发言；朋友圈、通话、宠物、玩法等的消耗只在积分明细（流水）里，不挂在消息上。
- 私聊回复记的是「这次回复」各次调用的合计，但输入审查 / 成人边界检查、行为规划、语音 / 表情等附加调用走各自路径，计入流水但不计入该消息的 `pointsCost`。
- 倍率保存会把该模型的分时价改为全天价（ADR-0032 代价）。
- 安卓生成物已更新；Kotlin 侧未编译验证（未改安卓业务代码，新增字段全部可空）。

## 需要总经理决定的事

无（是否开放真实支付已在 06-old-ui-spec 10.3 第 1 条，等总经理决定；本次按「不开」实现）。

## 给其他负责人的交接

- 给网页负责人：按上表把余额改为积分（只用 `*Points` 字段）；积分明细「每条消息」页先拉 `ledger`，再用其中的 `usageRecordId` 批量调 `POST /messages/by-usage` 取摘要；充值页按 `recharge-options` 渲染档位，`paymentEnabled=false` 时只显示联系管理员。后台：「用户与积分」加扣改为按积分输入（传 `points`）；「模型」标签用 `/admin/model/models`。
- 给安卓负责人：同网页用户端；生成物已更新到契约 3.3。
- 给 AI 负责人：`cost-estimate.md` 7.2 的「标准回复」现在直接驱动用户端「约每条积分」与后台 `pointsPerReply`；平台每日上限已不再拦用户付费调用（ADR-0032 第 2 条）。
- 给运维负责人：香港服务器上的 sub2api 按 ADR-0031 废弃可下线（总负责人转交）。
- 给架构负责人：ADR-0032 请复核；`billing.md` 第 7 节第 2 条（平台上限范围）与 10.1 节、`docs/product/glossary.md`「余额 / 积分」术语需按 ADR-0032 同步（不在后端职责内，未改）。
