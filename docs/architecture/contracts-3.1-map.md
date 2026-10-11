# 契约 3.1 对照表：每项新增由谁实现、改哪些文件、用哪个迁移号

> 负责人：架构负责人 · v1.0 · 2026-10-11 · 来源：积压清理第一步（派发队列 `docs/handoffs/2026-10-09-pm-dispatch-queue.md`）
> 契约本身在 `packages/contracts/src/`（唯一准绳），变更记录见 `packages/contracts/README.md`「3.1」，决策见 ADR-0028。
> 3.0 的对照表 `contracts-3.0-map.md` 仍有效（L4～L7 每张卡的基础契约）；本文只列 3.1 增量。

产品收口补充⑱：管理素材类别`CardTemplateKind.daily_photo`用于聊天/朋友圈兜底图，后台与服务器同步部署，管理枚举按ADR-0028例外并入3.1；模板kinds为JSON，无需新迁移。`MediaAssetReadPort.listCardTemplates`新增可选`classicalStyleOnly`（省略为false），media实现过滤，ai-runtime历史人物传true并同时要求portraitFree。原有growth古风卡面令牌继续有效。

## 1. 先看结论

1. **契约 3.1 已合入，全部向后兼容**：现有服务器、网页、安卓不改代码也能编译运行；新字段在实现前只是「不返回」，客户端按注释里的默认行为处理。
2. 实现分四批，按顺序派：**后端 → AI → 网页 → 安卓**（第 3～6 节）。后端批里涉及 AI 端口的，后端先在 `app.module.ts` 留好令牌，AI 批再绑定实现。
3. 迁移号从 **0070** 起，分配见第 2 节（唯一定义处）。
4. 开发负责人仍不改 `packages/contracts/**`；发现缺口写进交接「契约变更申请」。合并方式不变（在自己 worktree `git merge local/trunk` → typecheck → 确认 `C:\wb-dev\wb-int` 干净 → 在那里 `git merge --no-edit <分支>`）。

## 2. 迁移编号（3.1 段，唯一定义处）

文件放 `apps/server/drizzle/00xx_名称.sql` 与 `.down.sql`，`meta/_journal.json` 按编号登记（`when` 严格递增）。0000–0069 已用或作废（见 `contracts-3.0-map.md` 第 2 节；其中没用到的空号不回收，避免与旧分支冲突）。

| 号 | 归属 | 内容 |
|---|---|---|
| 0070 | 后端 · library | `favorites` 加 `character_name_snapshot`、`character_avatar_media_id_snapshot`、`source_seq`（均可空） |
| 0071 | 后端 · media | `card_templates` 加 `classical_style boolean not null default false` |
| 0072 | 后端 · growth | `pet_appearances` 加 `listed boolean not null default true` |
| 0073 | 后端 · importer | `import_jobs` 加 `merge_into_job_id`、`merged_into_job_id`（可空，同用户外键） |
| 0074 | 后端 · plaza | 作者已读位置（每作品 `author_seen_at` 或独立表），供 `unreadCount`；`removedReason` 已有列则只建索引 |
| 0075 | AI · ai-runtime | 每日一问「角色自述」一致性存档（每用户 × 角色 × 话题一行：话题键、角色说法、来源 answerId；加密同记忆），并入 ai-runtime 删除清单（T-096 遗留 3） |
| 0076 | AI · ai-runtime | 纪念日寄信待寄队列（余额不足 / 模型故障时保留，恢复后补寄；过期规则同 PRD「信不丢」）（T-096 遗留 2） |
| 0077–0079 | 预留 | 3.1 实现中不够用时向总负责人申请 |

## 3. 后端批（backend-lead）

| # | 积压 | 契约位置 | 要做的事 | 主要文件 |
|---|---|---|---|---|
| B1 | ⑰ | `ports/identity.ts` `IdentitySettingsWritePort` | 实现 `enableProactiveCalls`（只开不关、幂等、非 active 返回 false），成功后照常发 `settings.updated(notifications)`；导出令牌 `IDENTITY_SETTINGS_WRITE_PORT` | `modules/identity/` |
| B2 | ⑲ | `http/chat.ts` `ImageContent.sizeBytes` | 用户发图、角色发图（含宠物照片）写消息时从媒体记录填字节数 | `modules/chat/application/`（发送校验处）、ai-runtime 发图处由 AI 批顺带 |
| B3 | ㉘ | `http/chat-groups.ts` `locateByDate`、`listByType`、`searchConversation.senderParticipantId` | 两个新接口 + 搜索按发送者过滤；`locateByDate` 按 `Profile.timezone` 算当天起点；`listByType` 用已有 `content_type` 列 | `modules/chat/http/`、`application/search.ts` |
| B4 | ⑲ | `http/character-extras.ts` `getDefaultVoice` | 读默认音色 + 经 `MediaAssetReadPort` 取名称 | `modules/characters/http/`（作品链接控制器） |
| B5 | T-098 | `http/characters.ts` `catchphrases`、`speechStyle`、可选可空`voiceId` | 自定义角色创建 / 修改写入角色卡 `speech.catchphrases`、`speech.tone`，响应返回；两者参与儿童特征检测。音色ID进入私有快照和运行时`social.voiceId`，陪伴音色优先且合成前检查启用状态；导入草稿保留选择，null明确清空，无新增迁移 | `modules/characters/application/custom-character.ts` |
| B6 | ㉕ | `ports/characters.ts` `CharacterSupplementConflictsWritePort` | 把内部令牌 `CHARACTER_SUPPLEMENT_CONFLICTS` 改为实现契约端口：加 `expectedTextSha256` 比对（不一致返回 `stale`），返回 `PortResult`，写入后发 `data.changed(section = supplement, characterId)` | `modules/characters/tokens.ts`、补充设定服务 |
| B7 | ㉝ | `CharacterChildFeaturesWritePort`；`PlazaPresetVariantSnapshot.childFeaturesDetected` | 内部令牌改实现契约端口（签名已兼容，只改类型名）；`applyVariant` 时取快照与预设分类中更严的 `childFeaturesDetected`，存在用户这份补充设定 / 运行时分类上，不写回预设 | `modules/characters/application/plaza-port.ts` |
| B8 | ㉖ | `PersonaUpdateSummarizerPort` | characters 定义令牌 `CHARACTER_PERSONA_SUMMARIZER`（`@Optional()` 注入）；管理员发布新人设版本时调用，null / 未绑定时用管理员摘要或「资料已更新」 | `modules/characters/`（发布人设版本处） |
| B9 | T-080 遗留 2 | 事件 `plaza.work_removed`（已有） | characters 订阅 `reason = author_deleted`，把来源为该作品的复制品的 `plaza_author_name` 清空（显示「已注销用户」不变） | `modules/characters/` |
| B10 | ㉓ | `http/assets.ts` `CardTemplate.classicalStyle`（迁移 0071） | 管理端读写；growth 挑卡面：历史人物优先 `classicalStyle = true`，其余真人只取 `portraitFree = true` | `modules/media/`、`modules/growth/application/cards*.ts` |
| B11 | ㉔㉘ | `http/library.ts` 快照与 `seq`（迁移 0070） | 收藏消息时存 `seq`、角色名、头像快照（经 `MediaSystemPort.copyObject` 复制一份，删除清单一并删）；422 的 `details` 已按 `ShareRejectedDetails` 返回，核对一致 | `modules/library/` |
| B12 | ㉚ | `http/pets.ts` `PetAppearance.listed`（迁移 0072） | 管理端外观单独上下架；用户端领养列表过滤；没有上架外观的物种视为下架 | `modules/growth/`（宠物） |
| B13 | T-082 | 事件 `growth.pet_naming_requested.speciesName` | 发事件时带物种名称 | `modules/growth/`（宠物） |
| B14 | ㉗ | `ports/social.ts` `CardCopywriterPort` | growth 定义令牌 `GROWTH_CARD_COPYWRITER`（可选注入）；发纪念 / 熟悉度 / 节日 / 心愿卡时调用，3 秒超时或 null 用模板 | `modules/growth/application/cards*.ts` |
| B15 | ㉕ | `http/importer.ts` `mergeIntoJobId`、`mergedIntoJobId`（迁移 0073） | 校验目标（同用户、同 kind、同角色、已完成待编辑）；本批完成后按规则合并进目标草稿（新角色补空字段、合并示例；补充设定追加文字），本任务标 `mergedIntoJobId`；`ImportResult(supplement).conflicts / filteredCount` 从分析器结果透传；编辑字段保留生日/头像（可选可空，无新增迁移），保存时校验头像归属与用途 | `modules/importer/` |
| B16 | ㉕ | `ports/push.ts` `PushRequest.kind = import` | push 接受 `import` 并映射到 `NotificationKind.import`；importer 导入完成推送改用 `import` | `modules/push/`、`modules/importer/` |
| B17 | ㉚㉖ | `ModelStatus.visionAvailable`；`ModelQuotePort` | `GET /model/status` 返回识图可用；实现报价端口（解析模型 → `BillingQuotePort`），导出令牌 `MODEL_QUOTE_PORT` | `modules/model-access/` |
| B18 | ㉖㉞ | `ports/billing.ts` `BillingQuotePort`、`BillingDailySpendReadPort` | 报价（只给 model-access，R9 同预留端口）；按用户当地日期、按用途汇总已结算金额，导出令牌 `BILLING_DAILY_SPEND_READ_PORT` | `modules/billing/` |
| B19 | ㊱ | `http/plaza.ts` 新字段、`getWork`、`listBans`（迁移 0074） | `isMine` 时返回 `sourceCharacterId`、`removedReason`；`myAdoptedCharacterId`；`listMyWorks` 返回 `unreadCount` 并在作者打开作品时更新已读；管理端两个接口；发布时把检测结果里的儿童特征写进改版快照 `childFeaturesDetected` | `modules/plaza/` |
| B20 | ㊲ | `http/chat.ts` `PLAY_SYSTEM_NOTICE_CODES`；`http/play.ts` `replyDelayReason` | 开始专注、寄信、心愿完成时经 `ChatAdminPort.postSystemMessage` 发三种系统提示；寄信响应带顺延原因 | `modules/play/` |
| B21 | — | 组合根 | `app.module.ts` 绑定：`IDENTITY_SETTINGS_WRITE_PORT`、`MODEL_QUOTE_PORT`、`BILLING_DAILY_SPEND_READ_PORT` 导出给 ai-runtime；`CHARACTER_PERSONA_SUMMARIZER`、`GROWTH_CARD_COPYWRITER` 先留空（AI 批绑定） | `apps/server/src/app.module.ts` |

## 4. AI 批（ai-lead）

| # | 积压 | 契约位置 | 要做的事 | 主要文件 |
|---|---|---|---|---|
| A1 | ⑰ | `IdentitySettingsWritePort` | 来电询问点「可以」时同时打开全局开关（替换「只开该角色」的临时做法） | `ai-runtime/application/call-scheduler.ts` 等 |
| A2 | ㉕ | `CharacterSupplementConflictsWritePort` | 改用契约端口，传对比时原文的 sha256，`stale` 时丢弃结果 | `ai-runtime/application/supplement-ai.ts` |
| A3 | ㉝ | `CharacterChildFeaturesWritePort` | 改用契约类型（行为不变） | `ai-runtime/application/plaza-check.ts` |
| A4 | ㉖ | `PersonaUpdateSummarizerPort` | `PersonaUpdateSummaryService` 实现契约端口（失败返回 null），`app.module.ts` 绑定到 `CHARACTER_PERSONA_SUMMARIZER` | `ai-runtime/application/supplement-ai.ts` |
| A5 | ㉗ | `CardCopywriterPort` | `CardLineService` 实现契约端口（扩展到纪念 / 熟悉度 / 节日 / 心愿卡，计入后台、余额低于 P-33 返回 null），绑定到 `GROWTH_CARD_COPYWRITER`（T-096 遗留 4） | `ai-runtime/application/moment-cards.ts` |
| A6 | ㉖ | `ModelQuotePort` | 导入估价改用真实报价，去掉固定系数 | `ai-runtime/application/import-ai.ts` |
| A7 | ㉕㉚ | `ImportResult(supplement).conflicts / filteredCount` | 分析器结果里填预检冲突项与被过滤条数 | `ai-runtime/application/import-ai.ts` |
| A8 | ㉞ | `BillingDailySpendReadPort` | 行为规划成本闸改为「规划费用 ≤ 当天 chat_reply 费用的 10%」 | `ai-runtime/application/planner*.ts` |
| A9 | ㊱ | `PlannerConfigEntry.circuitOpenUntil` | 管理端配置列表返回本机熔断状态 | 同上 |
| A10 | T-082 | `speciesName` | 起名提示带物种名 | `ai-runtime/application/pet*.ts` |
| A11 | ⑲ | `ImageContent.sizeBytes` | 角色发图写消息时带字节数 | `ai-runtime/application/character-image*.ts` |
| A12 | — | 迁移 0075、0076 | 角色自述一致性存档、纪念日寄信待寄队列（见第 2 节），并入 ai-runtime 删除清单 | `apps/server/drizzle/`、`ai-runtime/` |

## 5. 网页批（web-lead，含管理后台）

| # | 积压 | 契约位置 | 要做的事 |
|---|---|---|---|
| W1 | ⑲ | `ImageContent.sizeBytes` | 「添加到表情」只对 < 1 MB 的图片开放（不带时不限制） |
| W2 | ⑲ | `getDefaultVoice` | 后台作品链接页下拉框显示当前默认音色 |
| W3 | ㉘ | `locateByDate`、`listByType`、`senderParticipantId` | 会话内查找「日期 / 图片 / 链接」改用服务器接口；群成员筛选 |
| W4 | ㉔㉘ | `Favorite` 快照、`seq` | 收藏卡片优先显示快照；点开直接定位 |
| W5 | ㉘ | `ShareRejectedDetails` | `client-core` 的 `ApiFailure` 保留 `details`，分享图逐条提示 |
| W6 | ㉓㉚ | `CardTemplate.classicalStyle`、`PetAppearance.listed` | 后台卡面模板表单加「古风」开关；宠物图鉴外观单独上下架 |
| W7 | ㉕㉚ | importer 新字段、`ModelStatus.visionAvailable` | 「继续导入下一批」（带 `mergeIntoJobId`）与编辑器「保存草稿」（`saveResultDraft`）；确认页显示预检冲突与「N 条不会生效」；无识图时截图入口置灰 |
| W8 | ㉕ | `DataSection.supplement` | 收到后刷新补充设定（冲突项） |
| W9 | ㊱ | plaza 新字段、`getWork`、`listBans`、`circuitOpenUntil` | 发布新版本按 `sourceCharacterId` 匹配、聊天信息「已发布 · 版本 N」、作品页「更新到版本 N」、「我发布的」红点与下架原因；后台举报详情直接开作品、停权列表、规划熔断状态 |
| W10 | T-098 | `catchphrases`、`speechStyle` | 自定义角色编辑器支持完整口头禅列表与说话方式 |
| W11 | ㊲ | `PLAY_SYSTEM_NOTICE_CODES`、`replyDelayReason` | 渲染三种玩法系统提示；寄信后按顺延原因显示说明，去掉本地推断 |

## 6. 安卓批（android-lead）

同网页的用户端部分：W1、W3、W4、W5（`ApiFailure` 保留 `details` 与服务器文字原因）、W7、W8、W9 的用户端部分、W10（「改写」覆盖说话方式与全部口头禅）、W11。另：推送 `kind = import` 的通知路由 `/imports/{jobId}`（积压 ㉛，T-080 交接已确认服务器下发格式）。Kotlin 生成物已在 3.1 重生成，直接用。

## 7. 本次只登记、不需要实现的

| 项 | 说明 |
|---|---|
| ⑤ recordSent 可选参数 | 已实现（d08a26d），README 补登 |
| ⑧ formerParticipants、`conversation.removed`、ADR-0024 补记 | 已实现，README / ADR 补登 |
| ⑨ `self_chat` 标签 | 已实现（a5fd58f），README 补登 |
| ⑮ 3.0.1 / 3.0.2 | 并入 3.1 变更记录 |
| ContactsWritePort | 已实现（T-088），README 补登；T-087 / T-088 两栏见 `contracts-3.0-map.md` |
| 资料已更新红点起算点 | T-079 已按「第一次看到时记基线」实现，契约说明补写，不用改代码 |
| 慢信 `deliverLetterReply` 返回语义 | T-093 已按此实现，契约注释补写 |
| ADR-0027 搜索方案 A | 补记裁定，现有实现不变 |
| P-36 / P-37 | 已挪进 `platform/config/product-params.ts`，health 与 ai-runtime 改为引用（本次一并完成） |
| T-080 媒体按用户目录 vs 孤儿核验 | `security-and-privacy.md` 第 6 节已改写为「全库无孤儿文件」，TD-031 |
| 安卓 detekt 放宽 | TD-028（Compose 豁免转为规范，42 处 `@Suppress` 记债） |
