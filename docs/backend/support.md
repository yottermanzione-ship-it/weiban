# support 模块：帮助与反馈、投诉、插件入口

> 负责人：后端负责人 · 2026-10-14 · 来源：总经理在 `docs/refactor/08-master-map.md` 1.2 节确认的 Q9（帮助与反馈 / 投诉）、Q10（插件入口）。契约 `packages/contracts/src/http/support.ts`（3.8 起）。

## 1. 位置

- 中层模块，schema `support`（已登记 `packages/eslint-config/architecture.js`），只依赖底层：identity（后台显示用户名）、media（截图）、push（回复通知）、realtime（红点同步）。
- 投诉对象只存类型 + ID（`character` / `plaza_work`），不读 characters / plaza 的表；后台按 ID 去对应页面查看。

## 2. 工单（tickets）

- 一张表 `support.tickets` 同时存反馈（`kind = feedback`，必填 `category`、文字）和投诉（`kind = complaint`，必填 `target`、`reason`，文字可空，空时填原因名）。
- 截图：先 `POST /media`（`purpose = support_image`），最多 9 张；只有本人可读，管理员经详情拿短期链接。
- 状态：`open` →（管理员回复）`replied` / `resolved`；用户补充说明回到 `open`；管理员可 `reopen`。
- 回复与补充说明存在 `replies` jsonb 里（每条最多 40 条往来），管理员回复时记管理员 ID（不返回给用户）。
- 红点：管理员回复 / 标记解决时置 `user_unseen`，发 `data.changed(section = support, itemId = ticketId)`；用户打开详情清该条、打开列表调 `POST /support/tickets/seen` 清全部。
- 推送：管理员回复 / 标记解决后（事务提交后）发 `system` 推送，deepLink `/support/tickets/{id}`，失败只记日志。
- 幂等：`clientRequestId`（同一用户唯一）。防刷：同一用户 24 小时内最多 20 条（429 `rate_limited`）。
- 审计：管理员回复、解决、重新打开都写 `platform.audit_log`（`module = support`）。
- 注销：删除清单登记 `support`，删除该用户全部工单和截图。

## 3. 插件入口（Q10）

见本文件第 4 节（第二批补充）。
