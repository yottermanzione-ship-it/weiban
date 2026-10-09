# 交接说明：D-L3-02 公开动态录入、审核与自动候选（含节日管理接口核对）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 | `T-055b-public-dynamics-backend`（已合入 `local/trunk`） |
| 测试 | **未测试**（按总经理要求不写测试、不跑测试，只保证 typecheck 通过） |

## 做了什么

1. 契约（已先行合入 local/trunk，提交 fba7d5f）：`http/public-updates.ts` 新增 `PublicUpdateAdminEndpoints`（12 个管理接口）；`ports/public-updates.ts` 新增 `PublicUpdateReadPort`。合并契约 3.0 后去重：删掉我自定义的 `WebSearchProvider` 端口，改用契约 3.0 的 `ModelGatewayMediaPort.webSearch` 形状。
2. 服务端：characters 模块新增公开动态服务、控制器、迁移 0025；model-access 新增 `WEB_SEARCH_PROVIDER`（经网关、平台账户记账）；contacts 新增内部令牌 `CONTACTS_CHARACTER_STATS`（某角色是否有人添加）；推演引擎读取已生效公开动态。
3. 节日清单（ADM-04 第 4 条）：T-052 已有完整增删改查（`HolidayAdminEndpoints`，`/api/v1/admin/proactive/holidays`），核对后无需补。
4. 说明文档：`docs/backend/public-updates.md`。

## 接口清单（全部 auth = admin）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/admin/public-updates?status&source&characterId&limit&cursor | 列表，最新在前 |
| GET | /api/v1/admin/public-updates/:updateId | 详情 |
| POST | /api/v1/admin/public-updates | 手动录入（status 可选 draft/pending/effective） |
| PATCH | /api/v1/admin/public-updates/:updateId | 编辑草稿/待审 |
| POST | /api/v1/admin/public-updates/:updateId/submit | draft → pending |
| POST | /api/v1/admin/public-updates/:updateId/approve | pending → effective，可带修改 |
| POST | /api/v1/admin/public-updates/:updateId/reject | pending → rejected，body {note} |
| POST | /api/v1/admin/public-updates/:updateId/withdraw | effective → withdrawn，body {note} |
| DELETE | /api/v1/admin/public-updates/:updateId | 删草稿/已驳回 |
| POST | /api/v1/admin/characters/:characterId/public-updates/search | 手动触发候选搜索 |
| GET / PUT | /api/v1/admin/public-updates-settings | 自动候选开关 |
| GET/POST/PATCH/DELETE | /api/v1/admin/proactive/holidays | 节日清单（T-052 已有） |

## 改了哪些文件

- packages/contracts/src/http/public-updates.ts、ports/public-updates.ts、index.ts、ports/index.ts；Android 生成物
- apps/server/drizzle/0025_public_updates.sql、.down.sql、meta/_journal.json
- apps/server/src/modules/characters/{application/public-updates.ts, http/public-updates.controller.ts, infra/db/schema.ts, characters.module.ts, tokens.ts, index.ts}
- apps/server/src/modules/model-access/{application/web-search.ts, tokens.ts, index.ts, model-access.module.ts}
- apps/server/src/modules/contacts/{application/read.ts, tokens.ts, index.ts, contacts.module.ts}
- apps/server/src/modules/ai-runtime/application/simulation.ts
- apps/server/src/app.module.ts
- docs/backend/public-updates.md

## 遗留问题

- 未写测试、未跑测试、未跑迁移；需要 Codex 验收时重点看状态机并发、去重、平台记账。
- 搜索暂由模型网关「让模型返回 JSON 结果」实现，假上游下返回内容不保证真实；接入真实搜索 API 后替换 `GatewayWebSearchProvider` 即可。L5 实现完整 `ModelGatewayMediaPort` 时应让它接管 `WEB_SEARCH_PROVIDER`。
- 定时搜索用「第一个管理员账号」作为平台记账发起人，是网关「平台计费调用方必须是管理员」规则下的权宜做法。
- `hasAnyActiveContact` 是 contacts 的服务器内部令牌，不是契约端口；如架构认为应进 `ContactsReadPort`，需走变更申请。
- 契约版本号未单独升（契约 3.0 合并时已涵盖）；契约 3.0 的 map 已把 0025–0029 划给本任务，本任务只用了 0025。
- 公开动态目前只接入推演；聊天上下文、时间线「公开资料」条目、主动分享素材（SIM-03 第 3 条）还需 AI 负责人通过 `PUBLIC_UPDATE_READ_PORT` 接入。
- T-055 卡片写的状态是「草稿 → 待审核 → 已发布 / 已拒绝」，接口里对应 draft → pending → effective / rejected，另有 withdrawn（撤回，ADM-03 第 4 条）。卡片说节日「可按角色分类筛选」，但节日清单是全局的，PRD 无此要求，未做。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 web-lead（T-055）：按上表接口做页面；错误码 409 conflict = 状态不允许 / 被并发改动，提示刷新。候选来源 `source = auto_search` 时显示来源链接。T-055 卡里提到的 T-052 公开动态接口实际不存在，以本说明为准。
- 给 ai-lead：`PUBLIC_UPDATE_READ_PORT` 可注入（characters 导出），用于聊天上下文、时间线和主动分享；推演已接入。
- 给 architect：请确认 `WEB_SEARCH_PROVIDER` 与 3.0 `ModelGatewayMediaPort` 的关系，以及 contacts 内部令牌是否需要升为端口。
