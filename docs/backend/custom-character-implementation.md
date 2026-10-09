# T-047 自定义角色后端实现说明

| 项 | 内容 |
|---|---|
| 任务 | T-047 L2 自定义角色手动创建 |
| 负责人 | backend-lead |
| 日期 | 2026-10-09 |
| 参考 | PRD CHR-07，hard-boundaries.md 第 2 节，character-card-spec.md 3.3 |

## 1. 整体架构

自定义角色（kind='custom'）由创建者专属持有，通过三个新接口管理：

```
POST   /api/v1/characters/custom              → 创建
PATCH  /api/v1/characters/custom/:characterId → 更新
POST   /api/v1/characters/custom/:characterId/trial → 试聊
```

所有接口都需要 user 级别认证，且只有 ownerId = 当前用户才能操作。

## 2. 数据模型

自定义角色复用 `characters.characters` 表，迁移 0016 新增：

- `trial_conversation_id uuid`：试聊会话 ID，可为 NULL

关键约束：
- `CHECK(kind<>'custom' OR owner_id IS NOT NULL)` — 自定义角色必须有拥有者
- 数据库触发器 `guard_classification`（迁移 0008 已有）负责阻止分类字段向更宽松方向修改

加密：人设内容存入 `draft_ciphertext`，AAD 格式 `character:{id}:draft:{revision}`，加密密钥 = 用户 DEK。

payload 结构（存入加密字段的 JSON）：
```typescript
interface CustomCharacterPayload {
  name: string;
  description: string;       // ≥50 字
  classification: { basis, realPersonKind, ageSetting, childAppearance };
  birthday: string | null;
  catchphrase: string | null;
  exampleDialogue: string | null;
  tags: string[];
  avatarMediaId: string | null;
}
```

## 3. 分类单向规则

规则由两层保护：

1. 服务层（`CustomCharacterService.update`）：调用 `classificationCanChange()` 检查，不符合返回 **422 `classification_change_forbidden`**。
2. 数据库层：`guard_classification` 触发器拦截直接 SQL UPDATE，返回 PostgreSQL 错误码 23514。

规则含义（来自 hard-boundaries.md 第 2 节）：
- `real_person` → 其他分类：禁止
- `minor` → `adult`（ageSetting）：禁止
- `childAppearance=true` → `false`：禁止

## 4. 儿童特征检测

检测在每次 create/update 时同步执行（规则层，零费用），结果写入 `childFeaturesDetected`：

规则层实现：`characters/domain/child-features.ts`
- 关键词：幼儿园、小学生、初中生、高中生、萝莉、正太、未成年、奶声奶气、肉嘟嘟等
- 年龄数字正则：匹配 <18 的明确年龄表达（「8岁」「十二岁」等）

**`childFeaturesDetected` 只增不减**：服务层用 `detected || current.childFeaturesDetected` 保证此字段单调为 true。

模型层（character-card-spec.md 3.3 第 2 步）暂未实现，由 ai-lead 在 T-046 中通过 `import_analysis` 用途接入。

## 5. 试聊

试聊通过 `ChatAdminPort.ensureDirectConversation(restoreHistory=false)` 创建标准直聊会话：
- 不建立 contacts 联系人记录，所以试聊不出现在通讯录
- ai-runtime 的 memory.ts 通过 contact epoch 校验保护长期记忆不写入
- `restoreHistory=false` 确保每次新建试聊不复用旧历史
- 已有 `trial_conversation_id` 时，先通过 `ChatReadPort.findDirectConversation` 确认会话存在再复用

## 6. 文件列表

| 文件 | 说明 |
|---|---|
| `drizzle/0016_custom_characters.sql` | 数据库迁移 up |
| `drizzle/0016_custom_characters.down.sql` | 数据库迁移 down |
| `packages/contracts/src/http/characters.ts` | 新增 UserCustomCharacterWrite/Patch/UserCustomCharacter/UserCustomEndpoints |
| `characters/domain/child-features.ts` | 规则层儿童特征检测 |
| `characters/application/custom-character.ts` | 自定义角色服务（create/update/startTrial/get） |
| `characters/http/custom-character.controller.ts` | HTTP 控制器 |
| `characters/characters.module.ts` | 导入 ChatModule，注册新服务和控制器 |
| `characters/infra/db/schema.ts` | 添加 trialConversationId 列 |
| `test/custom-characters.test.ts` | 13 个集成测试（全部通过） |

## 7. 测试覆盖

集成测试（真实 PostgreSQL）：

| # | 测试点 | 验证 |
|---|---|---|
| 1 | 未登录返回 401 | 认证守卫 |
| 2 | 必填字段缺失返回 400 | 契约校验 |
| 3 | 描述少于 50 字返回 400 | 契约 min(50) |
| 4 | 创建成功，childFeaturesDetected=false | 成功路径 + 策略推导 |
| 5 | 描述含儿童特征时 childFeaturesDetected=true | 规则层检测 |
| 6 | 真人角色 adultModeEligible=false，portraitPolicy=forbidden | 策略推导 |
| 7 | PATCH 更新名字和口头禅 | 更新路径 |
| 8 | 非拥有者 PATCH 返回 404 | 权限隔离 |
| 9 | real_person→original 分类变更返回 422 | 单向规则 |
| 10 | minor→adult 分类变更返回 422 | 单向规则 |
| 11 | 试聊返回 conversationId，不建立联系人 | 试聊路径 |
| 12 | 其他用户无法发起试聊 | 权限隔离 |
| 13 | childFeaturesDetected 只增不减 | 单调性保证 |
