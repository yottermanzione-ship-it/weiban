# 交接说明：T-087 L7 plaza 人设广场模块（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-087-plaza`，`c5618cf`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

新建 `plaza` 模块，按契约 `PlazaEndpoints`、`PlazaAdminEndpoints` 实现了全部接口：

1. **作者档案**：广场昵称（最多 12 字）和头像（复制成公开副本 `plaza_avatar`）。第一次发布或评论前必须先设置，否则返回 409。
2. **发布 / 新版本**：
   - 生成草稿时会拦下这些情况：作者被停权、作品被管理员下架、作者自己下架了作品、「基于身边真人」（`everPrivatePerson`，characters 拦一次，plaza 再查一次，直接调接口也会被拒）、原作品不允许改编。
   - 快照按契约的严格白名单再校验一次，然后调用隐私检查和儿童特征重检的端口（`PlazaPublishCheckPort`，由 T-089 实现）。检测做不了时返回 `plaza_check_unavailable`，绝不跳过。
   - 确认发布时，用户没确认保留的片段用「▢」遮住；真人分类的角色不带头像；新版本的分类交给 policy 比较，比上一版宽就返回 `plaza_classification_loosened`。
   - 版本表只能新增、不能修改（数据库触发器保证）。
3. **浏览**：
   - 搜索：角色名、标签、作者昵称、基于的预设角色名。
   - 排序：热门、最新、点赞最多。热门严格按 P-34，取 7 天内的数据，点赞算 1 分、添加或应用算 2 分、评论算 1 分；同分时较新的在前。
   - 筛选：两种。
   - 作品页（含版本记录、改编自）；作者页只显示昵称和头像。
   - 已下架的作品、被停权作者的作品都不显示。
4. **互动**：
   - 点赞：幂等，每人每个作品只算一次，可以取消。
   - 评论：最多 200 字，只有一层回复，按客户端请求编号幂等。评论者本人或作品作者可以删评论；作者可以关闭评论区。
   - 举报：同一个人对同一个对象只能举报一次，重复返回 409；举报后不会自动隐藏内容。
   - 通知：只写广场通知和红点（`data.changed(plaza_badge)`），**不发推送**。
5. **复制、应用、更新**：
   - 复制和应用以 `adoptionId` 为幂等键；复制前先按 P-26 检查通讯录人数。
   - 应用改版时，如果用户已有补充设定，需要确认替换（未确认返回 409）。
   - 「更新到新版本」时，如果用户改过角色，提示内容会被覆盖（未确认返回 409）；「暂不更新」会让红点消失。
6. **作者与管理员操作**：
   - 作者可以下架、重新上架（被管理员下架的不行）、删除作品（连同版本、点赞、评论、举报和公开头像一起删）。
   - 管理员可以：下架（原因必填，并通知作者）、恢复、处理举报（同一对象的待处理举报一并处理，并逐一通知举报人）、删除评论、停权与解除停权（可设期限或永久）。每项操作都写审计。
   - **更正分类只能往更严的方向改**：先经 policy 判定，作品追加一个「管理员更正分类」的新版本，然后顺着复制关系和改编链，把下游的复制品逐个调用 `tightenClassification`，改编作品也同样递归处理。
7. **注销删除清单**：
   - 删除：该用户的全部作品、评论、点赞（同时扣减相应计数）、举报、通知、草稿、复制关系、停权记录、广场资料。
   - 保留：别人的复制品和别人的复制关系。别人改编作品上的原作者改为显示「已注销用户」。
8. 过期草稿每小时清理一次（任务名 `plaza.draft_sweep`）。

实现说明：`docs/backend/plaza-implementation.md`（在 worktree 仓库中）。typecheck、ESLint、dependency-cruiser、prettier 都已通过。按本轮约定未写测试，也未在本机执行迁移。

## 改了哪些文件

- `apps/server/drizzle/0060_plaza.sql`、`0061_plaza_interactions.sql`、`0062_plaza_search.sql` 及对应 `.down.sql`
- `apps/server/src/modules/plaza/**`（新模块：tokens、domain/rules、infra/db/schema、application 下 4 个服务、http 下 2 个控制器、module、index）
- `apps/server/src/app.module.ts`（注册 PlazaModule，并新增 PlazaCompositionModule 绑定预设名和补充设定读取）
- `docs/backend/plaza-implementation.md`
- 契约未改，Android 生成物无需重新生成。

## 遗留问题

- **端口暂未绑定（不影响编译和启动）**：`PLAZA_CHARACTERS`（CharacterPlazaPort）、`PLAZA_CLASSIFICATION_POLICY`（compareClassification）这两个由 T-088 实现后在 `app.module.ts` 绑定；`PLAZA_PUBLISH_CHECK` 由 T-089 绑定。绑定前，发布、复制、应用、更正分类返回 `service_unavailable` 或 `plaza_check_unavailable`，浏览和互动不受影响。
- **契约变更申请（给架构）**：「添加为我的角色」按设计要走 CHR-03 添加流程，但 contacts 没有给其他模块调用的「添加联系人」端口，而 plaza 不能直接用 contacts 内部的命令类。目前 `adopt` 只创建角色，客户端拿到 `characterId` 后照常调用 `POST /contacts` 添加，P-26 在那里会再检查一次。建议新增 `ContactsWritePort.addFromSystem(userId, characterId, idempotencyKey)`，提供方 contacts，调用方 plaza。也可以裁定由客户端负责添加，这时 `adopt` 接口说明里「并走添加流程」需要改写。
- 新版本更新（应用改版这一类）调用 `applyVariant` 时，幂等键用的是 `{adoptionId}:{version}`，不是 UUID。T-088 实现时，幂等键请按文本存储。
- 预设改版作品卡片的 `avatarUrl` 返回 null，客户端用 `basedOnPresetId` 显示预设头像。
- 迁移 0062 用到 `CREATE EXTENSION pg_trgm`，生产数据库需要有这个权限（请运维确认）。
- 复制前的 P-26 预检只统计「已通过」的联系人，「等待通过」的没算进去；最终以添加流程里的检查为准。
- 「热门」排序和列表分页用的是偏移游标，个人测试规模下够用。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给后端（T-088，本人下一张卡）：
  - 在 `app.module.ts` 把 `PLAZA_CHARACTERS` 绑定到 characters 的 CharacterPlazaPort 实现，把 `PLAZA_CLASSIFICATION_POLICY` 绑定到 policy 的 compareClassification。
  - `createFromSnapshot` 和 `applyVariant` 的 `idempotencyKey` 请按文本存。
  - `buildPublishSnapshot` 返回的 `avatarMediaId` 是角色原头像；plaza 在确认发布时负责把它复制成 `plaza_avatar`。
- 给 AI（T-089）：在 `app.module.ts` 把 `PLAZA_PUBLISH_CHECK`（从 `./modules/plaza/index.js` 导入）绑定到 ai-runtime 的 PlazaPublishCheckPort 实现，做法同 `IMPORTER_ANALYZER`。plaza 调用时传入的 `idempotencyKey` 就是 draftId；`texts` 里的 fieldKey 包括 `name`、`description`、`speechStyle`、`exampleDialogue`、`catchphrases.N`、`tags.N`、`variantText`。返回的 span 如果 kinds 为空，plaza 按 `other_private` 处理。
- 给 Web / 安卓（T-097、T-098）：
  - `adopt` 成功后，需要再调用 `POST /contacts` 完成添加（见遗留第 2 条，等架构裁定）。
  - 遇到 `plaza_check_unavailable`，显示「暂时无法发布」。
  - 评论和发布前如果收到 409 且提示「请先设置广场昵称」，先引导用户设置昵称。
  - 通知列表拉取一次后，这批通知即标记为已读。
- 给运维：迁移 0062 需要 `pg_trgm` 扩展的创建权限。
- 给架构：请处理上面的契约变更申请（contacts 添加端口）。
