# plaza 人设广场：后端实现说明（T-087）

> 负责人：后端负责人 · 2026-10-10 · 设计依据 `docs/architecture/persona-plaza.md`、契约 `packages/contracts/src/http/plaza.ts`。
> 本文只讲实现落点，规则以 PRD 第 15 章、ADM-09 和架构文档为准。

## 1. 代码位置

| 文件 | 作用 |
|---|---|
| `apps/server/src/modules/plaza/tokens.ts` | 端口令牌：`PLAZA_CHARACTERS`（CharacterPlazaPort）、`PLAZA_SUPPLEMENT_READ`、`PLAZA_PRESET_NAMES`、`PLAZA_PUBLISH_CHECK`（PlazaPublishCheckPort）、`PLAZA_CLASSIFICATION_POLICY`（compareClassification） |
| `application/plaza-store.ts` | 共用读取：停权判断、作者 DTO、作品卡片 / 作品页组装、通知与 `data.changed(plaza_badge)` |
| `application/plaza.service.ts` | 用户端：浏览搜索排序、发布草稿与确认、作者管理、点赞评论举报、红点通知、复制 / 应用 / 更新 |
| `application/plaza-admin.service.ts` | 管理端：作品列表、下架恢复、更严更正（连带下游）、举报处理、删评论、停权 |
| `application/plaza-lifecycle.ts` | 注销删除清单、过期草稿每小时清扫（`plaza.draft_sweep`） |
| `drizzle/0060_plaza.sql` | 作者档案、停权、作品、版本（只增不改触发器）、草稿、复制关系 |
| `drizzle/0061_plaza_interactions.sql` | 点赞、评论、举报（每人每对象唯一）、通知 |
| `drizzle/0062_plaza_search.sql` | `pg_trgm` 搜索索引 |

plaza **不 import characters**：所有对角色的访问经令牌注入的契约端口，由 `app.module.ts` 绑定。

## 2. 关键实现

- **发布**：`createPublishDraft` 先拦截停权、管理员下架、作者下架、`everPrivatePerson`（双重检查：characters 返回 forbidden，plaza 再看快照的 `everPrivatePerson` / `private_person`）、原作品不允许改编；快照用契约严格 schema 再校验；然后调 `PlazaPublishCheckPort`（幂等键 = draftId），失败一律 `plaza_check_unavailable`，未绑定也一样，不跳过。真人分类强制去掉头像。`confirmPublish` 按用户未保留的片段以「▢」遮盖（同一字段重叠片段合并为一个遮盖符），原创 / 虚构且勾选权利才把头像复制为 `plaza_avatar` 公开副本。新版本分类经 policy 比较，`looser` → `plaza_classification_loosened`。草稿用后记录 `consumed_work_id`，重试返回同一作品。
- **热门（P-34）**：列表查询里对最近 7 天的点赞、复制 / 应用、未删除评论做子查询加权（1 / 2 / 1），同分按发布时间、ID 倒序。分页用偏移游标。
- **可见性**：`status = listed` 且作者无有效停权（`bans` 表：永久或 `until > now`）。被停权作者的作品在作品页状态显示 `author_banned`，解除后自动恢复显示（被单独下架的仍下架）。
- **复制 / 应用**：`adoptionId` 为幂等键，先查 `adoptions`，再调 characters（同一幂等键），最后插入关系并 `adopt_count + 1`。复制前按 P-26 预检通讯录人数。应用改版前用 `CharacterSupplementPort` 判断是否已有补充设定（未确认替换 → 409）。
- **新版本更新**：复制品比较「当前角色快照」与「当初复制的版本」，人设字段有差异且未确认 → 409；应用改版比较补充设定原文。
- **更严更正**：作品追加「管理员更正分类」新版本（版本表只增不改），已跟在上一版的复制关系一并跟到新版（不出现新版本红点）；逐个复制品调用 `tightenClassification`（每项取「当前与目标中更严的一边」再交 characters）；改编作品递归同样处理。每个作品、每个角色、总操作各写一条审计。
- **通知**：点赞、评论、回复、被下架、举报结果只写 `plaza.notices` 并发 `data.changed(plaza_badge)`，不调用推送。

## 3. 已知限制

- 「添加为我的角色」只创建角色，不代替客户端走 CHR-03 添加流程（contacts 没有供其他模块调用的添加端口）：客户端在 `adopt` 返回后照常调用 `POST /contacts` 添加（P-26 在那里再查一次）。已在交接中提契约变更申请。
- 预设改版作品卡片的 `avatarUrl` 为 null，客户端按 `basedOnPresetId` 显示预设角色头像。
- `pg_trgm` 需要数据库允许 `CREATE EXTENSION`（本机 Docker 的超级用户可以；生产库需运维确认）。
