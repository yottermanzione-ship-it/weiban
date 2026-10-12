# T-088 L7 后端：characters 配合人设广场

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L7-03 |
| 迁移号 | 0063 |

## 目标

做完后：`characters` 模块能按白名单从自定义角色 / 补充设定生成发布快照；能按快照创建一个属于用户的新角色（来源 `plaza_copy`，分类锁定只能更严，数据库触发器兜底）；能应用改版、按新版本替换人设字段、接受管理员的更严更正。

## 背景

- 只通过契约中的 `CharacterPlazaPort` 与 plaza 模块（T-087）交互，两卡可同时写。
- 分类单向修改的数据库触发器在 L0 已有（D-L0-11），本卡把它扩展到复制品；`everPrivatePerson` 只增标记在 L2 已有（D-L2-06）。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/architecture/contracts-3.0-map.md`（`CharacterPlazaPort`、快照 schema、policy 分类比较）
- `docs/architecture/persona-plaza.md` 第 4、5 节；`docs/architecture/hard-boundaries.md` 第 2、6 节
- `docs/product/prd-v1/15-persona-plaza.md` PLZ-02 第 3、4、5 条，PLZ-04，PLZ-05 第 2、4 条；`docs/product/prd-v1/03-characters.md` CHR-07 第 4、7 条，CHR-09；`docs/product/prd-v1/10-hard-boundaries.md` SAFE-03 第 5 条
- `docs/backend/characters-policy.md`、`docs/backend/custom-character-implementation.md`

## PRD 条目与参数（原文）

- PLZ-02 第 3 条白名单（自定义角色）：名字、角色分类（含真人子类）、年龄设定、外表是否为儿童、人设描述、说话方式、口头禅、示例对话、人设标签、角色生日、音色选择（音色库中的名称）、头像；预设改版：基于哪个预设角色（只是引用）、改版设定文字。
- PLZ-04 第 1 条：预设改版「添加为新角色」时复制该预设角色**当前人设版本**中的人设描述、说话方式、口头禅、示例对话、标签、生日、音色，再加改版设定；关系网、公开动态、近期主线、公开资料检索不复制。复制后从「认识第 1 天」、熟悉度 L1 开始，计入 P-26（「50 个」）。
- PLZ-04 第 2 条：分类、真人子类、年龄设定、外表是否儿童与来源完全相同，之后只能按 CHR-07 第 4 条方向修改（原创 → 真人、成年 → 未满 18 岁），改名字、改人设描述都不改变分类。
- PLZ-04 第 3 条：应用改版写入「我的补充设定」，已有时确认替换；聊天记录、记忆、熟悉度、卡片不变；受 CHR-09 全部规则约束。
- PLZ-05 第 4 条：更新到新版本时替换人设类字段（白名单字段），用户改过时先提示会被覆盖；分类若更严按新版本执行，进行中的成人模式立即退出（SAFE-03 第 5 条）。
- ADM-09 第 6 条：管理员更正只能更严，连带所有复制 / 应用出去的角色。

## 范围

- 可以改：`apps/server/src/modules/characters/**`、`apps/server/src/modules/policy/**`（分类比较「是否更严」）、`apps/server/drizzle/0063_*`。
- 不可以改：`packages/contracts/**`、plaza 模块、`docs/quality/**`。

## 交付物

1. 白名单快照生成（严格按契约 schema，不多带任何字段）。
2. 按快照创建角色（`origin = plaza_copy`、来源作品与版本、锁定字段、数据库触发器禁止放宽）。
3. 应用改版、按新版本替换、管理员批量更严更正（含触发退出成人模式的事件）。
4. 来源标注所需字段（作品、作者、版本）。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译。

## 验收标准（留给 Codex 整体验收）

- [ ] 复制一个真人作品后分类不可改为原创或虚构，情景模式中没有成人模式；改名、删掉真实身份事实后仍为真人。
- [ ] 复制基于江流儿的预设改版，新角色为儿童角色：没有成人模式、没有「恋人」关系、没有恋爱模式。
- [ ] 「应用改版」后补充设定变为改版内容，聊天记录、记忆、熟悉度不变。
- [ ] 直接改数据库字段把复制品分类放宽会被触发器拒绝。

## 交付

分支 `T-088-l7-characters-plaza`，worktree `C:\wb-dev\wb-t088`，交接 `docs/handoffs/2026-10-09-backend-lead-T-088.md`。其余按 index 第 2 节。
