# 交接说明：批 A 会员与计价 v5

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（本批全栈：server + contracts + web + admin） |
| 日期 | 2026-10-20 |
| 分支 / 目录 | `v5-membership` / `C:\wb-dev\wb-v5-member`（从 local/trunk 9b647d6 建，已合入 local/trunk 4f39ad2） |
| 依据 | `docs/tasks/2026-10-19-v5-batches.md` 批 A、`docs/refactor/16-membership-v5.md` |
| 实现说明 | `docs/backend/membership-v5.md` |

## 做了什么

1. **统一「是否 PRO+」**（最先提交，cd8e8c0）：契约 `IdentityMembershipReadPort.isProPlus(userId, tx?)`，用法见实现说明第 1 节。
2. **合入 `codex/model-routing-ecology`（d1179de）并完成块 A**：后台任务不借用聊天模型；删除硬编码规划模型；报价与执行共用 `ModelResolver.resolve`；识图换模型时结果带 `usedVisionDefault`，后台禁止把不能识图的模型设为聊天默认（除非已有默认识图模型）。
3. **模型计价**：售价 / 成本 / 缓存价复用现有价目表（0101/0102 之前已覆盖，未新建表）；新增展示倍率（后台手填或按基准模型自动算），基准模型后台可选；扣费仍按实际 token × 售价。
4. **用户端模型选择 / 价格页**：显示「×倍率 · 约每条 X 积分」，约每条按最近 7 天平均实扣，不足 20 条样本时按默认假设估算。
5. **PRO+ 档位与开通**：月 / 季 / 年卡，原价与首次价（每人一次），一次性赠送 3000 / 9000 / 30000 积分；后台替用户开通（记订单、价格、是否首次，到期叠加，同一事务发积分，幂等）。钱包区分赠送积分（先扣赠送）。
6. **注册赠送**：后台可配，默认 0。
7. **旧会员逻辑**：新代码里没有「默认模型不限量 / 每天 500 条 / Free-Plus-Pro / 老会员迁移」的实现，无需删除；群聊、语音、电话、切换模型、私密模式经检查都没有会员门槛。旧的「免费每月 5 次 / PRO+ 每周 5 次」申请制作规则已替换。
8. **会员门槛**只通过 `isProPlus` 提供；QQ / 微信（插件仍是「即将上线」）、生态（批 C）、长上下文与记忆（批 B）由各批接入。
9. **申请制作**：免费终身 3 次；PRO+ 终身 3 次 + 每周 2 次（先用每周的）；用完 200 积分 / 次；拒绝 / 撤回退还次数与冻结积分；次数和价格后台可调。
10. **权益页**（网页 `/membership`，入口：我 › 服务 › PRO+ 会员、积分页）：价格卡、两列 Free / PRO+ 对照、「需积分」标签、「所有 AI 回复按积分计费，开通即送积分」；没有诱导开通的文案。好感度加成写进权益页，并实现为 PRO+ ×1.2。
11. **后台**：「会员与订单」重做（开通、订单列表、价格 / 赠送 / 注册赠送配置、纠错用的手动改到期）；「模型」页加展示倍率列、编辑项、基准模型选择；「制作申请」加次数与价格设置。

## 提交号

`cd8e8c0`（isProPlus）· `f9a18ab`（块 A）· `c402e76`（订单 / 分账 / 迁移）· `7ec88d2`（申请制作）· `bb0841d`（倍率）· `9ba8379`（好感度、网页倍率）· `c321067`（网页会员页）· `aa489a4`（后台）· `a8ed8c8`（契约记录与安卓生成）· `9d71d64`（格式）· `aae1445`（合入主线）· `2394ec1`（合并修复）· `f439c43`（自查修正）· 本交接提交。

## 改了哪些文件（主要）

- 契约：`packages/contracts/src/ports/identity.ts`、`ports/model-gateway.ts`、`http/membership.ts`、`http/billing.ts`、`http/model-access.ts`、`http/role-requests.ts`、`version.ts`（3.17）、`README.md`；安卓生成物 `apps/android/core/contracts-generated/**`
- 迁移：`apps/server/drizzle/0103_model_display_multiplier`、`0104_membership_orders`、`0105_role_request_quota_v5`（各含 `.down.sql`）、`meta/_journal.json`
- 后端：identity `application/membership.ts`、`tokens.ts`、`identity.module.ts`、`index.ts`；billing `application/ledger.ts`、`membership-orders.ts`（新）、`lifecycle.ts`、`wallet.ts`、`http/membership.controller.ts`（新）、`billing.module.ts`、`infra/db/schema.ts`；model-access `application/resolver.ts`、`catalog.ts`、`gateway.ts`、`models.ts`、`display-pricing.ts`（新）、`domain/rules.ts`、`http/model-access.controller.ts`、`model-access.module.ts`、`infra/db/schema.ts`；plaza `application/role-requests.service.ts`、`infra/db/schema.ts`；growth `application/growth.service.ts`；ai-runtime `application/planner.ts`；`platform/config/product-params.ts`
- 网页：`features/membership.tsx`（新）、`wallet.tsx`、`me.tsx`、`role-plaza.tsx`、`app/app.tsx`、`app/pages-old.css`
- 后台：`features/membership.tsx`、`model/models.tsx`、`role-requests.tsx`、`accounts.tsx`
- 文档：`docs/backend/membership-v5.md`（新）、本交接

## 自查结果

- 合入主线后：server / web / admin / contracts typecheck 通过；server / web / admin build 通过；`pnpm android:generate:check` 通过（契约 3.17，1412 个定义）；`lint:deps` 无违规；本批改动文件 eslint 无新问题（`apps/web/src/app/app.tsx` 有 2 个主线原有的未使用变量报错，不是本批引入）；prettier 已格式化本批新文件（3 个后台文件原本就未格式化，未整体重排以免无关改动）。
- 没有写新测试、没有跑测试套件；服务器测试随 typecheck 一起编译通过。
- **浏览器**：本机没有 Postgres，唯一可用的数据库是 3000 服务连接的香港临时库 DR-001，任务卡要求不碰香港服务器，所以**没有跑真实后端、没有执行迁移**。改为用假接口数据的临时预览页（已删除，未入库）在浏览器里实际打开：网页会员页（375 宽，价格卡、权益表、点「月卡」弹出联系管理员）、积分页（含赠送积分一行）、AI 模型价格页（倍率 + 约每条）；后台「会员与订单」（查询用户、开通表单、订单表、配置表单）。自查中修了 3 处显示问题（f439c43）。截图在 `C:\wb-dev\logs\v5-membership\`。
- **未验证**：真实接口、迁移 0103–0105 执行与回滚、开通事务与并发、赠送积分扣减顺序、注册赠送、近 7 天平均估算、申请制作次数的真实计数、后台模型页倍率列（只做了类型检查）。

## 遗留问题

- 对账第 ① 层还没核对「赠送余额 = 赠送变化量合计」（不影响总余额核对）。
- 退款与管理员加积分一律记为充值积分，不会退回成赠送积分。
- 识图换模型「界面提示一次」：后端已给出 `usedVisionDefault`，网页还没有展示。
- 权益页里记忆的数字（3 / 16 条、30 条、7 天、3 / 8 条）是写死的，与 16 号一致；批 B 若把它们做成后台可调，权益页应改为读接口。
- 身份类权益（会员标识、专属主题 / 气泡、表情会员款）尚未实现，权益页未列出，避免承诺做不到的事。
- 管理员替用户开通后只能用「扣积分」+「手动改到期」撤销，没有「退订单」功能。
- 契约 `RoleRequestQuota.limit / nextPointsCost`、`expectedPointsCost` 从固定值放宽为整数，按次版本处理（安卓未发布），请总负责人确认。
- 规划模型：后台规划设置未指定模型、平台也没有 `defaultFor=planner` 时，规划回落规则版（不扣费）；上线前需在后台设好规划模型。

## 需要总经理决定的事

- 注册赠送积分数额（现默认 0，后台可直接改）。
- 好感度会员加成数值：现按「轻微」取 ×1.2（旧版 ×1.45）。另外 `docs/refactor/01-old-weiban-review.md` 曾写「不按会员加速」，与任务卡 / 11 号 C8「保留加成」冲突，本批按任务卡执行，请确认 01 号该条作废。

## 给其他负责人的交接

- 给 ai-lead（批 B 记忆分档）：把临时判断函数换成 `IdentityMembershipReadPort.isProPlus`（注入 `IDENTITY_MEMBERSHIP_READ_PORT`，见实现说明第 1 节）；「新用户前 7 天」按注册时间自己判断。
- 给批 C（生态）：同上用 `isProPlus` 做 PRO+ 门槛；生态扣费会自动先扣赠送积分，无需特殊处理。
- 给总负责人：迁移只占用 0103–0105（0106 未用）；合并时契约版本冲突以最终递增为准；部署前需在正式库按流程执行迁移（先备份）。
- 给 web-lead：`/membership` 页与「服务」「积分」页入口已加；识图换模型提示待做。
- 给 android-lead：契约 3.17 已生成；原生端如做会员页，接口为 `GET /api/v1/me/membership/offer`。
