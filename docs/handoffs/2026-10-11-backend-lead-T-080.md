# 交接说明：T-080 L6 后端——注销完整流程、验证脚本、「注销未完成」管理接口

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `T-080-account-deletion`，`a54e20d`，已合入 `local/trunk`（`C:\wb-dev\wb-int`，快进） |
| 自检 | 服务器 `tsc` 通过；改动文件 eslint、prettier 通过；`lint:deps`（模块边界）通过。按要求**没写测试、没跑测试** |
| 迁移 | `0056_account_deletion`（含 `.down.sql`），已登记 `_journal.json`；0000～0069 现有迁移文件与 journal 一一对应 |

## 做了什么

注销主流程（密码校验、所有设备下线、删数据密钥、按模块分发删除任务、失败重试、管理员列表与重新触发）在 L0 / T-023 已有。本卡在它上面补齐收口：

1. **密码错误 = 403 `invalid_credentials`「密码错误」**：已核对现有实现就是 403（不是 401），会话不动，用户保持登录；连续输错 429 `account_locked`。客户端 T-084 / T-086 不用改。
2. **逐模块核对删除清单（L0～L7 共 20 个模块）**：拿 138 张表逐张对照各模块的 `purgeUser / countUserData`。19 个模块都已登记，policy 没有用户数据表。只发现一处漏洞并已修好：contacts 删了「新朋友状态」但没计入删除条数和核验计数。其他模块（growth/宠物、moments、群聊、关系网、通话、媒体、收藏、导入、广场、玩法、经期日记、主动消息、ai-runtime 各表、billing 钱包/流水/冻结/日汇总）都已覆盖。
3. **完成判定加复核**：所有模块回报完成后，再逐个模块复查剩余条数。还有残留就重新投递删除任务（防止删除期间仍在运行的任务又写进数据），最多复查 3 轮，超过后停在「注销未完成」，等管理员重新触发（触发后从 0 重新计）。
4. **不留可关联记录（ACC-06 第 3 条、ADM-10 审计）**：账号删除时，把审计记录里该用户的明文 ID 换成哈希；随后的收尾任务（立即一次、1 小时后再一次）删掉发件箱里已送达、内容里带该用户 ID 的事件。
5. **广场作者注销（PLZ-06 第 4 条）**：以前作者注销后作品被删，别人复制的角色仍会显示作者原来的广场昵称。现在删作品前先在别人的采用记录上打标记，复制品来源显示「已注销用户」。
6. **验证脚本 `scripts/verify-user-purged.mjs`**（`pnpm verify-user-purged <用户ID>`，生产用 `node dist/identity.js verify-purged <用户ID>`），做四类检查：① 每个模块剩余条数；② 全库所有 uuid 列扫描（不依赖模块自己写的计数，能发现漏登记的表）；③ 账号行、数据密钥、审计中的明文 ID、已送达事件；④ 对象存储里的孤儿文件（媒体存储新增列举功能，磁盘和 S3 都支持）。只输出表名和条数，不输出内容；有残留时退出码 2。
7. **ADM-10 管理接口**：沿用契约 1.2 `listPendingDeletions / retryDeletion`。列表按申请时间从早到晚；每行有用户名、申请时间、最近一次手动触发时间、各模块进度（是否完成、条数、完成时间）；重新触发只重跑没完成的模块（包括注销后才新增的模块），全部完成就直接完成删除；没有撤销接口；审计只记用户 ID 的哈希。
8. **「导入完成」推送跳转**：服务器已经下发 `deepLink = /imports/{jobId}`（成功和失败都是这个地址，正好是安卓 T-086 建议的格式），服务器不用改，**需要安卓在通知路由里接上**（见下方交接）。

## 改了哪些文件（`C:\wb-dev\wb-int`）

- 新增：`apps/server/drizzle/0056_account_deletion.sql`、`.down.sql`；`apps/server/src/modules/identity/application/purge-verifier.ts`；`scripts/verify-user-purged.mjs`
- 修改：`apps/server/drizzle/meta/_journal.json`；identity 的 `application/{deletion,commands}.ts`、`identity.module.ts`、`infra/db/schema.ts`；`apps/server/src/cli/identity.ts`；`platform/audit/audit-log.ts`（`anonymizeUser`、`countPlainUser`）；`platform/events/outbox.ts`（`scrubDelivered`、`countMentioning`）；media 的 `infra/storage.ts`（`list`）、`application/media.ts`（`findOrphanKeys`）、`tokens.ts`、`index.ts`、`media.module.ts`（`MEDIA_STORAGE_AUDIT`）；plaza 的 `application/plaza-lifecycle.ts`、`application/plaza.service.ts`、`infra/db/schema.ts`；contacts 的 `application/recommendations.ts`；根 `package.json`（`verify-user-purged` 命令）、`scripts/README.md`；`docs/backend/identity.md` 第 6.1 节
- 契约、Android 生成物都没改。

## 遗留问题

1. **对象存储核验的口径是「全库没有孤儿文件」**：存储里的文件名是服务器生成的随机 ID，不按用户分目录，删掉记录后就无法知道哪个文件属于谁。这与 security-and-privacy.md 第 6 节「列出对象存储中该用户目录」的写法不一致，需要架构更新文档（或决定改成按用户分目录）。10 分钟内正在上传的文件可能会被短暂报出来。
2. **别人复制品里保存的作者旧昵称**：`characters.plaza_author_name` 仍保存作者注销前的广场昵称，页面已改为显示「已注销用户」，但数据库里这段文字还在。它只是广场昵称，和聊天内容无关；如果要彻底清掉，需要 characters 和 plaza 之间增加一个事件或端口（属于契约变更）。
3. **pg-boss 任务表**：删除任务的数据里有用户 ID（不含内容），按 pg-boss 自己的保留期自动清理，核验脚本不扫描这张表。**数据库备份**里仍有该用户数据，直到备份按保留期滚动删除（security-and-privacy.md 5.1 第 4 条，已知事实）。
4. 应用日志里 `账号进入注销流程` 这一行记的是明文用户 ID（L0 就有，不含用户名和内容），没有改。
5. 没有写测试，也没跑过真实数据库；复核、审计匿名化 SQL、全库扫描都留给 Codex 整体验收时验证。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 android-lead：「导入完成 / 导入没有完成」推送的 `deepLink` 是 `/imports/{jobId}`（UUID，`kind = system`）。请在 `NotificationPolicy.notificationRoute` 加上这个前缀并做 UUID 校验，再跳到对应的导入任务页。注销接口和 T-084 / T-086 约定的一致：密码错误 403、成功 202、其他设备下线。
- 给 web-lead：注销和「注销未完成」页不用改；重新触发时账号已删完会返回 404（已按「已全部删除」处理）。
- 给 architect：① 文档第 6 节「对象存储中该用户目录」与实际存储方式不符，见遗留问题 1；② 可选的契约申请：plaza 向 characters 发「作者已注销」通知，用来清掉复制品里的旧昵称（遗留问题 2）。
- 给 devops-lead：核验命令是 `pnpm verify-user-purged <用户ID>`，生产用 `node dist/identity.js verify-purged <用户ID>`。使用 S3 时，凭据需要有 `ListBucket` 权限，否则孤儿文件检查会报错。
- 给 Codex（总经理转交）：建议重点验——输错密码返回 403 且仍保持登录；构造某个模块删除失败后，账号出现在「注销未完成」，重新触发只重跑该模块；注销完成后 `pnpm verify-user-purged` 全部为 0，并按 security-and-privacy.md 第 6 节用 `pg_dump` 搜索金丝雀短语和用户名；别人复制的广场角色来源显示「已注销用户」。
- 给总负责人：已合入 `local/trunk`（`a54e20d`）。
