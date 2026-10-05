# 交接说明：T-018 账号模块 identity（D-L0-06）

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人（backend-lead） |
| 日期 | 2026-10-05 |
| 分支 | `T-018-identity`（基于 origin/main，已合并 `2be4911`：T-019、契约 1.1、ADR-0015 批准） |

## 做了什么

结论：用户能用邀请码注册、登录、退出、查看和踢掉登录设备，能改资料、通知设置和主题（主题改动会通知其他设备）；管理员有独立的 12 小时管理会话，可生成邀请码；创建管理员、重置密码等有命令行脚本；注销账号的「删除清单」框架已搭好。契约 `IdentityEndpoints` + `IdentityAdminEndpoints` 共 14 个接口全部实现，`pnpm check` 通过（服务器测试 183 条全过，0 跳过）。

1. **注册**：邀请码一次性、可过期，注册时对邀请码行加锁，并发注册只有一个成功；同一次注册重发返回同一账号（200）；用户名不区分大小写唯一。
2. **登录与会话**：密码 argon2id；令牌 256 位随机、库里只存 SHA-256；普通会话 90 天使用即续期，管理会话 12 小时不续期；同一用户名或同一 IP 连续 5 次失败锁 15 分钟；会话可退出、可踢下线、过期自动作废，每次作废发 `identity.session_revoked`。
3. **资料 / 通知设置 / 界面偏好**：修改只改传了的字段（Q-001）；值没变不写库不发事件；有变化在同一事务发 `profile_updated` / `notification_settings_updated` / `preferences_updated`。
4. **管理员**：`role = admin` + 管理会话；邀请码生成支持 `Idempotency-Key`；审计记录不记邀请码本身。
5. **命令行** `src/cli/identity.ts`：create-admin、reset-password、set-role、create-invite、verify-purged、sweep-sessions；生产包 `dist/identity.js`。密码不走命令参数。
6. **删除清单框架**：平台新增 `USER_DATA_REGISTRY`（契约 `UserDataOwner` 的登记处）；identity 收到注销事件后为每个登记模块投递 pg-boss 任务 `identity.purge_user_data`（订阅者只做快速写入，符合 ADR-0015 批准附带的规范第 3.4 节），任务执行删除并回报，收齐回报后物理删除账号。`DELETE /me` 已可用（立即下线全部设备、删除数据密钥）。
7. **平台小改动**：新增配置 `HTTP_TRUST_PROXY`（反向代理后取真实 IP）；`main.ts` 抽出 `configureHttpApp` 供测试共用；内核 HTTP 测试改用 `overrideProvider` 换假校验器；迁移测试改为支持多个迁移。
8. 文档：`docs/backend/identity.md`（新）、`docs/backend/kernel.md`（第 3 节新变量、第 10 节、新增第 16 节删除清单）、`apps/server/README.md`。

## 验收标准逐条验证（均已实际运行）

| 验收项 | 结果 | 实际验证 |
|---|---|---|
| `pnpm check` 通过（本机带数据库，集成测试不跳过） | 通过 | format:check、eslint、depcruise「no dependency violations found」、三个子项目 typecheck、`Test Files 18 passed / Tests 183 passed`（0 skipped）、tokens 检查，退出码 0 |
| 每个接口有测试：正常、未登录、无权限、参数错误、重复请求 | 通过 | `apps/server/test/identity.test.ts` 36 条，14 个接口逐一覆盖（无权限：普通用户 / 管理员 App 会话访问管理接口 403、踢别人的设备 404、普通用户开管理会话 403；重复请求：注册重发、重复退出、重复踢下线、重复 PATCH 不重复发事件、同一 Idempotency-Key 只生成一个码、重复注销 401） |
| 密码慢哈希（ADR-0006 argon2id）；登录失败限流或锁定；会话可吊销 | 通过 | 单元测试断言哈希为 `$argon2id$v=19$m=19456,t=2,p=1$…`；集成测试：5 次失败后正确密码 429、15 分钟后恢复；同一 IP 锁定、换 IP 不受影响；成功清零；退出 / 踢下线 / 重置密码 / 降级 / 过期后令牌 401 |
| 无效、已用、过期邀请码被拒绝；邀请码只能用一次（并发注册测试） | 通过 | 三种情况均 422 `invite_invalid`；6 个请求并发用同一个码：结果 `[201, 422×5]`；同用户名 3 个不同码并发：`[201, 409, 409]` 且只消耗一个码；curl 实测同码第二次注册 422 |
| 改主题后同一用户其他会话能收到同步更新（有测试） | 通过 | 测试：设备 A 改 pink → 事件 `identity.preferences_updated` 经分发器送到假 realtime 订阅者 1 次；设备 B 读到 pink；重复 PATCH 不再发事件；人为重投事件订阅者仍只处理 1 次。curl 实测设备 2 改 pink、设备 1 读到 pink |
| 日志不出现密码、会话令牌 | 通过 | 测试收集全部日志，断言测试中用过的每个密码和发出的每个令牌出现 0 次（同时断言「登录成功 / 登录失败」日志确实写了）；identity 表全文导出中也搜不到密码和令牌原文。curl 实测服务器日志 53 行，`wbs_` 出现 0 次、两个密码出现 0 次 |
| 命令行脚本可用，`docs/backend/identity.md` 写清用法 | 通过 | 开发库实测：`echo 密码 \| pnpm --filter @weiban/server identity create-admin boss_demo` →「已创建管理员 boss_demo」；`create-invite --days 7` → 输出邀请码与有效期；生产构建后 `node dist/identity.js help`、`sweep-sessions` 正常。用法见 identity.md 第 7 节 |
| 本机启动服务器，curl 走通「注册 → 登录 → 读资料 → 改主题 → 退出」 | 通过 | 见下方 curl 记录 |
| 提交格式 `T-018 类型: 说明` | 通过 | |

### curl 记录（2026-10-05，本机 `tsx src/main.ts`，令牌打码）

```
GET /health                         200 {"status":"ok",…,"database":{"ok":true}}
1  POST /auth/register              201 {"session":{"sessionId":"01a10912-c83f-…","token":"wbs_***","kind":"app","expiresAt":"2027-01-02T22:39:48.287Z"},"user":{"username":"curl_demo","role":"user","profileCompleted":false,…}}
1b 同一邀请码再注册                 422 {"error":{"code":"invite_invalid",…}}
2  POST /auth/login（第二台设备）   200 {"session":{…,"kind":"app"},"user":{"username":"curl_demo",…}}
2b 错误密码                         401 {"error":{"code":"invalid_credentials","message":"用户名或密码错误",…}}
3  GET /me                          200 {"username":"curl_demo","role":"user","profileCompleted":false,…}
   GET /me/profile                  200 {"nickname":null,…,"gender":"unspecified","timeZone":"Asia/Shanghai",…}
3b 未登录 GET /me/profile           401 {"error":{"code":"unauthenticated","message":"请先登录",…}}
4  PATCH /me/preferences（设备2）   200 {"theme":"pink",…}
4b GET /me/preferences（设备1）     200 {"theme":"pink",…}
4c GET /me/sessions                 200 两条，设备 1 current=true
5  POST /auth/logout（设备2）       204
5b 设备 2 令牌 GET /me              401 {"error":{"code":"unauthenticated","message":"登录已失效，请重新登录",…}}
   设备 1 令牌 GET /me              200
附 管理员 kind=admin 登录           200 kind=admin，expiresAt = 12 小时后
   POST /admin/invites（同一 Idempotency-Key 两次）  201，两次返回同一个码
```

## 改了哪些文件

- 新增 `apps/server/src/modules/identity/`：`index.ts`、`testing.ts`、`tokens.ts`、`identity.module.ts`、`domain/rules.ts`（+ 测试）、`infra/db/schema.ts`、`infra/password-hasher.ts`（+ 测试）、`infra/login-throttle.ts`、`application/{accounts,sessions,settings,invites,deletion,commands,user-hash}.ts`、`http/identity.controller.ts`
- 新增 `apps/server/src/cli/identity.ts`、`apps/server/src/platform/deletion/user-data-registry.ts`（+ 测试）
- 新增迁移 `apps/server/drizzle/0001_identity.sql`、`0001_identity.down.sql`、`meta/0001_snapshot.json`；修改 `meta/_journal.json`
- 新增集成测试 `apps/server/test/identity.test.ts`
- 修改 `apps/server/src/app.module.ts`（装配 IdentityModule）、`src/main.ts`（`configureHttpApp`、trust proxy）、`src/platform/{index.ts,platform.module.ts}`（登记处）、`src/platform/config/config.ts`（+ 测试，`HTTP_TRUST_PROXY`）、`test/http-kernel.test.ts`、`test/migrations.test.ts`、`apps/server/package.json`（`identity` 脚本、依赖）、`scripts/build.mjs`（`dist/identity.js`）、`apps/server/README.md`、`pnpm-lock.yaml`
- 文档：新增 `docs/backend/identity.md`、本交接说明；修改 `docs/backend/kernel.md`

## 新增第三方依赖

| 包 | 用途 | 许可证 | 编译 |
|---|---|---|---|
| @node-rs/argon2 2.2.1 | argon2id 密码哈希 | MIT | 各平台预编译二进制（optionalDependencies 按平台安装），**无安装脚本**，`allowBuilds` 不用改 |

## 遗留问题

1. **过期会话定时清扫未接定时任务**：目前过期会话在「带着它来访问」时作废，另有 `sweep-sessions` 命令；用了就不再来的过期会话要等清扫才发 `session_revoked(expired)`。建议 push 模块（D-L1-05）上线时一起用 pg-boss 定时任务每小时调一次（`IdentityCommands.sweepSessions`），届时在内核 JobQueue 加定时调度封装。
2. **头像归属未校验**：`avatarMediaId` 只校验 UUID 格式，media 模块（D-L0-07）提供端口后补「必须是本人上传的图片」。
3. **注销后来登记的模块收不到旧事件**：注销请求发出后才新增的模块不会收到那次 `user_deletion_requested`，账号会一直停在「注销中」。PRD 要求的管理后台「注销未完成」列表和「重新触发」入口尚未做（契约里也没有对应管理接口）。
4. **「注册赠送余额」未做**：PRD ADM-01 第 6 条 / ACC-04 写邀请码可预设赠送余额，但契约 `createInvite` 只有 `expiresInDays`，且 billing 尚未实现。见下方契约变更申请。
5. **用户名注销期间仍被占用**：账号行要等所有模块删除完才删除，期间同名注册返回 `username_taken`（属预期，记录在此）。
6. 注销删除任务需要消费任务的进程（`APP_ROLE` 为 worker 或 all）在运行；拆分进程部署时注意。
7. 共享开发数据库容器 `weiban-dev-postgres` 在本任务期间被其他会话停过一次（`pnpm db:up` 重新拉起即可，数据卷未动）；并行任务较多时建议约定由谁 `db:down`。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- **给架构负责人**：
  - **契约变更申请 1（次版本）**：`IdentityAdminEndpoints.createInvite` 请求体加可选字段 `bonusMicros`（注册赠送余额，微元，默认 0），`Invite` 响应加 `bonusMicros`。原因：PRD ADM-01 第 6 条、ACC-04。影响：后端（identity 存字段，注册成功后经 billing 端口或事件加余额）、Web 管理后台。建议同时确定「注册赠送」由 identity 调 billing 端口，还是 billing 订阅 `identity.user_registered`（需在事件载荷里带 inviteCode 不合适，倾向 billing 提供端口）。
  - **契约变更申请 2（次版本）**：管理接口「注销未完成的账号列表 / 重新触发删除」（security-and-privacy.md 第 5.1 节第 2 条要求管理后台可看到），L6 前需要。
  - 实现说明：契约 `ports/common.ts` 注释说删除清单「注册到平台内核」，已实现为平台 `USER_DATA_REGISTRY`，由 identity 编排，与文档一致。`DELETE /me` 密码错用 `invalid_credentials` + 403（默认 401 会让客户端误退出），如认为应新增错误码请告知。
  - 新增 `HTTP_TRUST_PROXY` 配置（kernel.md 第 3 节）。
- **给运维负责人**：
  1. **部署必配 `HTTP_TRUST_PROXY=1`**（Caddy 在服务器前面一层时）。不配的话所有请求看起来都来自 Caddy 的 IP，任何人连续输错 5 次密码就会锁住所有人的登录 15 分钟。`.env.example` 是否加注释行由你决定（kernel.md 第 3 节已写）。
  2. 首次部署顺序：`node dist/migrate.js up` → `node dist/identity.js create-admin <用户名>`（交互输入密码）→ 登录管理后台生成邀请码。命令写进运维手册（D-L0-14）。
  3. 生产镜像需要 `@node-rs/argon2` 对应平台的预编译包（`pnpm install --prod` 在目标平台 / 镜像内执行即可自动选对，Alpine 用 musl 版）。
  4. **eslint 登记**：`identity` 已在 `packages/eslint-config/architecture.js` 登记（lower 层，schema `identity`），无需改动。
- **给 Web 负责人 / Android 负责人**：接口按契约；补充：注册重发会返回 200（同一账号）；注销时密码错是 403 `invalid_credentials`（不要当成登录失效）；被锁 429 `account_locked`；邀请码输入可带空格、连字符、小写。主题同步：收到 `settings.updated(section = preferences)` 后重新拉 `GET /me/preferences`（事件由 realtime 在 D-L1-01 写入）。
- **给后续后端任务**：
  - realtime（D-L1-01）：订阅 `identity.preferences_updated` / `profile_updated` / `notification_settings_updated` 写 `settings.updated`；订阅 `identity.session_revoked` 断开该会话的连接；WebSocket 首帧鉴权直接调用 `SESSION_VERIFIER`（注入令牌 `SESSION_VERIFIER`，`verify(token, 'user')`）；连接时上报的设备时区可通过 identity 新增端口方法更新（届时提契约变更，或复用 `PATCH /me/profile`）。
  - push（D-L1-05）：订阅 `identity.session_revoked` 删除绑定该会话的推送设备；顺带接过期会话的定时清扫（遗留问题 1）。
  - 每个有用户数据的模块：按 kernel.md 第 16 节登记删除清单。
- **给 AI 负责人**：读用户资料、通知设置、最近活跃时间用 `IDENTITY_READ_PORT`（从 `modules/identity/index.ts` 导入）；资料变化订阅 `identity.profile_updated`。
- **给质量负责人**：复核命令 `pnpm install && pnpm db:up && pnpm check`；重点测试 `apps/server/test/identity.test.ts`（并发邀请码、锁定、主题同步、注销编排、日志无密码令牌）；curl 脚本流程见上。
- **给项目总负责人**：两条契约变更申请转架构；`HTTP_TRUST_PROXY` 转运维写入部署配置。
