# 会员与计价 v5：后端实现说明

> 依据：`docs/refactor/16-membership-v5.md`（产品规则的唯一出处，本文不重复数字的理由，只写实现）。契约 3.17。
> 任务卡：`docs/tasks/2026-10-19-v5-batches.md` 批 A。

## 1. 统一「是否 PRO+」（各模块只用这一个）

- 位置：契约 `IdentityMembershipReadPort.isProPlus(userId, tx?)`（`packages/contracts/src/ports/identity.ts`），
  实现 `apps/server/src/modules/identity/application/membership.ts`。
- 注入：`@Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort`，
  令牌从 `../../identity/index.js` 导入；模块需 `imports: [IdentityModule]`（多数业务模块已有）。
- 规则：按服务器时钟判断 `identity.memberships.pro_plus_until > now`；账号不存在或已停用返回 `false`，不抛错，后台任务可直接调用；可传入调用方事务。
- 已接入：申请制作免费次数（plaza，用 `getMembership` 取统一时刻）、好感度加成（growth）。
- 待接入：记忆分档 / 长上下文（批 B）、角色生态（批 C）、QQ / 微信接入（插件上线时）。「新用户前 7 天按 PRO+ 记忆」不是会员，由批 B 自己按注册时间判断，不要改 `isProPlus`。

## 2. PRO+ 开通订单（billing）

- 表 `billing.membership_orders`（迁移 0104）；服务 `billing/application/membership-orders.ts`；接口 `MembershipOfferEndpoints`（用户）、`MembershipOrderAdminEndpoints`（后台）。
- 开通在一个事务里：锁用户钱包 → 按 `client_order_id` 查幂等 → 判断首次价（部分唯一索引兜底「每人一次」）→ 经 `IdentityMembershipWritePort.extendProPlus` 叠加到期时间（`max(now, 原到期) + N 个北京自然月`）→ 写订单 → 发赠送积分流水（`admin_grant`，`purpose = membership_bonus`，幂等键 `membership_order:{orderId}`）→ 审计。
- 原 `PUT /admin/users/:userId/membership` 保留，用于纠错（不记订单、不发积分）。
- 配置存 `billing.settings` 键 `membership_settings`（三档价格 / 首次价 / 赠送、联系说明、注册赠送积分）；缺省值即 16 号 §3 的价格与 0 注册赠送。

## 3. 赠送积分与充值积分分账

- `billing.accounts.bonus_balance_micros`：余额中属于赠送的部分；`billing.ledger_entries.bonus_delta_micros`：每条流水对赠送部分的变化。
- 统一在 `Ledger.postEntry` 处理（`bonusDeltaOf`）：加钱且 `bonusCredit: true` → 计入赠送；任何扣钱 → 先扣赠送；并保证 `0 ≤ 赠送 ≤ max(余额, 0)`。冻结 / 解冻不动赠送部分。
- 退款（refund）与管理员加积分按充值积分计入（不回到赠送），对账只影响「赠送 / 充值」分布，不影响总余额。
- 用户端 `Wallet.bonusPoints` 显示「含赠送积分 N」。

## 4. 注册赠送

`identity.user_registered` → `BillingLifecycle.onUserRegistered` → `MembershipOrderService.grantSignupBonus`：配置值 > 0 才发，幂等键 `signup_bonus:{userId}`，计入赠送积分。默认 0。

## 5. 模型展示倍率与「约每条积分」

- 售价 / 成本 / 缓存价沿用价目表（0101/0102 之前已有），没有新建价格表。
- `model_access.model_catalog.display_multiplier`（迁移 0103）：后台手填倍率，空 = 自动。
- 自动倍率 = (0.8×输入售价 + 0.2×输出售价) ÷ 基准模型同算式；基准模型存 `model_access.settings` 键 `display_multiplier_base`（后台可选）。
- 约每条积分（`DisplayPricingService`）：最近 7 天该模型「用户付费、聊天回复、成功」调用的平均实扣；样本 < 20 时按默认假设（2000 未命中 + 8000 命中缓存输入、200 输出）×当前售价。进程内缓存 10 分钟。
- 扣费不受倍率影响。

## 6. 申请制作免费次数（plaza，迁移 0105）

- 配置 `RoleRequestConfig`：`pointsCost`（默认 200，可调）、`lifetimeFreeCount`（默认 3）、`proPlusWeeklyFreeCount`（默认 2）。
- 计数只算 `pending / in_progress / completed` 的免费申请，所以拒绝或撤回自动退还次数。
- `free_quota_kind`：`weekly`（PRO+ 本周，北京时间周一 0 点起）或 `lifetime`；PRO+ 先用每周的。旧免费申请迁移时记为 `lifetime`。

## 7. 模型解析收口（合入 codex/model-routing-ecology 的块 A）

- 后台任务不再借用聊天模型（d1179de）。
- 行为规划：删除硬编码 `qwen/qwen3.8-flash`；后台规划设置指定了模型才传 `modelKeyOverride`，否则只用平台 `defaultFor=planner`，没有则回落规则版不扣费。
- 报价 `ModelQuoteService.quote` 改为调用同一个 `ModelResolver.resolve`（含 `hasImages`、`modelKeyOverride`），报价与执行同口径。
- 识图换模型：网关结果带 `usedVisionDefault: true`；后台不允许把「不能识图」的模型设为聊天默认，除非平台已有默认识图模型。

## 8. 好感度会员加成

`P25_FAMILIARITY.proPlusBonusRate = 2`（2026-10-20 按 16 号 §11 由 1.2 改为 2）：PRO+ 每次熟悉度加分与每日上限 ×2（向上取整）。数值可调；按消息加分见 `growth.md` 第 4 节。
