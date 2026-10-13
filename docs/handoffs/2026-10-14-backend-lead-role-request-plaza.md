# 交接说明：角色广场两个 tab 与「申请制作」后端配套（总经理 10-14 裁定 2.3）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-14 |

## 做了什么

1. **角色广场「微伴角色」tab**：官方预设角色也能点赞、评论、查看基本人设（简介 / 性格 / 说话方式 / 少量口头禅，截断后的摘要，不暴露完整提示词）。「添加」继续走现有添加流程 `POST /api/v1/contacts`。「自定义角色」tab 就是现有人设广场接口，不变。
2. **角色创建 › 申请制作**：用户提交制作申请（角色名、类型、分类、出处、参考文字、参考图、补充说明），查看自己的申请与状态（待处理 / 制作中 / 已完成 / 已拒绝 / 已撤回，附管理员留言）；管理员后台列表处理（接单、填进度、完成并关联已上架角色且默认自动加到用户通讯录、拒绝）。
3. **红点与推送**：申请状态变化时发 `data.changed(section = role_requests, itemId = requestId)`，并推送一条系统通知（标题「角色制作申请」，deepLink `/role-requests/{requestId}`）。官方角色评论被回复时写广场通知（与作品评论相同，不推送）。
4. **扣积分预留**：配置 `pointsCost`（默认 0）；申请上记录 `pointsCost`（提交时价格）和 `pointsCharged`（目前恒为 0），**不扣**。
5. 契约升到 3.5（全部向后兼容），迁移 0090，已重生成 Android 生成物（`pnpm android:generate:check` 通过）。按要求未写、未跑测试；typecheck / lint / prettier / server build 通过。

## 接口清单（给网页 / 后台）

前缀均为 `/api/v1`。

### 角色广场（网页一个页面两个 tab）

| tab | 方法 | 路径 | 说明 |
|---|---|---|---|
| 自定义角色 | — | 现有 `/plaza/works…` 全套 | 不变 |
| 微伴角色 | GET | `/plaza/official?q=&categoryId=&sort=hot\|most_liked\|default&cursor=&limit=` | 列表，`items[].character` 是 CharacterSummary（含 `added`），另有 `likeCount / commentCount / likedByMe` |
| 微伴角色 | GET | `/plaza/official/:characterId` | 详情：`character`（CharacterProfile）+ `persona`（summary / personality / speechStyle / catchphrases） |
| 微伴角色 | POST / DELETE | `/plaza/official/:characterId/like` | 点赞 / 取消，幂等，返回 `{likeCount, likedByMe}` |
| 微伴角色 | GET | `/plaza/official/:characterId/comments?cursor=` | 评论（PlazaComment，时间正序） |
| 微伴角色 | POST | `/plaza/official/:characterId/comments` | `{clientRequestId, text, replyToCommentId?}`；未设广场昵称 409 conflict（先 `PUT /plaza/me/profile`）；停权 403 |
| 微伴角色 | DELETE | `/plaza/comments/:commentId` | **复用**原接口，官方角色下的评论只有本人能删 |
| 微伴角色 | POST | `/contacts` | 「添加」，复用现有添加流程 |
| 分类 | GET | `/characters/categories` | 分类筛选项（现有） |

### 申请制作（用户端）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/role-requests/config` | `{enabled, pointsCost, maxOpenPerUser}`；enabled=false 时入口提示未开放 |
| POST | `/media`（purpose = `role_request_image`） | 先上传参考图（最多 9 张） |
| POST | `/role-requests` | `{clientRequestId, roleName, basis?, categoryId?, sourceWork?, referenceText?, referenceImageIds?, note?}`；幂等；关闭 403；未完成申请达上限 409 |
| GET | `/role-requests?cursor=&limit=` | 我的申请（最新在前）+ `unseenCount`（「角色创建」入口红点） |
| GET | `/role-requests/:requestId` | 详情，查看即清该条红点 |
| POST | `/role-requests/:requestId/cancel` | 撤回（只有 pending） |
| POST | `/role-requests/seen` | 打开「我的申请」列表后清全部红点 |

实时：收到 `data.changed` 且 `section = role_requests` 时重新拉 `GET /role-requests`。推送点开跳 `/role-requests/{requestId}`，网页需要这个路由（申请详情页）。

### 管理后台

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/role-requests?status=&userId=&cursor=&limit=` | 列表 + `pendingCount`（菜单红点）；status=pending 时最早在前 |
| GET | `/admin/role-requests/:requestId` | 详情（参考图短期链接、`username`、`history` 历次状态与留言） |
| POST | `/admin/role-requests/:requestId/accept` | `{message?}` 接单 → in_progress |
| POST | `/admin/role-requests/:requestId/progress` | `{message}` 填进度（pending 自动转 in_progress） |
| POST | `/admin/role-requests/:requestId/complete` | `{characterId, message?, addToContacts=true}`；角色须是已上架预设角色（先在「角色库」建好并上架），否则 422 character_not_available |
| POST | `/admin/role-requests/:requestId/reject` | `{message}` 拒绝，原因展示给用户 |
| GET / PUT | `/admin/role-requests/config` | `{enabled, pointsCost, maxOpenPerUser}` |
| GET | `/admin/plaza/official/comments?characterId=&cursor=` | 官方角色下的评论（最新在前） |
| POST | `/admin/plaza/comments/:commentId/delete` | **复用**原接口，也能删官方角色下的评论 |

## 以后怎么接扣积分

1. 提交时（`RoleRequestService.create`，事务内）若 `config.pointsCost > 0`：调用 billing 的扣费端口（按 ADR-0032 的积分流水，用途建议新增 `role_request`），幂等键用 requestId，成功后写 `points_charged = pointsCost`；余额不足返回 `insufficient_balance`。
2. 拒绝 / 撤回时若 `points_charged > 0`：经 billing 退款（幂等键 `requestId:refund`），可再加一列 `points_refunded`。
3. 扣法定了以后（提交即扣 / 完成才扣），只改上面两个点；契约字段已经在，不用改接口。

## 改了哪些文件

- 契约：`packages/contracts/src/http/plaza.ts`、`http/role-requests.ts`（新）、`http/media.ts`、`http/sync.ts`、`ports/characters.ts`、`index.ts`、`version.ts`（3.5）、`README.md`
- 服务器：`apps/server/src/modules/plaza/`（`application/plaza-official.service.ts`、`application/role-requests.service.ts`、`http/plaza-official.controller.ts`、`http/role-requests.controller.ts` 均为新；改 `plaza.module.ts`、`plaza.controller.ts`、`plaza-admin.service.ts`、`plaza-lifecycle.ts`、`infra/db/schema.ts`）、`apps/server/src/modules/characters/application/plaza-port.ts`
- 迁移：`apps/server/drizzle/0090_plaza_official_role_requests.sql` / `.down.sql`、`meta/_journal.json`
- Android 生成物：`apps/android/core/contracts-generated/…`（Contracts.kt、Endpoints.kt、contracts.json）
- 文档：`docs/backend/plaza-implementation.md`（3.5 补充）、本文件

## 遗留问题

- 按要求没有写测试，新接口目前没有自动化测试，等验收阶段补。
- 申请内容（参考文字）是明文存储（用户本来就是提交给官方看的）；参考图只有本人和经详情取链接的管理员能看。
- 「微伴角色」排序在内存里做，预设角色上千个时再改成 SQL 计数表。
- 官方角色评论暂不支持举报（作品举报表结构绑定作品），管理员可在后台直接删除。

## 需要总经理决定的事

- 申请制作以后怎么扣积分（提交即扣还是完成才扣、多少积分）：目前预留为 0，不影响上线。

## 给其他负责人的交接

- 给 web-lead：按上面「角色广场」「申请制作」接口做一页两 tab 与申请表单 / 我的申请 / 申请详情（路由 `/role-requests/:id`，推送 deepLink 会跳这里）；参考图上传用 purpose `role_request_image`；监听 `data.changed(role_requests)` 刷新红点。
- 给后台（admin）实现者：新增「制作申请」菜单（列表 + 详情 + 接单 / 进度 / 完成选角色 / 拒绝 + 配置），完成时的角色选择器用现有 `/admin/characters` 列表筛已上架预设角色；「广场管理」可加官方角色评论列表。
- 给 android-lead：生成物已更新（契约 3.5，新增 DataSection `role_requests`、MediaPurpose `role_request_image`），推送 deepLink `/role-requests/{id}` 若安卓端要原生处理需配置。
