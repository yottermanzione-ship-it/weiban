# importer（导入聊天记录 / 截图 / 资料）与补充设定（T-079）

> 负责人：backend-lead · 2026-10-10 · 契约：`http/importer.ts`（`ImporterEndpoints`）、`http/character-extras.ts`（`CharacterSupplementEndpoints`、`PersonaUpdateEndpoints`）· 迁移 0055

## 1. 代码位置

| 部分 | 位置 |
|---|---|
| 导入任务、原文暂存、格式识别、后台任务 | `apps/server/src/modules/importer/`（上层，schema `importer`） |
| 格式识别（纯函数） | `importer/domain/parse.ts` |
| 补充设定、「资料已更新」 | `characters/application/supplements.ts`、`characters/http/supplements.controller.ts` |
| AI 端口 | `IMPORTER_ANALYZER`（importer/tokens.ts，契约 `ImportAnalyzerPort`），由 T-081 在 `app.module.ts` 绑定 ai-runtime 的实现；未绑定时识别 / 生成以 `model_unavailable` / `vision_unavailable` 失败，`start` 返回 `service_disabled` |

## 2. 状态机

- 粘贴文字：创建即 `detecting`（后台任务 `importer.detect`）。
- 文件 / 截图：`collecting` → `uploadFile`（multipart 字段 `file`）若干次 → `finishUpload` → `detecting`。
- 文字识别：规则识别（下节）→ 不足两个发言人时交模型 `detectSpeakers`（只给前 4000 字样本，再按识别出的名字切全文）→ 仍不足两人 `failed(format_unrecognized)`。
- 截图：`recognizeScreenshots` → `awaiting_dialogue_confirmation` → `confirmDialogue`（可改行）→ `awaiting_speaker`。
- `selectSpeaker` → `ready`（调 `estimate` 给预计花费）→ `start`：`BillingReadPort.getSpendStatus` 余额不足（`insufficient` 或可用余额 < 预计花费）返回 422 `insufficient_balance`，不开始 → `analyzing`（后台任务 `importer.analyze`，进度每 2 秒最多写一次）→ `completed` / `failed`。
- `failed` 且原文还在时可再次 `start`（设计稿的「重试」）。
- 每次状态变化写 `data.changed(imports)`；分析结束发 `importer.job_completed`（ok true/false）并推送。

## 3. 格式识别

依次尝试：「日期 时间 名字」头行 + 内容行；「名字 日期 时间」头行 + 内容行；「[日期 时间] 名字: 内容」同行；「名字：内容」；CSV（时间, 发言人, 内容，可带表头、双引号转义；文件名是 .csv 时优先）。识别出两个以上发言人才算成功。超过 20 万字只取最近的部分（`truncated = true`）。文件按 UTF-8 解码，乱码多时改按 GB18030。

## 4. 原文与删除（security-and-privacy.md 5.3）

- `importer.import_raw`：`text`（原文，按 5 万字一块用用户数据密钥加密）、`lines`（识别出的对话 JSON，加密）、`screenshot`（media `import_screenshot` 的 ID）。
- 分析成功且未勾选保留：同一事务删除原文行、物理删除截图（`MediaSystemPort.deleteObject`）、写 `raw_deleted_at`。
- 分析失败时暂留原文供重试；兜底清扫 `importer.raw_sweep` 每小时第 17 分钟删除未勾选保留、创建超过 24 小时的任务原文。
- `cancel` 删除任务和原文；`deleteRaw` 删除保留的原文。
- 结果（`ImportResult`）加密存 `import_jobs.result_ciphertext`，`saveResultDraft` 覆盖它。
- 日志只记 jobId 与错误类型名，不记原文。

## 5. 补充设定与「资料已更新」

- `characters.user_supplements`：只对预设角色、只对本人；正文加密。保存发 `characters.supplement_changed`。冲突项由 AI 经内部令牌 `CHARACTER_SUPPLEMENT_CONFLICTS.setConflicts` 写入，用户再次手写保存时清空。
- `CHARACTER_SUPPLEMENT_PORT`：契约 `CharacterSupplementPort`，供 ai-runtime 组装人设。
- `characters.persona_update_seen`：用户第一次看到某预设角色资料时记下当时版本；版本变大即 `personaUpdatedUnseen = true`；`markPersonaUpdatesSeen` 清除。列表取有摘要的版本（最多 20 条）。

## 6. 删除清单

importer 登记 `module: 'importer'`（任务、原文、截图）；补充设定与已读位置并入 characters 的删除清单。
