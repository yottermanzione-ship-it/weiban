# 交接说明：儿童特征永久从严（B7 遗留）

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人 |
| 日期 | 2026-10-12 |
| 分支 | `child-flag-permanent`（worktree `C:\wb-dev\wb-child`），合入 `local/trunk` |
| 自检 | 服务器 / 契约 typecheck、改动文件 lint 通过；按总经理要求未写、未跑测试 |

## 做了什么

1. **标记挪到独立表**：新表 `characters.user_child_feature_flags`（迁移 0083，已登记 `_journal.json`，含 down；上线时从 `user_supplements.plaza_source` 回填旧标记）。用户套用检出儿童特征的预设改版时写入，只增不减——改写或删除补充设定都不会清掉。`variantChildFeaturesDetected` 改读此表，`getForRuntime` → policy 的成人模式 / 恋爱 / 成人模型资格自动跟随。已并入 characters 删除清单与数据计数。
   - 没有做成 `user_supplements` 上的一列：用户「删除补充设定」会整行删掉，列也会跟着没，达不到「永久」。
2. **套用时立即切回日常**：标记第一次写入时（同一事务）发 `characters.character_classification_changed`，分类按「检出儿童特征」重算，`ownerUserId` 填这位用户。ai-runtime 现有 T-090 处理逻辑按 `ownerUserId` 过滤，只把这位用户与该角色的私聊成人 / 恋爱模式切回日常、内容范围改 normal、写系统提示，群聊同样走 `onCharacterClassificationChanged`。预设本身已检出儿童特征时不发（没有变化）。ai-runtime 无需改代码。
3. **契约登记**：`contracts-3.1-map.md`（迁移表加 0083、末尾补登一节）、ADR-0028 补记、契约 README 3.1 那条更新；`events.ts` 里该事件注释补一句 `ownerUserId` 的新用法（字段结构不变）。

## 改了哪些文件

- `apps/server/drizzle/0083_user_child_feature_flags.sql`、`.down.sql`、`meta/_journal.json`
- `apps/server/src/modules/characters/infra/db/schema.ts`
- `apps/server/src/modules/characters/application/supplements.ts`、`plaza-port.ts`、`characters.ts`
- `packages/contracts/src/events.ts`、`packages/contracts/README.md`
- `docs/architecture/contracts-3.1-map.md`、`docs/decisions/ADR-0028-contracts-3.1-backlog-closeout.md`

## 遗留问题

- 未写、未跑测试；迁移未在真实库上执行过。
- `plaza_source.childFeaturesDetected` 仍照旧写入（展示用、兼容），判断已不再读它。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给架构：`character_classification_changed.ownerUserId` 对预设角色的新用法（限定单个用户）已登记在 3.1 对照表末节，如有异议请提。
- 给 AI：无需改动；T-090 处理器会收到 `ownerUserId` 非空的预设角色事件，行为即「只影响这位用户」。
- 给 Codex（总经理转交）：验收看「套用带儿童特征改版 → 该用户正在成人模式的私聊 / 群立刻切回日常并有系统提示；之后改写 / 删除补充设定，成人模式仍不可选；其他用户不受影响」。
