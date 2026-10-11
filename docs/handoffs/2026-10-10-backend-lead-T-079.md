# 交接说明：T-079 L6 importer 导入模块

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-079-importer`，`7189265`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |

## 做了什么

1. **importer 模块**（`ImporterEndpoints` 全部 13 个接口）：粘贴文字、上传 .txt / .csv、批量上传截图（最多 30 张）；任务状态机（收集 → 识别 → 确认对话 → 选发言人 → 待开始 → 分析中 → 完成 / 失败）；进度查询；中途保存草稿（`saveResultDraft`）；取消、删除保留的原文。
2. **格式识别**：CSV（时间, 发言人, 内容）和几种第三方微信导出行格式、「名字：内容」；规则识别不出两人时交模型识别（只给 4000 字样本）；超过 20 万字只取最近部分并标 `truncated`。
3. **原文保护**：原文和识别出的对话按用户密钥加密暂存；分析成功且没勾「保留原文」时在同一个事务里删除原文和截图、写 `raw_deleted_at`；失败时暂留供重试；每小时兜底清扫超过 24 小时的未保留原文。
4. **余额**：开始前用 `BillingReadPort` 检查，不足返回 422 `insufficient_balance`，不开始。
5. **完成通知**：发 `importer.job_completed`（成功 / 失败都发）、`data.changed(imports)`、推送「导入完成」。
6. **characters 扩展**：补充设定（`CharacterSupplementEndpoints`，只对预设角色、只对本人、正文加密、发 `characters.supplement_changed`）；「资料已更新」（`PersonaUpdateEndpoints` + 资料页 `personaUpdatedUnseen` 真实计算）。提供 `CHARACTER_SUPPLEMENT_PORT`（契约 `CharacterSupplementPort`）。
7. **删除清单**：importer 登记任务、原文、截图；补充设定与已读位置并入 characters 删除清单。
8. 实现说明：`docs/backend/importer.md`。本地 typecheck、lint 通过；未写测试。契约未改。

## 改了哪些文件

- 新增 `apps/server/src/modules/importer/**`（module、controller、service、domain/parse、schema、tokens、index）
- 新增 `apps/server/src/modules/characters/application/supplements.ts`、`http/supplements.controller.ts`；改 `characters/application/characters.ts`（资料页红点、删除清单）、`infra/db/schema.ts`、`tokens.ts`、`index.ts`、`characters.module.ts`
- 改 `apps/server/src/app.module.ts`（装配 `ImporterModule`）
- 新增迁移 `apps/server/drizzle/0055_importer.sql/.down.sql`（含 characters 两张表），`meta/_journal.json` 登记 55
- 新增 `docs/backend/importer.md`

## 遗留问题

- **AI 端口未绑定**：`IMPORTER_ANALYZER`（契约 `ImportAnalyzerPort`）由 T-081 实现后在 `app.module.ts` 加一行 `{ provide: IMPORTER_ANALYZER, useExisting: <ai-runtime 的实现令牌> }`（全局组合模块，同 `CALL_AGENT_PORT` 的写法）。未绑定前：识别规则失败的文本、截图识别、生成都会失败，`start` 返回 `service_disabled`。
- **契约缺口 1（推送种类）**：`NotificationKind` 有 `import`，但 `PushPort` 的 `PushRequest.kind` 只有 `model_status | call | system`，导入完成推送暂用 `system`，deepLink `/imports/{jobId}`。请架构给 `PushRequest.kind` 加 `import`。
- **契约缺口 2（分批合并）**：PRD 说「分批内容合并进同一份草稿」，但 `createJob` 没有「追加到哪个任务 / 哪份草稿」的字段。现在每批是独立任务。请架构决定是否加 `mergeIntoJobId` 之类的可选字段。
- **契约缺口 3（补充设定冲突项）**：`ImportResult.supplement` 只有 `text`，没有冲突项；`putSupplement` 也不接收冲突项。我提供了内部令牌 `CHARACTER_SUPPLEMENT_CONFLICTS.setConflicts` 给 AI 写入，但何时调用需 T-081 与架构对齐。
- `getJob` 契约注释提到 `importer.job_updated`，实际按 `data.changed(imports)` 实现（契约里没有这个更新类型）。
- 预计花费拿不到（分析器未绑定或估算失败）时 `estimatedMicros = null`，余额检查只要求可用余额 > 0。
- 自定义角色的导入结果「直接合并进人设」由客户端调已有 `PATCH /characters/custom/:id`，后端未另做。
- 未在数据库上实际跑迁移（本轮不测试）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-081）：①实现 `ImportAnalyzerPort` 并在 `app.module.ts` 绑定 `IMPORTER_ANALYZER`；②`analyze` 的 `onProgress` 传 0～100；`idempotencyKey` 每次重试都不同（含任务更新时间）；③截图 mediaId 用 `MediaSystemPort.readBytes` 读；④补充设定组装人设请注入 `CHARACTER_SUPPLEMENT_PORT`；冲突项可用 `CHARACTER_SUPPLEMENT_CONFLICTS`。
- 给架构：上面三处契约缺口；以及「资料已更新」基线规则（第一次看到角色时记当时版本，不对新用户亮红点）请确认。
- 给网页 / 安卓（T-084 / T-086）：上传用 multipart 字段 `file`，文件和截图同一个接口；失败原因读 `failure`；失败后可直接再调 `start` 重试；完成后 `getResult`，编辑中途用 `PUT .../result` 保存；轮询或监听 `data.changed(imports)`。
- 给运维：新增定时任务 `importer.raw_sweep`（每小时第 17 分钟），队列 `importer.detect`、`importer.analyze`。
- 给总负责人：已合并进 `local/trunk`（`7189265`）。
