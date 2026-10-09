# T-047 L2 自定义角色手动创建与关系类型补完

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-08 |
| 状态 | 待开始 |

## 目标

让用户能**自己手动创建一个角色**（填名字、分类、说话方式、设定），创建时按分类单向规则校验、接入儿童特征检测，并能试聊；同时补完关系类型（GRW-02）与换模型提醒（MDL-06）里属于后端的部分。

## 背景

- `characters` 模块目前只有**管理后台的预设角色**接口（`GET/POST/PATCH /admin/characters` 等，见 `packages/contracts/src/http/characters.ts` 第 294 行起）。**用户侧的自定义角色创建（CHR-07）还没做**。
- 关系类型（GRW-02）后端骨架已在 `apps/server/src/modules/contacts/application/commands.ts`（`relationshipType` + `policy.checkRelationshipType`），但缺少 GRW-02 第 5 条要求的首次进入私聊提示、「恋人」对儿童角色的限制核对，以及 MDL-06 换模型提醒所需接口。
- T-043 交接（`docs/handoffs/2026-10-08-codex-T-043.md` 第 30～34 行）说明本层交接边界。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/03-characters.md` CHR-07、CHR-08（第 113 行起）、CHR-11
- `docs/product/prd-v1/10-hard-boundaries.md`（第 2 节、第 5 节）
- `docs/product/prd-v1/09-relationship-growth.md` GRW-02；`docs/product/prd-v1/02-model-billing.md` MDL-06
- `docs/architecture/` 中 characters、contacts、policy 的模块职责与数据域
- `packages/contracts/src/http/characters.ts`、`contacts.ts`、`companion.ts`
- `docs/product/prd-v1/05-memory.md`（试聊与记忆的关系）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/characters/**`、`apps/server/src/modules/contacts/**`、`packages/contracts/src/http/characters.ts` 与 `contacts.ts`（**本任务独占这两个契约文件的修改权**）、新增迁移 `apps/server/drizzle/0016_*`（**编号 0016 已为你保留**）。
- **不可以改**：`apps/server/src/modules/ai-runtime/**`（T-046 正在改）、`apps/web/**`（T-048）、`apps/admin/**`（T-049）、`docs/quality/**`（归 Codex）。
- 改契约必须同步 `packages/contracts/src/index.ts` 导出、契约版本号（`src/version.ts`）与生成物，并在交接里写契约变更申请说明（改什么、为什么、影响谁）。

## 验收标准

逐条可检查，质量负责人照此验收：
- [ ] 用户能创建自定义角色：填名字、分类、说话方式、性格设定等，落库并可在角色库看到（集成测试）
- [ ] 分类**单向规则**生效：创建时按 CHR-07 校验，「真人」分类有明确定义说明字段，越界组合被拒绝（测试覆盖拒绝路径）
- [ ] 儿童特征检测接入：命中儿童特征的角色的成人模式资格被正确推导为不可用（SAFE-05）
- [ ] 试聊可用：能在正式添加前试聊，试聊不写入长期记忆（测试断言记忆表无新增）
- [ ] 「系统写入的只增标记 `everPrivatePerson`」按 CHR-07 第 7 条落库，为 L7 广场裁定 C1 做准备，且**只增不减**（测试）
- [ ] 关系类型五选项可设，自定义描述 ≤30 字；**儿童角色不可选「恋人」**，含恋爱含义的自定义描述不生效并提示（测试）
- [ ] 关系类型只有用户能改：证明角色回复流程不能改关系（测试）
- [ ] 首次进入私聊的关系提示所需字段已返回，「明星」默认「粉丝与偶像」、其他默认「朋友」（测试）
- [ ] MDL-06 换模型提醒所需接口就绪（换模型后返回需要提示的角色范围信息）
- [ ] 迁移 0016 有 up 与 down，迁移与回滚都跑通
- [ ] 本机相关测试**跳过 0 条**
- [ ] 没有为让检查通过而放宽断言、跳过测试或改门禁

## 交付物

- 代码 / 文档路径：`apps/server/src/modules/characters/**`、`apps/server/src/modules/contacts/**`、`packages/contracts/src/http/characters.ts`、`contacts.ts`、`apps/server/drizzle/0016_*`
- 交接说明：`docs/handoffs/2026-10-08-backend-lead-T-047.md`
- 分支：`T-047-l2-custom-character`（已建好，worktree 在 `C:\wb-dev\wb-t047`）
- **给 Web 负责人的交接**：自定义角色创建要写进交接说明，T-048/T-050 要照它做编辑器界面。


## 2026-10-09 Codex CI 接续

本轮仅修复PR #9的格式、未使用项及后续测试暴露的年龄误判；源码 `32120456a78b106504939f2ab258a6f3ad32c6ac`。本地针对性26条、完整482条零跳过及安卓契约生成一致性通过；最终远端CI与限制见 `docs/handoffs/2026-10-09-backend-lead-T-047.md` 追加记录。只登记开发自测，独立验收另行安排；原任务验收清单不由本轮勾选。
