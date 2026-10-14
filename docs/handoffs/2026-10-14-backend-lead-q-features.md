# 交接说明：总对照表 Q 清单后端（Q5、Q9 / Q11、Q2、Q10）

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人 |
| 日期 | 2026-10-14 |

来源：`docs/refactor/08-master-map.md` 1.2 节，总经理选择「除 Q4 外都按推荐」。按要求不写测试、不跑测试，只保证 typecheck / lint / build 通过。分两批：第一批 Q5 + Q9（契约 3.8，迁移 0092），第二批 Q11 + Q2 + Q10（见下文「第二批」）。

## 做了什么

### 第一批

**Q5 申请制作扣积分（每次 200 积分 = 2 元）**

- billing 新增服务费端口 `BillingServiceFeePort`（冻结 / 扣除 / 退回，全部幂等），表 `billing.fee_holds`。服务费冻结**不过期**，和模型调用冻结分开；对账「held = 有效冻结合计」已把它算进去。
- 申请制作：提交时冻结 `pointsCost` 积分，可用积分不足直接 422 `insufficient_balance`（提示「积分不足：申请制作需要 200 积分」，`details.pointsCost`），不建申请；完成时扣除，`pointsCharged = pointsCost`；被拒或用户撤回时退回。
- 扣除 / 退回在状态变化提交后调用，失败只记日志，由每 10 分钟的清扫任务 `plaza.role_request_fee_sweep` 补做，钱不会卡在冻结里。
- 默认价格改为 200 积分；迁移把已存在、价格为 0 的配置改成 200。改价只影响之后的新申请（申请上记着提交时的价格）。
- 积分明细里这笔扣费的分类是新增的 `service`，note 为「申请制作：角色名」。

**Q9 帮助与反馈、投诉**

- 新模块 `support`（中层，schema `support`），说明见 `docs/backend/support.md`。
- 用户：提交反馈（类型、文字、最多 9 张截图、可选关联会话 / 角色）或投诉（对象 = 角色 / 广场作品、原因、文字可空、截图）；查看自己的列表和详情；未解决时可补充说明。
- 后台：列表（按种类 / 状态 / 用户 / 投诉对象筛选，带待处理数）、详情、回复（可同时标记解决）、标记已解决、重新打开；都写审计。
- 红点 + 推送：管理员回复或标记解决 → 用户红点（`data.changed(section = support)`）+ 系统推送（deepLink `/support/tickets/{id}`）。
- 防刷：同一用户 24 小时最多 20 条；幂等键 `clientRequestId`。注销时删除工单和截图。

## 接口清单（给网页 / 管理后台）

### 申请制作（字段不变，行为变化）

| 接口 | 变化 |
|---|---|
| `GET /api/v1/role-requests/config` | `pointsCost` 默认 200 |
| `POST /api/v1/role-requests` | 新增错误 422 `insufficient_balance`（`details.pointsCost`）；成功即冻结积分 |
| `POST /api/v1/role-requests/:id/cancel` | 退回积分 |
| 后台 `POST /api/v1/admin/role-requests/:id/complete` | 扣除积分（返回里 `pointsCharged` 变为价格） |
| 后台 `POST /api/v1/admin/role-requests/:id/reject` | 退回积分 |
| 后台 `GET/PUT /api/v1/admin/role-requests/config` | 价格默认 200 |

网页建议：提交页按钮旁显示「需要 200 积分，提交后先冻结，做好才扣，被拒或撤回会退回」；收到 `insufficient_balance` 时提示并给「去充值」入口。积分明细分类名表加 `service: '申请制作'`（`apps/web/src/features/wallet.tsx`、`usage.tsx` 的 `categoryNames`）。

### 帮助与反馈、投诉（新增，契约 `http/support.ts`）

用户端 `SupportEndpoints`：

| 接口 | 用途 |
|---|---|
| `POST /api/v1/media`（`purpose = support_image`） | 先上传截图 |
| `POST /api/v1/support/tickets` | 提交反馈 / 投诉（`clientRequestId` 幂等） |
| `GET /api/v1/support/tickets?kind=&cursor=&limit=` | 我的列表，带 `unseenCount`（入口红点） |
| `GET /api/v1/support/tickets/:ticketId` | 详情，查看即清该条红点 |
| `POST /api/v1/support/tickets/:ticketId/replies` | 补充说明 |
| `POST /api/v1/support/tickets/seen` | 清全部红点 |

管理端 `SupportAdminEndpoints`：

| 接口 | 用途 |
|---|---|
| `GET /api/v1/admin/support/tickets?kind=&status=&userId=&targetId=` | 列表，带 `openCount`（菜单红点） |
| `GET /api/v1/admin/support/tickets/:ticketId` | 详情（截图短期链接） |
| `POST /api/v1/admin/support/tickets/:ticketId/reply` | 回复，`resolve: true` 同时标记解决 |
| `POST /api/v1/admin/support/tickets/:ticketId/resolve` | 标记已解决 |
| `POST /api/v1/admin/support/tickets/:ticketId/reopen` | 重新打开 |

同步：收到 `data.changed` 且 `section = support` 时重新拉列表 / 红点。推送 deepLink `/support/tickets/{id}` 需要网页路由。

## 改了哪些文件

第一批：

- 契约：`packages/contracts/src/ports/billing.ts`、`http/billing.ts`、`http/role-requests.ts`、`http/support.ts`（新）、`http/media.ts`、`http/sync.ts`、`events.ts`、`index.ts`、`version.ts`（3.8）、`README.md`
- billing：`application/service-fees.ts`（新）、`application/reconciliation.ts`、`domain/rules.ts`、`infra/db/schema.ts`、`billing.module.ts`、`tokens.ts`、`index.ts`
- plaza：`application/role-requests.service.ts`、`application/plaza-lifecycle.ts`、`infra/db/schema.ts`、`plaza.module.ts`
- support（新模块）：`apps/server/src/modules/support/**`；装配 `apps/server/src/app.module.ts`；登记 `packages/eslint-config/architecture.js`
- 迁移：`apps/server/drizzle/0092_service_fees_support.sql`、`.down.sql`、`meta/_journal.json`
- 安卓生成物：`apps/android/core/contracts-generated/**`
- 文档：`docs/backend/billing.md`（契约 3.8 节）、`docs/backend/support.md`（新）

## 遗留问题

- 按要求没有写测试、没有跑测试（服务费端口、申请制作扣费、工单流程都需要 Codex 验收时补测）。
- 投诉只存对象类型 + ID，后台列表不显示角色名 / 作品名（需要时可由后台按 ID 跳转查看，或之后加名称查询端口）。
- 人设广场原有「举报」（plaza reports）与新「投诉」并存：广场作品页如果已经有举报入口，网页需要决定用哪个；建议资料页「投诉」用新接口，广场作品继续用原举报（会触发下架流程），两者后台分开看。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给架构：新增中层模块 `support`（schema `support`）与契约 3.8，请在 `docs/architecture/overview.md` 模块表补登记（我只改了 `packages/eslint-config/architecture.js`）。
- 给网页：见上面接口清单；设置 › 帮助与反馈页、我的反馈列表 / 详情、资料页「投诉」弹层；提交申请制作前显示价格。
- 给管理后台：新增「反馈与投诉」菜单（列表、详情、回复、解决）；申请制作配置页价格默认 200。
- 给安卓：契约生成物已重新生成（3.8）。
