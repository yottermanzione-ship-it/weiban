# 账号模块 identity 实现说明（apps/server/src/modules/identity）

> 负责人：后端负责人 · v1.0 · 2026-10-05 · 来源任务：T-018（D-L0-06）
> 读者：要用登录身份、资料、设置的其他模块负责人；运维（命令行脚本）；质量负责人。
> 规则来源（本文不重复）：接口以 `packages/contracts/src/http/identity.ts` 为准；安全规则 `docs/architecture/security-and-privacy.md` 第 2、5 节；ADR-0006；内核用法 `docs/backend/kernel.md`。

## 0. 一句话

用户凭**邀请码**注册，用**用户名 + 密码**登录，每台设备一个**会话令牌**；可以查看和踢掉登录设备、改资料、通知设置和主题（主题会同步到所有设备）；管理员有独立的**管理会话**生成邀请码；第一个管理员和忘记密码靠服务器上的**命令行脚本**；注销账号由本模块编排各模块的**删除清单**。

## 1. 目录

| 位置 | 内容 |
|---|---|
| `index.ts` | 公开出口：`IdentityModule`、`IDENTITY_READ_PORT`、`IdentityCommands`、`CommandError` |
| `testing.ts` | 测试出口：`IdentityTestQueries`（只读本模块表）、默认值常量 |
| `domain/rules.ts` | 纯规则：会话期限、登录锁定、密码强度、邀请码格式、时区校验、令牌生成与哈希 |
| `infra/db/schema.ts` | 表定义（schema `identity`），迁移 `drizzle/0001_identity.sql` + 手写回滚 |
| `infra/password-hasher.ts` | argon2id 哈希 |
| `infra/login-throttle.ts` | 登录失败计数与锁定 |
| `application/` | `accounts`（注册、登录、退出、注销申请）、`sessions`（会话，实现 `SessionVerifier`）、`settings`（资料、通知、偏好，实现 `IdentityReadPort`）、`invites`、`deletion`（注销编排）、`commands`（命令行） |
| `http/identity.controller.ts` | 契约 `IdentityEndpoints`、`IdentityAdminEndpoints` 的全部 14 个接口 |
| `src/cli/identity.ts` | 命令行入口（第 7 节） |

## 2. 接口与状态码

接口定义、字段、错误码以契约为准。下表只写契约没写死、由后端决定的部分：

| 接口 | 成功 | 说明 |
|---|---|---|
| `POST /auth/register` | 201 新建；200 重试 | 同一次注册重发（同用户名 + 同密码 + 已被这个用户名用掉的邀请码）视为重试：不建新账号，给这台设备发一个新会话 |
| `POST /auth/login` | 200 | `kind: admin` 只给 `role = admin` 的账号，否则 403 `forbidden`（不计入失败次数） |
| `POST /auth/logout` | 204 | 重复退出 → 401（令牌已失效） |
| `DELETE /me/sessions/:id` | 204 | 别人的会话或已下线 → 404（不暴露是否存在） |
| `PATCH /me/profile`、`/me/notification-settings`、`/me/preferences` | 200 | 只改传了的字段；与原值相同的修改不写库、不发事件 |
| `DELETE /me` | 202 | 密码错 → `invalid_credentials` **403**（不用默认的 401，避免客户端误以为登录失效而退出）|
| `POST /admin/invites` | 201 | 支持请求头 `Idempotency-Key`（8–128 位字母数字 `-` `_`），同一管理员同一个 key 返回同一个码 |

其他错误：被锁定 `account_locked` 429；注册时 IP 被锁 `rate_limited` 429；参数不合法（含不认识的 IANA 时区）400 `bad_request`，`details.issues` 只给字段路径。

## 3. 表（schema `identity`）

| 表 | 主要字段 | 说明 |
|---|---|---|
| `users` | `username`（不区分大小写唯一）、`password_hash`（argon2id）、`role` user/admin、`status` active/deleting、`last_active_at`、`deletion_requested_at` | |
| `sessions` | `user_id`、`kind` app/admin、`token_hash`（SHA-256，唯一）、`device`（契约 DeviceInfo）、`last_active_at`、`expires_at` | 作废 = 删行 |
| `profiles` / `notification_settings` / `preferences` | 每用户一行 | 注册时写默认值 |
| `invites` | `code`（大写无连字符）、`expires_at`、`used_at`、`used_by`、`created_by`、`idempotency_key` | 用户删除后 `used_by` 置空，`used_at` 保留（码仍算已用） |
| `login_throttle` | `key`（sha256 的用户名或 IP，库里不存 IP 原文）、`failures`、`last_failed_at`、`locked_until` | |
| `deletion_progress` | `(user_id, module)`、`deleted_rows` | 注销进度 |

谁写谁读：全部只由 identity 读写；其他模块通过 `IDENTITY_READ_PORT`（读资料、通知设置、最近活跃时间）和事件。外键只在本 schema 内部。

## 4. 账号与会话规则

| 项 | 实现 |
|---|---|
| 密码哈希 | argon2id，`@node-rs/argon2`（Rust 预编译，Windows / Linux / Alpine 都不需要本机编译）；参数：内存 19 MiB、迭代 2、并行 1（OWASP 基线）。PHC 字符串自带参数和盐，以后调高参数旧哈希仍可校验 |
| 密码强度 | 契约限 10–128 位；另拒绝：包含用户名、不同字符少于 5 个、常见弱密码 → `password_too_weak` |
| 用户名探测 | 用户名不存在时也做一次同样耗时的哈希校验；错误提示统一「用户名或密码错误」 |
| 登录锁定 | 同一用户名或同一 IP 连续 5 次失败锁 15 分钟；锁定期间正确密码也拒绝且不校验密码；成功登录清零；距上次失败 15 分钟以上旧计数作废。注册时邀请码错误也计入该 IP |
| 客户端 IP | Express `req.ip`；**在 Caddy 后面必须配 `HTTP_TRUST_PROXY`**（kernel.md 第 3 节） |
| 会话令牌 | `wbs_` + 256 位随机（base64url），库里只存 SHA-256；只在注册 / 登录响应里出现一次 |
| 普通会话 | 90 天，**使用即续期**（最近使用时间最多每分钟写一次库） |
| 管理会话 | 12 小时，不续期；创建时写审计 `admin_session.created` |
| 权限 | 管理接口要求 `role = admin` 且是管理会话（平台守卫检查）；管理员的 App 会话访问管理接口 403；管理会话也能访问普通接口 |
| 过期 | 带着过期令牌来时删除该会话并发 `identity.session_revoked(expired)`；另有 `sweep-sessions` 命令批量清扫（定时任务尚未接，见交接说明） |
| 事件 | 退出 `logout`、踢下线 / 重置密码 / 降级 `revoked`、过期 `expired`、注销 `account_deleting` → `identity.session_revoked`（push 删推送设备，realtime 断连接） |
| 邀请码 | 16 位，去掉易混的 0 O 1 I L U，显示为 `XXXX-XXXX-XXXX-XXXX`；输入不区分大小写、可带空格和连字符。注册时对邀请码行加行锁，并发注册只有第一个成功 |

## 5. 资料、设置、主题

- 默认值（新账号）：资料昵称为空、性别 `unspecified`、时区 = 注册设备的时区；主动消息开、主动来电关（MED-07）、推送声音开、显示内容开、免打扰关（时段预填 00:00–08:00）、允许拉群开（SOC-06）；主题 `green`。
- 登录不改资料时区（设备时区由 realtime 在每次连接时上报更新，D-L1-01）。
- 修改后在同一事务发布：`identity.profile_updated`（带变化字段名）、`identity.notification_settings_updated`、`identity.preferences_updated`。
- **主题多设备同步**：A 设备 `PATCH /me/preferences` → 事件 `identity.preferences_updated` → realtime（D-L1-01）订阅后给该用户写 `settings.updated(section = preferences)` → B 设备重新 `GET /me/preferences`。realtime 未实现前，集成测试用一个假订阅者验证事件送达、B 设备读到新主题。
- `avatarMediaId` 目前只校验是 UUID，不校验归属（media 模块 D-L0-07 未实现）。

## 6. 注销编排（删除清单框架）

```
DELETE /me（密码 + confirm=DELETE）
  └─ 同一事务：users.status = deleting → 作废全部会话（每个发 session_revoked）→ 删除该用户数据密钥（destroyKey）
              → 发 identity.user_deletion_requested → 审计（只记用户 ID 的哈希）
分发器投递：
  ├─ 对删除清单登记处（platform USER_DATA_REGISTRY）里每个模块：调用 purgeUser → 发 platform.user_data_purged
  └─ identity.on_user_data_purged：记 deletion_progress；登记的模块全部回报 → 删除账号行（级联删除资料、设置、会话、进度）
     → 审计 user.deleted（只记哈希）
```

- 模块怎么登记：kernel.md 第 16 节。目前只有 identity 自己登记（用于核验）；没有其他模块时请求后由 `identity.on_user_deletion_requested` 直接完成。
- 注销中的账号不能登录；用户名在账号行删除后才释放。
- 重复投递安全：收件箱去重 + 账号已删除时忽略迟到的回报（有测试）。

## 7. 命令行脚本

仓库根目录运行（开发）；生产构建后在 `apps/server` 下用 `node dist/identity.js <命令>`（需要 `DATABASE_URL` 等环境变量，与服务器相同）。

| 命令 | 作用 |
|---|---|
| `pnpm --filter @weiban/server identity create-admin <用户名> [--tz Asia/Shanghai]` | 创建管理员（第一个管理员由运维执行），随后输入密码 |
| `pnpm --filter @weiban/server identity reset-password <用户名>` | 重置密码：该账号所有设备下线、解除登录锁定，写审计 |
| `pnpm --filter @weiban/server identity set-role <用户名> <user\|admin>` | 改角色；降为 user 时作废其管理会话 |
| `pnpm --filter @weiban/server identity create-invite [--days 7]` | 生成一个邀请码（不填天数永不过期） |
| `pnpm --filter @weiban/server identity verify-purged <用户ID>` | 注销核验：列出每个模块剩余条数，有残留时退出码 2 |
| `pnpm --filter @weiban/server identity sweep-sessions` | 清扫已过期会话 |

**密码不写在命令参数里**（会留在命令历史）：在终端运行时会提示输入两次且不显示；脚本化时从标准输入传一行，例如 `echo '新密码' | node dist/identity.js reset-password boss`。

第一次部署后的顺序：`node dist/migrate.js up` → `node dist/identity.js create-admin <名字>` → 管理员用管理后台（或接口）生成邀请码。

## 8. 测试

- 单元：`domain/rules.test.ts`、`infra/password-hasher.test.ts`、`platform/deletion/user-data-registry.test.ts`。
- 集成：`apps/server/test/identity.test.ts`（36 条）：每个接口的正常 / 未登录 / 无权限 / 参数错误 / 重复请求；邀请码无效 / 已用 / 过期 / 并发；登录锁定（用户名、IP、到期恢复、成功清零）；会话续期与过期、管理会话 12 小时；主题同步；命令行；注销编排与重复投递；日志里搜不到任何密码和令牌。
- 测试用 `X-Forwarded-For` + `HTTP_TRUST_PROXY=true` 给每个请求不同 IP，避免按 IP 锁定互相干扰。
