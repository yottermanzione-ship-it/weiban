# 公告与更新说明（实现说明）

契约：`packages/contracts/src/http/announcements.ts`（3.2）。代码：`apps/server/src/modules/identity/application/announcements.ts`、`http/announcements.controller.ts`。表：迁移 `0086_announcements_release_notes.sql`（identity schema）。

## 1. 旧版怎么做的（`C:\wb-ref\old-weiban`，只读调研）

| 能力 | 旧版做法 | 问题 |
|---|---|---|
| 公告 | `official_announcement_service.js`：管理员选「全部 / 会员档位 / 点选账号」，发送时给**每个人各写一条**「小 V」官方角色的主动消息（`proactive_messages`，`message_kind = announcement`），另记 `official_announcement_recipients` | 发出去就改不了、撤不回；发送之后注册的人收不到；人数多时一次写 N 行；没有已读回执（只有「送达」）；没有生效时间、置顶、目标平台；公告和聊天消息混在一起 |
| 版本更新 | `app_config_store.js`：一行 JSON 配置（最新版本、构建号、最低支持构建号、软更新 / 强制更新开关、禁用版本、更新说明、下载地址、定向测试通道）。客户端 `app_update_service.dart` 启动查一次，按「上次以后再说的构建号」决定是否再弹 | 更新说明只有「最新版本」一段，跳过中间版本的人看不到；`soft_update` / `force_update` / `min_supported_build` / `disabled_versions` 四个开关组合容易配错（旧版就因为关了软更新导致 has_update 失真）；安装包内外版本号错位过一次；网页版完全不提示 |
| 本版新功能 | 没有（只有「发现新版本」弹窗里的那段说明） | 用户更新后不知道多了什么 |

## 2. 新版做法

### 公告

- 一条公告一行记录（`identity.announcements`），状态 `draft → published ⇄ withdrawn`。用户端拉取时按「已发布 + 在生效期内（startsAt / endsAt）+ 平台匹配」**实时筛选**：可编辑、可撤回，新用户也能看到，不会一次写 N 行。
- 已读回执单独一张表（`announcement_reads`），存服务器，**多端同步**；编辑时可选 `resetReads` 让所有人重新看到（含弹窗）。
- 字段：标题、正文（纯文本）、目标平台（空 = 全部）、生效 / 结束时间、是否弹窗、是否置顶。
- 不复用聊天：公告不是某个角色说的话，独立成一块，避免和「官方角色」概念绑死（旧版调研建议的「官方账号参与者」以后要做时可以在此基础上加）。
- 首版不做按人群定向（新版是个人项目、没有会员档位）；需要时在表上加 audience 字段即可。

### 更新说明与版本

- 更新说明按（平台, 版本号）逐条存（`release_notes`），同平台同版本号唯一。
- 「本版新功能」：服务器记住每个用户在每个平台**看过的最高版本号**（`release_note_seen`，只前进）。`GET /app/release-notes` 返回 `whatsNew` = 上次看过之后到当前版本的全部说明（最多 5 条），所以跳过版本也不会漏；看过后调 `POST /app/release-notes/seen`，同一账号的其他设备也不再弹。从没看过时只弹当前版本这一条。
- 版本策略每个平台一行（`app_version_policies`）：最新版本名 / 版本号、下载地址、**最低可用版本号**、强制更新文案。只有一个判断规则：当前版本号 < 最低可用 → `updateRequired`（不可关闭）；< 最新 → `updateAvailable`。后台保存时校验最低可用不能高于最新，避免把所有人锁死。
- `GET /app/version-check` 不需要登录（登录页也能提示强制更新）。
- 版本号：安卓用 `versionCode`；网页用构建号（整数，每次部署递增，需要 Web 负责人在构建时注入）。

## 3. 数据与删除

- `announcement_reads`、`release_note_seen` 外键指向 `identity.users`，账号删除时级联删除；`DeletionService.countWith` 已把两张表计入 identity 的剩余条数。
- 管理操作全部写审计（module = identity，action = `announcement.*`、`release_note.*`、`app_version_policy.updated`）。

## 4. 已知限制

- 发布公告不主动推送到在线客户端（没有 WebSocket 广播），客户端在打开应用和回到前台时拉取即可；以后需要实时再加广播帧。
- 公告列表最多返回 50 条，更新说明最多 20 条。
