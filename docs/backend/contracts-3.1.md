# 契约 3.1 后端实现说明（B1～B21）

> 负责人：后端负责人 · 2026-10-11 · 清单来源：`docs/architecture/contracts-3.1-map.md` 第 3 节；决策见 ADR-0028。
> 本文只记实现要点与偏离；接口定义以 `packages/contracts` 为准。

## 第一批（B1～B10）

| # | 实现位置 | 要点 |
|---|---|---|
| B1 | `identity/application/settings.ts` `enableProactiveCalls` | 令牌 `IDENTITY_SETTINGS_WRITE_PORT`（identity 导出）。锁账号行（share）与设置行（update）；非 active / 不存在返回 false；已开启直接 true 不发事件；打开时发 `identity.notification_settings_updated`（realtime 转 `settings.updated`）。可传入调用方事务。 |
| B2 | `chat/application/write.ts` | 写图片消息前若 `sizeBytes` 为空，经 `MEDIA_READ_PORT.getMedia(会话所有者, mediaId)` 填入；查不到时不填（不阻塞发送）。角色发图、宠物照片走同一写入口，自动带上。 |
| B3 | `chat/application/search.ts`、`http/search.controller.ts` | `locateByDate`：按 `Profile.timeZone` 算当地 0 点，找 `created_at ≥ 0 点` 且未清空、未隐藏的第一条（含已撤回消息，撤回提示本身可见）。`listByType`：明文列 `content_type` / `sender_participant_id` 过滤，排除撤回、隐藏、已清空；`searchConversation` 加 `senderParticipantId`。 |
| B4 | `characters/application/work-links.ts` `getDefaultVoice` | `GET /admin/characters/:id/voice`；音色停用或读不到时 `voiceName = null`。 |
| B5 | `characters/application/custom-character.ts` | payload 存 `catchphrases`、`speechStyle`（已有字段），合成角色卡时进 `speech.catchphrases` / `speech.tone`；规则按契约注释（列表优先、只传单条时替换第一条）。两者都进儿童特征检测文本。 |
| B6 | `characters/application/supplements.ts` `setConflicts` | 实现 `CharacterSupplementConflictsWritePort`：行锁 → 可选 sha256 比对（不一致 `stale`）→ 写入 → `data.changed(section = supplement)`。令牌名沿用 `CHARACTER_SUPPLEMENT_CONFLICTS`。 |
| B7 | `characters/application/plaza-port.ts` | 令牌沿用 `CHARACTER_CHILD_FEATURES_WRITER`，类型改为契约端口。按快照创建改版复制品时取「预设分类 ∪ 快照 childFeaturesDetected」；应用改版（补充设定）时把更严结果存进 `user_supplements.plaza_source.childFeaturesDetected`（不写回预设）。**偏离**：契约 `CharacterPlazaPort.applyVariant` 入参没有该字段，plaza 用对象展开附带，已在交接里申请补契约。 |
| B8 | `characters/application/characters.ts` `publish` | 可选注入 `CHARACTER_PERSONA_SUMMARIZER`（characters 导出）；版本 ≥ 2 时调用（8 秒超时），null / 失败 / 未绑定写「资料已更新」，第一个版本不写摘要。 |
| B9 | `characters/application/plaza-port.ts` `onModuleInit` | 订阅 `plaza.work_removed(reason = author_deleted)`：清空 `characters.plaza_author_name`，并把补充设定 `plaza_source.authorName` 置空。 |
| B10 | 迁移 0071；`media/application/assets.ts`；`growth/application/cards.service.ts` | 管理端读写 `classicalStyle`；`MediaAssetReadPort.listCardTemplates` 签名不变，另加 media 内部令牌 `MEDIA_CLASSICAL_CARD_TEMPLATES`。growth 挑卡面：历史人物先取古风模板，没有时退回无人物模板。 |

## 第二批（B11～B21）

> 代码由后端负责人写成；额度中断期间 Codex 以 `b16dc3f`（T-102）原样接续提交并补了测试与 AI 侧绑定，本节按合入后的代码记。

| # | 实现位置 | 要点 |
|---|---|---|
| B11 | 迁移 0070；`library/application/library.service.ts` | 收藏消息存 `source_seq`；角色名与头像快照（头像经 `MediaSystemPort.copyObject` 复制为本人 `contact_avatar`），取消收藏、注销清理时一并删；重复收藏时多复制的头像立即删。422 `details.rejected` 已与 `ShareRejectedDetails` 一致。 |
| B12 | 迁移 0072；`growth/application/pets.service.ts` | 外观 `listed`；用户端只列上架外观，没有上架外观的物种不列；领养 / 起名校验外观上架。 |
| B13 | 同上 `requestNames` | `growth.pet_naming_requested` 带 `speciesName`。 |
| B14 | `growth/application/cards.service.ts` | 可选注入 `GROWTH_CARD_COPYWRITER`；纪念 / 熟悉度 / 节日 / 心愿（`wish:` 幂等键）卡调用，3 秒超时或 null 用模板；`noticeParams` 作 facts。 |
| B15 | 迁移 0073；`importer/application/importer.service.ts` | `mergeIntoJobId` 创建时校验（404 / 422）；分析完成后合并进目标草稿（新角色补空字段、数组去重追加；补充设定文字追加、冲突项合并、过滤数相加），本任务写 `mergedIntoJobId`；`conflicts / filteredCount` 透传。 |
| B16 | 同上 `notify` | 推送 `kind = import`（push 侧 `NotificationPayload` 已支持）。 |
| B17 | `model-access/application/resolver.ts` | `GET /model/status` 带 `visionAvailable`；`ModelQuoteService` 实现 `ModelQuotePort`（令牌 `MODEL_QUOTE_PORT`）。 |
| B18 | `billing/application/quotes.ts` | `BILLING_QUOTE_PORT`（只给 model-access）、`BILLING_DAILY_SPEND_READ_PORT`（按用户时区当天、按用途、扣费减同用量记录退款）。 |
| B19 | 迁移 0074；`plaza/application/*`、`http/plaza-admin.controller.ts` | 详情返回 `sourceCharacterId` / `removedReason`（仅作者）、`myAdoptedCharacterId`；`listMyWorks` 带 `unreadCount`（`author_seen_at` 之后的他人点赞 + 未删评论），作者打开作品时更新已读并刷新红点；管理端 `GET /admin/plaza/works/:id`、`GET /admin/plaza/bans`；改版发布检出儿童特征写进快照。 |
| B20 | `play/application/*` | 开始专注、寄信、心愿完成经 `ChatAdminPort.postSystemMessage` 发三种系统提示；寄信响应带 `replyDelayReason`（P-42 窗口内已有该角色其他回信 = `already_replied_today`，否则 `outside_active_window`）。 |
| B21 | `app.module.ts` `AiHookCompositionModule` | `CHARACTER_PERSONA_SUMMARIZER`、`GROWTH_CARD_COPYWRITER` 已由 AI 侧绑定到 ai-runtime 实现；三个读写令牌由各自模块导出，ai-runtime 直接注入。 |
