# characters 配合人设广场：后端实现说明（T-088）

> 负责人：后端负责人 · 2026-10-10 · 依据 `docs/architecture/persona-plaza.md` 第 4、5 节、`docs/architecture/hard-boundaries.md` 第 6 节。

## 1. 代码位置

| 文件 | 作用 |
|---|---|
| `apps/server/src/modules/characters/application/plaza-port.ts` | 契约 `CharacterPlazaPort` 实现与来源标注接口 |
| `apps/server/src/modules/characters/domain/custom-card.ts` | 自定义角色存储格式；合成运行时 WB-Card；预设卡去掉专有数据 |
| `apps/server/src/modules/characters/http/custom-origin.controller.ts` | `GET /characters/custom/:id/origin` |
| `apps/server/src/modules/policy/domain/rules.ts` | `compareClassification`（「只能更严」的唯一判定处） |
| `apps/server/src/modules/contacts/application/commands.ts` | `ContactsWritePort.addForUser` |
| `apps/server/drizzle/0063_characters_plaza.sql` | 来源列、复制幂等键唯一索引、分类触发器扩展到复制品 |

## 2. 规则落点

- **白名单快照**：只读 PLZ-02 第 3 条字段，按契约严格 schema 校验；`everPrivatePerson` 或当前「基于身边真人」→ forbidden；真人分类头像为空。
- **按快照创建**：`origin_kind = plaza_copy`，记录作品、版本、作者昵称；分类事实全部来自快照（预设改版取该预设当前分类与当前人设版本）；`plaza_idempotency_key`（adoptionId，文本）唯一，重试不重复建角色。复制品状态为 active，从「认识第 1 天」开始（由 contacts 添加流程决定）。
- **只能更严**：用户编辑复制品分类时调用 `compareClassification`，横向修改也拒绝；数据库触发器 `guard_classification` 兜底（复制品的虚构 ↔ 原创、真人子类互换、儿童特征从是变否、来源改写都会被拒）。
- **更新 / 更正**：按新版本更新时分类逐项取更严一边；管理员更正只接受不放宽的目标。分类变化在同一事务发 `characters.character_classification_changed`，ai-runtime 据此退出成人模式。人设版本号加一。
- **应用改版**：写入「我的补充设定」并记录 `plaza_source`，聊天、记忆、熟悉度不动，分类不变。

## 3. 顺带修复

自定义角色此前存的是简化 payload，而资料页、名字查询、AI 运行时都按预设角色格式解析，导致自定义角色无法添加、无法生成回复。现在 `CharacterService.decode` 对自定义角色合成完整 WB-Card（预设改版复制品直接用去掉专有数据的预设卡，并把改版设定并入背景），`canAdd` 允许创建者添加自己的自定义角色。
