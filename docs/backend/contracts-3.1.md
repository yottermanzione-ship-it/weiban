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
