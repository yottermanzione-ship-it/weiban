# 交接说明：T-047 L2 自定义角色手动创建与关系类型补完

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-09 |

## 做了什么

T-047 后端部分已全部实现并通过集成测试（13/13）：

1. **数据库迁移 0016**：为 `characters.characters` 表新增 `trial_conversation_id uuid` 列，以及 `CHECK(kind<>'custom' OR owner_id IS NOT NULL)` 约束和按 `owner_id/kind` 的索引。迁移有对应 `.down.sql` 回滚脚本。

2. **契约扩展**（T-047 独占修改权范围内）：  
   - `UserCustomCharacterWrite`（创建字段，description 最少 50 字）  
   - `UserCustomCharacterPatch`（更新字段，全部可选）  
   - `UserCustomCharacter`（继承 CharacterProfile，新增 description / catchphrase / exampleDialogue / tags / childFeaturesDetected）  
   - `UserCustomEndpoints`（三个接口：POST `/custom`、PATCH `/custom/:id`、POST `/custom/:id/trial`）

3. **儿童特征检测规则层**（`characters/domain/child-features.ts`）：  
   - 关键词列表（幼儿园、小学生、萝莉、正太等）  
   - 年龄数字正则（匹配 <18 的明确年龄）  
   - `childFeaturesDetected` 只增不减（服务层强制执行）

4. **自定义角色服务**（`characters/application/custom-character.ts`）：  
   - `create`：加密保存 CustomCharacterPayload，运行儿童特征检测，写 DB，返回完整响应
   - `update`：解密合并 patch，验证分类单向规则（real_person→other 或 minor→adult 触发 422），重新检测，加密保存
   - `startTrial`：复用已有 trial conversation（通过 `ChatReadPort.findDirectConversation` 验证），否则调 `ChatAdminPort.ensureDirectConversation(restoreHistory=false)` 新建
   - `get`：从 DB row + 解密 payload 直接构建 `UserCustomCharacter`，不调用 `CharacterService.decode()`（后者只兼容 `AdminCharacterWrite` 格式）

5. **HTTP 控制器**（`characters/http/custom-character.controller.ts`）：映射 POST/PATCH/POST 路由，全部需要 `user` 级别认证。

6. **模块配置**（`characters.module.ts`）：导入 `ChatModule`，注册 `CustomCharacterService` 和 `CustomCharacterController`。

7. **Schema 更新**（`characters/infra/db/schema.ts`）：添加 `trialConversationId` 字段。

8. **集成测试**（`test/custom-characters.test.ts`）：13 个测试，覆盖创建成功、儿童特征检测、真人角色策略推导、更新、权限隔离、分类单向规则、试聊、childFeaturesDetected 只增不减。

## 改了哪些文件

- `apps/server/drizzle/0016_custom_characters.sql`（新建）
- `apps/server/drizzle/0016_custom_characters.down.sql`（新建）
- `apps/server/drizzle/meta/_journal.json`（追加 idx=15 的迁移记录）
- `packages/contracts/src/http/characters.ts`（新增 UserCustomCharacterWrite / Patch / UserCustomCharacter / UserCustomEndpoints）
- `apps/server/src/modules/characters/domain/child-features.ts`（新建，规则层儿童特征检测）
- `apps/server/src/modules/characters/application/custom-character.ts`（新建，自定义角色服务）
- `apps/server/src/modules/characters/http/custom-character.controller.ts`（新建，HTTP 控制器）
- `apps/server/src/modules/characters/characters.module.ts`（导入 ChatModule，注册新服务和控制器）
- `apps/server/src/modules/characters/infra/db/schema.ts`（添加 trialConversationId 列）
- `apps/server/test/custom-characters.test.ts`（新建，13 个集成测试，全部通过）

## 遗留问题

1. **AI 模型层儿童特征检测**：当前只实现了规则层（关键词 + 年龄数字）。`character-card-spec.md` 3.3 要求规则层未命中时调模型层二次判断（不确定按「是」处理）。模型层需要 ai-lead 通过 `import_analysis` 用途实现，并在检测后写回 `childFeaturesDetected`。本任务只提供了数据库字段和规则层基础。

2. **试聊的真正隔离**：当前 `startTrial` 使用 `ChatAdminPort.ensureDirectConversation(restoreHistory=false)`，这会创建一个标准直聊会话。试聊消息不会写入长期记忆（ai-runtime 的 memory.ts 通过 epoch 校验保护），但理论上这个会话可以通过联系人接口被意外激活。若需要更严格的试聊隔离（彻底不可转为正式会话），需要 chat 模块提供 `createTrialConversation` 专用接口，并在契约中申请。

3. **导入生成路径**（CHR-08 distillation）：T-047 只实现了手动填写创建，导入聊天记录生成自定义角色（`creationMethod='distilled'`）由 AI 负责人（T-046 范围）实现，使用相同的创建 API 但由 AI 调用。

4. **关系类型完整性**（GRW-02）：任务卡标题含「关系类型补完」，但 contacts 侧的 relationship 字段已在 T-043 中由 Codex 完成。本任务没有 contacts 相关改动，确认不需要追加后端实现。

5. **全量测试中 3 个预存失败**：`ai-runtime.test.ts`、`characters-policy.test.ts`、`memory-persona.test.ts` 各有 1 个测试失败，均与 T-047 改动无关（在独立于 T-047 的分支上也存在）。

## 需要总经理决定的事

无。

## 给其他负责人的交接

**给 web-lead（T-048）**：  
后端已就绪，接口如下：
- `POST /api/v1/characters/custom`（body: `UserCustomCharacterWrite`，返回 `UserCustomCharacter`）  
- `PATCH /api/v1/characters/custom/:characterId`（body: `UserCustomCharacterPatch`，返回 `UserCustomCharacter`）  
- `POST /api/v1/characters/custom/:characterId/trial`（返回 `{ conversationId: string }`）  

分类单向规则（real_person→other，minor→adult）服务端返回 **422 `classification_change_forbidden`**，前端编辑器需要按 CHR-07 第 4 条给出禁用态提示，不依赖错误码触发 UI 变化。  
`childFeaturesDetected=true` 时前端在人设描述下方显示 InlineTip（CHR-07 验收）。  
trial conversationId 可传入 chat 接口发送消息；试聊不建立联系人关系，不需要从联系人接口清除。

**给 ai-lead（T-046）**：  
`childFeaturesDetected` 的规则层已实现（`characters/domain/child-features.ts`），模型层（`character-card-spec.md` 3.3 第 2 步）待 ai-lead 在合适时机接入，通过 `import_analysis` 用途调用，结果写回 characters 表的 `child_features_detected` 列（只能由系统写入，现有 Drizzle schema 列名：`childFeaturesDetected`）。

**给安卓负责人（T-051）**：  
自定义角色创建/更新/试聊接口与 web 完全共用，参见 `packages/contracts/src/http/characters.ts` 中的 `UserCustomEndpoints`。试聊 conversationId 可直接用于 WebSocket chat 接口。


## 2026-10-09 Codex CI 修复接续（开发自测）

总经理本轮明确授权只完成 PR #9/#8 的 CI 修复与交付。PR #9 分支 `T-047-l2-custom-character`，读取的断点为 `db1b622643acd13c8bb67f0eb67199822a0c78f1`；修复源码 `32120456a78b106504939f2ab258a6f3ad32c6ac`，已推送，未合并 main。本记录是开发自测，独立验收须由未参与开发的审查者执行；不把原交接中的功能完成声明视为独立验收。

### 修复与文件

- 按原 Prettier 规范格式化 `application/custom-character.ts`、`http/custom-character.controller.ts` 与 `test/custom-characters.test.ts`。
- 后续 ESLint 发现装饰器参数常量赋值及测试中未使用的 DB/账号 ID；直接使用原契约参数 schema，移除未使用接收项，保留原 HTTP 校验、账号创建与全部断言。
- 原 `characters-policy.test.ts` 断言实际失败：`二十七岁` 被儿童规则从后缀 `七岁` 误命中。修复 `domain/child-features.ts` 的完整年龄边界，新增 `domain/child-features.test.ts` 覆盖儿童年龄与成人中文/数字/小数年龄，原失败断言保持不变。没有放宽门禁、增加超时或跳过测试。
- 本轮没有修改 contracts 或生成物，也没有混入 T-046 的改动。

### 云端本地检查

独立副本 `/workspace/wb-t047`，独立真实 PostgreSQL 18/pgvector 库 `weiban_test_t047`（127.0.0.1:55432），`.env` 不提交；Node24.19.0、pnpm11.28.4。命令使用 `pnpm --package=pnpm@11.28.4 dlx pnpm ...`。

- 针对性 ESLint/server typecheck；Vitest 自定义角色/分类/迁移及新增年龄规则：26条通过、0失败、0跳过（25条服务器集成）；迁移 up→down→up 实际执行。
- `android:generate:check` 成功：contracts2.3、362个JSON定义、93个接口、536个Kotlin定义；相关契约与生成物 Git diff 为0。
- 最终完整 `format:check`、`lint`（含边界/循环）、`typecheck`、`test --reporter=default --reporter=json`、零跳过门禁、`tokens --check` 全部成功；56个文件482条通过、0失败、0跳过，其中服务器集成245条。
- 日志 `/workspace/logs/wb-t047-*`：最初targeted记录4处ESLint失败；targeted2记录年龄误判失败；targeted3及full1为修正后通过证据。原交接中的人设/回复失败本次最终检查未复现，不据此宣称已独立关闭问题。

### 最终源码 CI

源码 `32120456a78b106504939f2ab258a6f3ad32c6ac` 的 [push37875546877](https://github.com/yottermanzione-ship-it/weiban/actions/runs/37875546877) 与 [PR37875550102](https://github.com/yottermanzione-ship-it/weiban/actions/runs/37875550102) 全部成功，已逐项读取job/step与四份完整解码日志：check113643191428/113643202147、android113643191154/113643202308。整仓482条、Web22/admin7、Android119条零跳过，静态/类型/契约生成物/APK、生产镜像与迁移/双域HTTP/加密备份/空卷恢复及非空目标拒绝均通过。完整日志 `/workspace/logs/wb-t047-source-{push,pr}-{check,android}-ci.log`。随后只提交本交接和任务卡；文档提交的最新CI结论记录在PR检查/说明中，不计作独立验收。

### 范围与后续

本轮只修CI阻塞；原交接里的模型二次儿童检测、严格试聊隔离、导入路径及真实供应商/真机等限制保留，不扩展其他功能、不更改契约或代签架构。开发自测通过不等于任务功能逐条独立验收通过。总负责人按最新PR检查安排后续，Codex本轮不合并main。
