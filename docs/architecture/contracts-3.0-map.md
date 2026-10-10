# 契约 3.0 对照表：L4～L7 每张任务卡用什么接口、放哪个目录、用哪些迁移号

> 负责人：架构负责人 · v1.0 · 2026-10-09 · 来源任务：T-062
> 契约本身在 `packages/contracts/src/`（唯一准绳）；本文只是「去哪找」的索引。模块归属的理由见 ADR-0024，通话见 ADR-0025，消息类型与卡片按钮见 ADR-0026，搜索见 ADR-0027。
> 任务卡总表：`docs/tasks/L4-L7-index.md`。
> **3.1 增量（积压收口、迁移 0070 起）见 `contracts-3.1-map.md`。**

## 1. 先看结论

1. **契约 3.0 已一次覆盖 L4～L7 全部 HTTP 接口、WebSocket 更新、事件、端口和消息类型**，39 张卡可以同时开工；对方模块没写完时，按本文列出的端口写内存假实现。
2. **模块归属定死**：关系网在 `characters`；群聊、卡片按钮、搜索在 `chat`；朋友圈是新模块 `moments`；素材库（表情包、音色、卡面模板）在 `media`；卡片、成就、宠物在 `growth`；通话是新模块 `calls`（中层）；五个玩法是新模块 `play`（上层）；收藏与分享图在 `library`；导入在 `importer`；人设广场在 `plaza`；行为规划、共享开关、群聊陪伴设置、安静状态在 `ai-runtime`。
3. **开发负责人不改 `packages/contracts/**`**。缺字段写进交接说明的「契约变更申请」。
4. **合并方式**（总经理 2026-10-09 新指示，取代任务卡第 2 节第 6 条里的 PR 流程）：不用 GitHub；在自己 worktree 先 `git merge local/trunk`、通过 typecheck 后，确认 `C:\wb-dev\wb-int` 干净，再在那里 `git merge --no-edit <你的分支>`。以 `local/trunk` 为最新代码。

## 2. 迁移编号（唯一定义处）

文件放 `apps/server/drizzle/00xx_名称.sql` 与 `.down.sql`，并在 `meta/_journal.json` 按编号登记（`when` 严格递增）。只能用分给自己的号；不够用向总负责人申请。

| 号段 | 归属 |
|---|---|
| 0000–0021 | 已用（0018 growth、0019 simulation、0020 health、0021 proactive） |
| 0022–0024 | L3：T-053 主动消息调度 |
| 0025–0029 | L3：公开动态后端（D-L3-02） |
| **0030–0039** | **L4**：T-063 0030–0032、T-064 0033–0035、T-065 0036–0037、T-066 0038–0039 |
| **0040–0049** | **L5**：T-069 0040–0043、T-070 0044–0045、T-071 0046–0047、T-072 0048–0049 |
| **0050–0059** | **L6**：T-076 0050–0051、T-077 0052、T-078 0053–0054、T-079 0055、T-080 0056、T-081 0057、T-082 0058–0059 |
| **0060–0069** | **L7**：T-087 0060–0062、T-088 0063、T-090 0064、T-091 0065、T-092 0066、T-093 0067、T-094 0068、T-095 0069 |

T-089、T-096 与所有网页 / 安卓 / 运维卡不建表。

## 3. 新模块与目录

| 模块 | 层 | 服务器目录 | PostgreSQL schema | 删除清单（`UserDataOwner`）|
|---|---|---|---|---|
| moments | 上层 | `apps/server/src/modules/moments/` | `moments` | 必须 |
| calls | 中层 | `apps/server/src/modules/calls/` | `calls` | 必须 |
| library | 上层 | `apps/server/src/modules/library/` | `library` | 必须 |
| importer | 上层 | `apps/server/src/modules/importer/` | `importer` | 必须 |
| plaza | 上层 | `apps/server/src/modules/plaza/` | `plaza` | 必须（不删别人复制的角色） |
| play | 上层 | `apps/server/src/modules/play/` | `play` | 必须 |

已有模块（characters、chat、contacts、media、growth、ai-runtime、policy、model-access）的扩展放在各自目录。`ModuleName` 已含全部模块名（`events.ts`）。允许的依赖方向：上层 → 中层 → 底层；上层之间只允许 plaza → ai-runtime、importer → ai-runtime、ai-runtime → moments / growth / play（反方向用事件）；calls 不 import ai-runtime，`CallAgentPort` 由组合根注入。T-101 按此登记 lint 规则。

## 4. 每张卡对应的契约

文件路径均相对 `packages/contracts/src/`。「端口」列：提供 = 本卡实现；使用 = 本卡调用（对方未完成时写假实现）。

### L4

| 卡 | 契约文件与接口组 | 端口 | 事件 / 更新 |
|---|---|---|---|
| T-063 关系网与群聊（后端） | `http/character-extras.ts`：`RelationAdminEndpoints`、`UserRelationEndpoints`；`http/chat-groups.ts`：`ChatGroupEndpoints`、`ChatActionEndpoints`；`http/chat.ts`：`Conversation.group`、`TextContent.mentions`、`Message.actionChoice`、`ActionCardContent` | 提供：`CharacterRelationReadPort`、`ChatGroupReadPort`、`ChatGroupAdminPort`；`ReadMessagesInput.excludeLabels / excludeMessageIds / contentTypes` | 发：`characters.relation_changed`、`chat.group_members_changed`、`chat.group_renamed`、`chat.group_dissolved`、`chat.message_action_chosen`；更新：`conversation.updated`、`message.updated` |
| T-064 朋友圈与名片（后端） | `http/moments.ts`：`MomentsEndpoints`；`http/chat.ts`：`ContactCardContent`；`http/contacts.ts`：`ContactCardEndpoints` | 提供：`MomentsReadPort`、`MomentsCharacterPort`（`ports/social.ts`）、`ContactCardRecommendationPort` | 发：`moments.post_created`、`moments.comment_created`、`moments.post_liked`；更新：`moments.badge_updated`、`moments.post_changed`；推送 kind `moments` |
| T-065 群聊调度、自己聊、拉群（AI） | `http/ai-runtime-extras.ts`：`GroupCompanionEndpoints` | 使用：`ChatGroupReadPort`、`ChatGroupAdminPort`、`CharacterRelationReadPort`、`GrowthReadPort`、`PlayReadPort.getActiveFocus`、`PolicyExtensionPort.listAllowedGroupScenarioModes / checkGroupScenarioMode` | 订阅：`chat.message_created`（`mentionedParticipantIds`）、`chat.group_members_changed`、`chat.group_dissolved`；发：`ai_runtime.milestone`（group_invited_user） |
| T-066 朋友圈内容、共享记忆、名片推荐（AI） | `http/ai-runtime-extras.ts`：`MemorySharingEndpoints`；`http/timeline.ts`：`listTimeline`；回改 T-054 的 P-18 判断 | 使用：`MomentsReadPort`、`MomentsCharacterPort`、`CharacterRelationReadPort`、`ContactCardRecommendationPort`、`PetReadPort` | 订阅：`moments.*`、`characters.relation_changed`；发：`ai_runtime.milestone` |
| T-067 网页 L4；后台关系网 | 同 T-063、T-064 的 HTTP；`GroupCompanionEndpoints`、`MemorySharingEndpoints` | — | 处理更新 `message.updated`、`moments.*` |
| T-068 安卓 L4 | 同 T-067（Kotlin 生成物已更新） | — | 同上 |

### L5

| 卡 | 契约文件与接口组 | 端口 | 事件 / 更新 |
|---|---|---|---|
| T-069 media 完整版、素材库、表情、链接（后端） | `http/media.ts`：`MediaPurpose`、`UserMediaPurpose`、`AdminMediaPurpose`、`MEDIA_LIMITS`、`MediaExtraEndpoints`（转文字、链接预览）；`http/assets.ts`：`StickerEndpoints`、`StickerAdminEndpoints`、`VoiceEndpoints`、`VoiceAdminEndpoints`、`CardTemplateAdminEndpoints`；`http/character-extras.ts`：`WorkLinkAdminEndpoints`（含 `setDefaultVoice`，在 characters 实现） | 提供：`MediaSystemPort`、`MediaTranscriptPort`、`MediaAssetReadPort`、`LinkPreviewPort`、`CharacterWorkLinkReadPort`、`CharacterVoiceReadPort`；chat 发送校验用 `MediaSystemPort.canUse` | 更新：`media.transcript_ready`、`data.changed(stickers)` |
| T-070 通话服务端与计费（后端） | `http/calls.ts`：`CallEndpoints`、`CALL_LIMITS`、`CallStreamClientFrame` / `CallStreamServerFrame`；`http/chat.ts`：`CallRecordContent`；模型网关 `ModelGatewayMediaPort.openRealtimeAsr / streamSpeech`（在 model-access 实现） | 提供：`CallSessionPort`；使用：`CallAgentPort`（ai-runtime 注入） | 发：`calls.call_started / call_answered / call_ended`；更新：`call.updated`；推送 kind `call` |
| T-071 表情包、语音、识图、搜索、分享链接（AI） | `http/chat.ts`：`ImageContent`、`VoiceContent`、`StickerContent`、`LinkContent`；`CompanionSettings.voiceId` | 使用：`ModelGatewayMediaPort`（`synthesizeSpeech`、`transcribeSpeech`、`webSearch`）、`ChatMessageForModel.images`、`MediaAssetReadPort`、`MediaTranscriptPort`、`CharacterWorkLinkReadPort`、`LinkPreviewPort`、`CharacterRelationReadPort`（认人名单）、`UserQuietStatePort`（P-45） | 发：`ai_runtime.milestone`（voice_message_sent） |
| T-072 发图、通话管线、主动来电（AI） | `http/ai-runtime-extras.ts`：`QuietStateEndpoints`；`ActionCardContent`（call_permission） | 提供：`CallAgentPort`、`UserQuietStatePort`；使用：`CallSessionPort`、`ModelGatewayMediaPort.generateImage / openRealtimeAsr / streamSpeech`、`GrowthReadPort`、`PlayReadPort.getActiveFocus` | 订阅：`calls.call_ended`、`chat.message_action_chosen`、`growth.familiarity_leveled_up` |
| T-073 网页 L5；后台素材库 | 同 T-069、T-070 的 HTTP 与音频流协议 | — | `call.updated`、`media.transcript_ready` |
| T-074 安卓：图片、语音、链接、表情 | 同 T-069 | — | 同上 |
| T-075 安卓：通话、全屏来电 | `http/calls.ts` 全部；推送 kind `call` | — | `call.updated` |

### L6

| 卡 | 契约文件与接口组 | 端口 | 事件 / 更新 |
|---|---|---|---|
| T-076 卡片与成就（后端） | `http/growth-cards.ts`：`GrowthCardEndpoints`、`CardKind`、`AchievementKey`（1～34 号） | 提供：`GrowthReadPort`、`GrowthCardPort` | 订阅：contacts、chat、calls、moments、library、play、`ai_runtime.milestone` 等；发：`growth.familiarity_leveled_up`、`growth.anniversary_reached`、`growth.card_issued`、`growth.achievement_unlocked`；更新：`data.changed(cards / achievements / familiarity)` |
| T-077 宠物（后端） | `http/pets.ts`：`PetEndpoints`、`PetSpeciesAdminEndpoints`、`PET_LIMITS`；`ActionCardContent`（pet_names） | 提供：`PetReadPort`、`PetNamingPort` | 发：`growth.pet_adopted / pet_stage_changed / pet_sent_away / pet_renamed / pet_naming_requested`；订阅 `chat.message_action_chosen`（cardKind = pet_names） |
| T-078 收藏、分享图数据、搜索（后端） | `http/library.ts`：`LibraryEndpoints`、`ShareEndpoints`；`http/chat-groups.ts`：`ChatSearchEndpoints`（chat 模块内实现，ADR-0027） | 使用：`ChatReadPort`（带 labels / scope 判断）、`MomentsReadPort`、`PolicyPort.getCharacterPolicy`（分享图标注） | 发：`library.favorite_added`、`library.share_image_generated`；更新 `data.changed(favorites)` |
| T-079 importer（后端） | `http/importer.ts`：`ImporterEndpoints`（含保存草稿 `saveResultDraft`）、`IMPORT_LIMITS` | 使用：`ImportAnalyzerPort`（ai-runtime）、`MediaSystemPort`（截图） | 发：`importer.job_completed`；更新 `data.changed(imports)`；推送 kind `import` |
| T-080 注销完整流程 | 已有 `IdentityEndpoints.deleteAccount`、`IdentityAdminEndpoints.listPendingDeletions / retryDeletion`；`ModuleName` 新增模块 | 每个模块的 `UserDataOwner` | `identity.user_deletion_requested` → `platform.user_data_purged` |
| T-081 导入草稿、截图识别、人设更新提示（AI） | `http/character-extras.ts`：`CharacterSupplementEndpoints`、`PersonaUpdateEndpoints`（characters 实现）；`ImportResult` | 提供：`ImportAnalyzerPort`；使用：`CharacterSupplementPort` | 订阅 `characters.supplement_changed` |
| T-082 名场面瞬间卡、宠物与角色（AI） | — | 使用：`GrowthCardPort`、`PetReadPort`、`PetNamingPort`、`MomentsCharacterPort`、`ReadMessagesInput.excludeLabels` | 订阅：`growth.pet_*`、`chat.message_action_chosen`（pet_proposal） |
| T-083 / T-085 卡册、成就、收藏、搜索、分享图（网页 / 安卓） | `GrowthCardEndpoints`、`LibraryEndpoints`、`ShareEndpoints`、`ChatSearchEndpoints` | — | `data.changed` |
| T-084 / T-086 导入、注销、宠物（网页 / 安卓）；后台宠物图鉴与注销未完成 | `ImporterEndpoints`、`PetEndpoints`、`PetSpeciesAdminEndpoints`、`CharacterSupplementEndpoints`、`IdentityAdminEndpoints` | — | `data.changed(imports / pets)` |

### L7

| 卡 | 契约文件与接口组 | 端口 | 事件 / 更新 |
|---|---|---|---|
| T-087 plaza（后端） | `http/plaza.ts`：`PlazaEndpoints`、`PlazaAdminEndpoints`、严格快照 `PlazaSnapshot` | 使用：`CharacterPlazaPort`、`PlazaPublishCheckPort`、`PolicyExtensionPort.compareClassification`、`MediaSystemPort.copyObject`（plaza_avatar） | 发：`plaza.work_published / work_version_published / work_removed`；订阅 `identity.user_deletion_requested`；更新 `data.changed(plaza_badge)` |
| T-088 characters 配合广场 | `http/character-extras.ts`：`CustomCharacterOriginEndpoints`、`CustomCharacterOrigin` | 提供：`CharacterPlazaPort`（`origin = plaza_copy`、`everPrivatePerson` 只增、分类只能更严的数据库触发器） | 分类更严时照常发 `characters.character_classification_changed` |
| T-089 广场检测（AI） | `PrivacyKind` | 提供：`PlazaPublishCheckPort` | — |
| T-090 行为规划（AI） | `http/ai-runtime-extras.ts`：`PlannerAdminEndpoints`；`GenerateTextInput.modelKeyOverride`；`ModelGatewayMediaPort.decide`；`defaultFor: planner`、`UpstreamKind: jev` | 使用：`UserQuietStatePort`（自己提供）、`PlayReadPort.getActiveFocus` | — |
| T-091 每日一问 | `http/play.ts`：`DailyQuestionEndpoints`、`DailyQuestionAdminEndpoints`；`DailyQuestionContent` | 提供：`PlayAgentPort.setDailyCharacterAnswer` | 发：`play.daily_answer_submitted`；更新 `data.changed(daily_question)` |
| T-092 心愿清单 | `WishlistEndpoints`；`ActionCardContent`（wishlist_proposal） | 提供：`PlayReadPort.listWishlist`、`PlayAgentPort.createWishlistProposal` | 发：`play.wishlist_item_changed / wishlist_item_completed`；订阅 `chat.message_action_chosen` |
| T-093 慢信 | `LetterEndpoints`；`LetterContent` | 提供：`PlayReadPort.listPendingLetterReplies / getLetterBody`、`PlayAgentPort.deliverLetterReply / sendCharacterLetter` | 发：`play.letter_sent / letter_delivered`；推送 kind `letter` |
| T-094 陪你专注 | `FocusEndpoints`（「用户正在专注」查询 = `GET /play/focus`） | 提供：`PlayReadPort.getActiveFocus` | 发：`play.focus_started / focus_ended`；更新 `data.changed(focus)` |
| T-095 TA 的提醒 | `ReminderEndpoints` | 提供：`PlayReadPort.getReminder`、`PlayAgentPort.setReminderPhrasings`；到点由 play 经 `ChatParticipantPort.postMessage` 以角色身份发出（「健康」类带 `labels: ['health']`），不调用模型 | 发：`play.reminder_saved` |
| T-096 玩法里角色怎么说话（AI） | — | 使用：`PlayReadPort`、`PlayAgentPort` | 订阅：`play.*`、`growth.anniversary_reached` |
| T-097 网页广场；后台广场与行为规划 | `PlazaEndpoints`、`PlazaAdminEndpoints`、`PlannerAdminEndpoints` | — | — |
| T-098 安卓广场 | `PlazaEndpoints` | — | — |
| T-099 / T-100 五个玩法页面；后台题库 | `http/play.ts` 全部 | — | `data.changed` |
| T-101 模块登记与边界规则 | 第 3 节 | — | — |

## 5. 两条跨模块状态（产品点名）

- **P-45「不方便」静默**：ai-runtime 识别、保存（`ai_runtime.user_quiet_state.inconvenientUntil`），对该用户所有角色生效；对外 `UserQuietStatePort.getInconvenientUntil`，客户端只读 `GET /me/quiet-state`。生效期间不发语音、不主动来电。
- **用户正在专注**：数据归 play，`PlayReadPort.getActiveFocus` / `GET /play/focus`；`GET /me/quiet-state.focusUntil` 是 ai-runtime 汇总后的只读视图。

## 6. L3 收尾的契约补充（顺带并入 3.0）

- health：`getSettings / updateSettings`（P-37 默认值）、`clearAll`、症状标签（`HealthTagEndpoints`、`HealthTagAdminEndpoints`）——T-059 交接缺口。
- timeline：`listTimeline`（设计缺口第 5 条）。
