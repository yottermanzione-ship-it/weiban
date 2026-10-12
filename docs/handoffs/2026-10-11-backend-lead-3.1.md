# 交接说明：契约 3.1 后端实现（B1～B21）

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人 |
| 日期 | 2026-10-12 |
| 分支 / 提交 | `backend-3.1`（worktree `C:\wb-dev\wb-b31`）；第一批 `2ebc29f`，第二批代码 `11a1793`（内容已由 Codex 以 `b16dc3f` 接续合入），合并 `8ebee7b`，说明文档 `d472ba3`；均已快进合入 `local/trunk` |
| 自检 | 服务器 `tsc --noEmit`、改动文件 eslint + prettier、`pnpm lint:deps` 通过；按要求没写、没跑测试 |

## 做了什么

契约 3.1 后端清单 B1～B21 全部实现。第一批（B1～B10）由我完成并合入。第二批（B11～B21）的代码我也写完了，但还没提交时额度用完了；这段时间 Codex 顶班，把 worktree 里的改动原样提交成 `b16dc3f`，又补了测试，还把 AI 接入点绑到了真实实现上。我恢复后提交了自己的版本，再合并 `local/trunk`，结果和 trunk 完全一样（冲突都取 trunk 版本，没有丢内容）。逐项说明见 `docs/backend/contracts-3.1.md`。

| 项 | 状态 |
|---|---|
| B1～B10 | 后端完成（`2ebc29f`） |
| B11～B20 | 后端写成，Codex 接续提交（`b16dc3f`）并补测试 |
| B21 | 后端先放了兜底实现，Codex/AI 侧已换成 ai-runtime 的真实实现 |

迁移：0070～0074 按对照表来，都已登记 `_journal.json`。迁移号和 Codex 的 0075～0082 没有冲突，不需要顺延。

## 改了哪些文件

- identity：`application/settings.ts`、`tokens.ts`、`index.ts`、`identity.module.ts`
- chat：`application/write.ts`、`application/search.ts`、`http/search.controller.ts`
- characters：`application/{characters,custom-character,plaza-port,supplements,work-links}.ts`、`http/work-links.controller.ts`、`tokens.ts`、`index.ts`、`characters.module.ts`
- media：`application/assets.ts`、`tokens.ts`、`index.ts`、`media.module.ts`、`infra/db/schema.ts`
- growth：`application/{cards.service,context,pets.service}.ts`、`tokens.ts`、`index.ts`、`infra/db/pets-schema.ts`
- library、importer、model-access、billing（新增 `application/quotes.ts`）、plaza、play 各自的 application / schema / 装配文件
- `apps/server/src/app.module.ts`
- 迁移 `apps/server/drizzle/0070～0074_*.sql`（含 `.down.sql`），以及 `meta/_journal.json`
- `packages/eslint-config/architecture.js`：把「待架构补记」的注释改成引用 ADR-0024 补记
- `docs/backend/contracts-3.1.md`（新增）

## 遗留问题

- **契约变更申请（B7）**：契约里 `CharacterPlazaPort.applyVariant` 的参数没有 `childFeaturesDetected` 这一项。现在 plaza 用对象展开的写法把它附带过去，characters 再把结果存进 `user_supplements.plaza_source`。建议架构把这个可选字段补进契约。
- **B7 只存了标记，还没有生效**：预设改版里检出的儿童特征，现在只存在这位用户的补充设定上（`CharacterSupplementService.variantChildFeaturesDetected`）。运行时的成人模式资格判断（policy / ai-runtime）还没读这个标记，需要 AI 或架构决定由谁接入。
- B10：古风卡面模板走 media 的内部令牌 `MEDIA_CLASSICAL_CARD_TEMPLATES`，没有改契约里 `listCardTemplates` 的签名。ai-runtime 发图挑卡面时没有用古风规则。
- B11：收藏的头像快照借用了媒体用途 `contact_avatar`，因为契约里没有专门给收藏快照的媒体用途。
- B14：生成卡片文案的 AI 调用发生在发卡事务里面，最长会多占 3 秒的锁。
- B18：`BillingQuotePort` 只靠写法约定「只给 model-access 用」，没有加 lint 规则来强制。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 AI：A1～A12 需要的令牌都已导出（`IDENTITY_SETTINGS_WRITE_PORT`、`MODEL_QUOTE_PORT`、`BILLING_DAILY_SPEND_READ_PORT`、`CHARACTER_SUPPLEMENT_CONFLICTS`（返回 `PortResult`，可以传 sha256）、`CHARACTER_CHILD_FEATURES_WRITER`）；`growth.pet_naming_requested` 已带 `speciesName`；图片消息由 chat 统一填 `sizeBytes`，角色发图不用再自己填。改版儿童特征标记怎么接入运行时，见上面的遗留问题。
- 给网页 / 安卓：W1～W11 用到的服务器接口都已上线：按日期定位 `GET /conversations/:id/messages/locate`、按类型列出 `.../messages/by-type`、搜索支持 `senderParticipantId`、收藏快照与 `seq`、`mergedIntoJobId`、`visionAvailable`、广场新字段与 `unreadCount`、寄信的 `replyDelayReason`、三种玩法系统提示；后台还有 `GET /admin/characters/:id/voice`、`GET /admin/plaza/works/:id`、`GET /admin/plaza/bans`，卡面模板 `classicalStyle`，宠物外观 `listed`。
- 给架构：上面的契约变更申请（applyVariant 加 `childFeaturesDetected`）。
- 给 Codex（总经理转交）：按 `contracts-3.1-map.md` 核对组合根绑定，AI 接入点现在已是真实实现。
