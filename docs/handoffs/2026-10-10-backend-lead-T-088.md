# 交接说明：T-088 L7 characters 配合人设广场（后端）+ ContactsWritePort

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-088-characters-plaza`，`4733155`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

1. **白名单快照**（`CharacterPlazaPort.buildPublishSnapshot / buildVariantSnapshot`）：
   - 只读 PLZ-02 第 3 条列出的字段，并按契约的严格格式校验。
   - 「基于身边真人」的角色，或曾经被标为这一类的（`everPrivatePerson`），返回 forbidden，不能发布。
   - 真人分类的角色，快照里不带头像。
2. **按快照创建角色**（`createFromSnapshot`）：
   - 新建一个自定义角色，来源标记为「从广场复制」（`origin_kind = plaza_copy`），并记录来源作品、版本和作者昵称。
   - 分类全部取自快照，客户端没有办法影响。预设改版取该预设角色当前的分类和当前人设版本，再加上改版设定；关系网、公开动态、近期主线、公开资料不复制。
   - 以 `adoptionId` 为幂等键（数据库唯一索引保证），重试不会建出两个角色。
3. **分类只能更严**：
   - policy 新增 `compareClassification`，作为「是否更严」的唯一判定处。plaza 和 characters 都调用它。
   - 用户编辑复制来的角色时，横向修改也会被拒绝：虚构和原创互换、真人的子类互换都不行。
   - 迁移 0063 扩展了数据库触发器：直接改数据库把复制品的分类放宽、把系统检测到的儿童特征从「是」改回「否」、或改写来源，都会被拒绝。
4. **应用改版**：写入「我的补充设定」，并记录来源（作品、版本、作者）。分类不变，聊天记录、记忆、熟悉度都不动。
5. **按新版本更新、管理员更正**：
   - 两者的分类都只会取更严的一边。
   - 分类一旦变化，会在同一事务里发出 `characters.character_classification_changed`，ai-runtime 收到后立即退出成人模式。
   - 每次更新或更正，人设版本号加一。
   - 用户编辑普通自定义角色时，如果分类或儿童特征发生变化，现在也会发出这个事件（之前漏发）。
6. **来源标注接口**：`GET /characters/custom/:id/origin`（契约 `CustomCharacterOriginEndpoints`），资料页据此显示「来自人设广场 · 作者 XX · 版本 N」。作品是否还在、作者是否已注销、有没有新版本，由 plaza 提供（在 `app.module.ts` 里绑定）。
7. **ContactsWritePort**（按总负责人裁定）：
   - 契约新增服务器内部接口 `ContactsWritePort.addForUser`，由 contacts 实现，规则和用户手动添加完全一样。
   - plaza 的「添加为我的角色」现在由服务器自动加进通讯录。「应用改版」时如果用户还没添加该预设角色，会先帮他添加。
8. **在 app.module.ts 完成绑定**：plaza 访问角色的接口（`PLAZA_CHARACTERS`）接到 characters；分类比较（`PLAZA_CLASSIFICATION_POLICY`）接到 policy；来源标注需要的广场状态接到 plaza。
9. **顺带修复（影响面较大，请留意）**：
   - 之前的问题：自定义角色存的是简化格式，但资料页、名字查询、AI 回复都按预设角色的格式解析，导致自定义角色添加不了，也生成不了回复。
   - 现在的做法：服务器把自定义角色合成为一张完整的角色卡（WB-Card）。预设改版的复制品直接使用预设角色的卡，去掉预设专有的数据后，把改版设定并入背景。同时允许创建者把自己的自定义角色加进通讯录。

以上已通过：server 的 typecheck、ESLint、模块依赖检查、改动文件的格式检查，以及 contracts 的 typecheck。按本轮约定未写测试，也未在本机执行迁移。

## 改了哪些文件

- `packages/contracts/src/ports/contacts.ts`（新增 `ContactsWritePort`）、`packages/contracts/README.md`（变更记录）
- `apps/server/drizzle/0063_characters_plaza.sql` / `.down.sql`
- `apps/server/src/modules/characters/`：`application/plaza-port.ts`（新）、`domain/custom-card.ts`（新）、`http/custom-origin.controller.ts`（新）、`application/characters.ts`、`application/custom-character.ts`、`application/supplements.ts`、`infra/db/schema.ts`、`tokens.ts`、`index.ts`、`characters.module.ts`
- `apps/server/src/modules/policy/domain/rules.ts`、`policy/index.ts`
- `apps/server/src/modules/contacts/application/commands.ts`、`tokens.ts`、`index.ts`、`contacts.module.ts`
- `apps/server/src/modules/plaza/`：`application/plaza.service.ts`（自动加通讯录、提供来源状态）、`tokens.ts`、`index.ts`、`plaza.module.ts`
- `apps/server/src/app.module.ts`
- `docs/backend/characters-plaza.md`（新）、`docs/backend/plaza-implementation.md`（更新已知限制）

## 契约改动说明（最小、向后兼容）

- 只新增一个服务器内部的 TypeScript 接口 `ContactsWritePort`，不影响 HTTP / WebSocket 的数据格式，所以 `CONTRACT_VERSION` 保持 3.0 不变。
- 已运行 `pnpm android:generate`，Android 生成物没有任何变化，因此没有可提交的生成文件。

## 遗留问题

- **发布前检测还没接上**：`PLAZA_PUBLISH_CHECK` 等 T-089 绑定。在此之前，发布会返回 `plaza_check_unavailable`（设计如此，不跳过检查）。
- 合成出来的自定义角色卡是模板化的（示例对话 6 条、日常活动是固定列表），像不像真人主要靠人设描述、说话方式、口头禅这几项，AI 负责人可以以后改进模板。
- 自定义角色在资料页暂不显示用户上传的头像（`avatar.image` 为 null），这与原来 `CustomCharacterService.get` 的行为一致。
- 管理员更正写入 characters 审计时，`actorId` 为空；完整的管理员身份记在 plaza 的审计里。
- 仓库里有 5 个文件的格式问题是早就存在的（health/store.ts、media/link-preview.ts、contracts 的 ports/characters.ts、media.ts、social.ts），本次没有动。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-089）：在 `app.module.ts` 的 PlazaCompositionModule 里补上 `{ provide: PLAZA_PUBLISH_CHECK, useExisting: <ai-runtime 的实现令牌> }`。儿童特征检测结果的写回，沿用 characters 已有的系统写入方式。另外，自定义角色现在可以被 `getForRuntime` 正常读取了（之前返回 null），请确认运行时对 `kind = custom` 没有别的假设。
- 给 Web / 安卓（T-097、T-098）：
  - `adopt` 成功后服务器已经自动把角色加进通讯录，**不需要**再调用 `POST /contacts`。
  - 来源标注调用 `GET /characters/custom/:id/origin`。
  - 编辑复制来的角色时，如果把分类往宽改，会收到 422 `classification_change_forbidden`。
- 给架构：`ContactsWritePort` 已经写进契约和 README 的变更记录，请在 `contracts-3.0-map.md` 的 T-087 / T-088 两栏补登记。
- 给运维：迁移 0063 是普通的建列和替换函数，不需要额外权限。
