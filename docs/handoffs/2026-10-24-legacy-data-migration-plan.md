# 旧版微伴服（SQLite）→ 新服（PostgreSQL）用户数据与角色卡迁移方案

- 状态：**方案（只读分析产物）**。本文件不含任何已执行的迁移；旧库、新库均未写入，代码未改，未推送。
- 依据：2026-10-24 对两台服务器的实际只读查询（`sqlite3 ...?mode=ro`、`psql -c`、`docker inspect`、`find/du`、源码阅读）。
- 关联文档：[旧服务器真实盘点与迁移批准清单](2026-10-23-legacy-inventory-preflight.md)、[上游配置导出器交接](2026-10-23-legacy-exporter-implementation.md)、[接收器阶段四](2026-10-23-legacy-receiver-phase4.md)、[ADR-0006 信封加密](../decisions/ADR-0006-*.md)、[ADR-20261023 旧配置传送加密](../decisions/ADR-20261023-legacy-config-export.md)。
- 记号：`[实测]` 本次实际查询得到；`[代码]` 读源码确认；`[未验证]` 未实测；`[决策]` 需总经理/产品拍板。

---

## 0. 结论摘要

1. **规模**：旧库 1.59 GiB / 113 张表 / 553 个用户；私聊 294,325 条消息（4,047 个用户×角色会话，542 条/人，72.7 条/会话，单会话最多 39,995 条）；群聊 18,754 条（86 群）；朋友圈 4,757 条；记忆 13,606 条；媒体 20,760 个文件、4.37 GiB（其中约 277 个被数据库引用的文件在旧机已不存在）。新库当前只有 15 个用户、9 个角色、130 条消息、1,612 个媒体对象（全部为表情库素材），是一套**带少量测试数据的新库**，不是空库。
2. **三点与任务前提不符，必须先对齐**：
   - 旧库用户数据是**明文 SQLite**（文件头 `SQLite 3.x`，正文可直接读出中文），媒体也是明文文件；只有上游 API Key 曾用文件密钥加密。因此"新旧都信封加密"只对新库成立，旧侧是"明文读取→新 DEK 封装"。
   - 旧库**没有手机号字段**（全库 schema 扫描无 phone/mobile/tel/id_card 列）。手机号不构成迁移项；微信/微博/QQ 绑定里有第三方凭据与第三方 ID，新库无对应表。
   - 旧"角色"是**全局角色库，没有 owner 字段**（`characters_v2` 677 行，`is_official=0`，无 user_id/owner_id）；新库是"预设角色（平台所有）+ 自定义角色（用户所有）"两种。旧 677 个角色只能按**预设角色**迁入，不能还原成"某个用户的角色"。
3. **两个硬阻塞**（不解决则不能上线）：
   - **密码**：旧 `app_users.password_hash` 553 条全是 bcrypt `$2a$10$`；新 `identity.users.password_hash` 是 argon2id PHC，服务端只依赖 `@node-rs/argon2` 校验，**代码中不存在 bcrypt 兼容路径**（全仓 grep 无 bcrypt）。照现状迁移，553 个用户全部无法登录。
   - **角色合规分类**：新角色必须有 `basis`（real_person/fictional/original）与 `real_person_kind`，真人角色的 `portraitPolicy` 推导为 `forbidden`；而旧库 `identity_type` 676/677 为空、677 张头像全是真人照片（`/generated/avatars/朱志鑫_….jpg` 一类）、753 条克隆音色绑定没有任何授权证据、`voice_requires_authorization=1` 只是标记不是证据。**角色卡不能自动上架**。
4. **可复用的既有通道**：`scripts/ops/export-legacy-upstreams.mjs` + `apps/server/src/cli/import-legacy-upstreams.ts` + `LegacyImportReceiver`（RSA-3072 一次性证书、CMS AuthEnvelopedData AES-256-GCM/RSA-OAEP-SHA256、sha256 固定、`--plan` 只读、`accepted-packet.sha256` 防重放、`import-receipt.json` 回执、批次目录 0700）。本方案沿用同一套密码学与运维约定，但**必须新建用户数据专用的导出器/导入器**：现有接收器单包上限 3 MiB、且 `validateLegacyPayload` 只认上游账号结构，装不下 294k 条消息与 4.7 GB 媒体。
5. **建议节奏**：先干跑与彩排（新服已有 `weiban-dryrun-postgres` 容器可做演练库），再按 4 个维护窗口分批上线；角色卡采用"先草稿、后按角色逐个过审上架"，不阻塞用户数据迁移。
6. **量级判断**：工程侧约 25–30 人日 + 内容侧角色卡人工归集约 21 人日（可与工程并行）；4 个窗口各 2–3 小时。

---

## 1. 只读盘点（结构、行数、媒体）

### 1.1 两台机器的实际事实

| 项目 | 旧服 | 新服 |
|---|---|---|
| 入口 | `ubuntu@152.136.111.51`（密钥 `weiban_old.pem`，`ubuntu` 有 sudo） | `root@103.231.58.124`（密钥 `weiban_deploy`） |
| 数据库 | `/opt/weiban-server/weiban.db`，1,706,180,608 B，权限 **0666**，SQLite 3.53.1 | 容器 `weiban-prod-postgres-1`（`pgvector/pgvector:0.8.7-pg18-bookworm`），库/用户 `weiban`，166 MB，`schema_migrations` 124 行（部署记录 `latestMigration=0135_client_logs`） |
| 写入者 | root PID 12805 `node /opt/weiban-server/server.js`、root PID 1408 `node voice_bridge.js`；WAL 178,981,072 B、SHM 32,768 B，采集时仍在增长 | app 容器 `weiban-prod-app-1`，`ReadonlyRootfs=true`，`User=node`，`NODE_ENV=production` |
| 磁盘 | 59 GB，已用 48 GB，**仅剩 8.6 GB** | 50 GB，已用 8.3 GB，**剩 39 GB** |
| 媒体 | 文件系统明文：`public/generated/*`、`private/chat-media/*`、`persona_packages/`；MinIO（`127.0.0.1:9000`）实际为空（88 KB、无桶） | 卷 `weiban-prod_media` → `/srv/weiban/docker/volumes/weiban-prod_media/_data`，2,209 个 `<uuid>.sealed` 文件、135 MB、`0600 www:www`；容器内路径 `/app/.data/media` |
| 密钥 | `.env` 仅 root 可读（本次未读）；上游密钥加密细节见既有交接 | `PLATFORM_KEK_FILE=/run/secrets/kek`（宿主 `/srv/weiban/secrets/kek`，0600 www，44 B），`PLATFORM_KEK_VERSION=1`，`MEDIA_DISK_ROOT=/app/.data/media` |
| 运维目录 | `/opt/weiban-server`、`public/`（8 GB，含大量历史前端构建目录，**不是迁移对象**） | `/srv/weiban`（`secrets/`、`backups/`、`import-staging/`、`incoming-*/`、`deployment-version.txt`） |
| 版本 | 旧服 `schema_migrations` 108 条，最后 `0108-realtime-call-duration-limit` | 部署 `sourceCommit=1db77af3…`，`contractVersion=3.37` |

> 本次分析对旧机只执行了 `sqlite3` 只读查询、`find/du/file/grep` 与 `pm2 list`。`pm2 list` 在旧机 `ubuntu` 下自启了一个空的 PM2 daemon（未托管任何进程、未改动业务），属可忽略的读取副作用。未读取 `.env`、未读取任何密钥文件。

### 1.2 旧库表结构（实测 `sqlite3 .schema` + `PRAGMA` 等价的建表语句）

只列迁移涉及的表；共 113 张表、108 条迁移记录。旧库时间列混用两种格式，均为 **UTC**：`datetime('now')` 的 `YYYY-MM-DD HH:MM:SS` 与 JS 的 `YYYY-MM-DDTHH:MM:SS.sssZ`。

| 旧表 | 行数 | 主键/唯一约束 | 关键列（类型） |
|---|---|---|---|
| `app_users` | 553 | `id TEXT PK`；`(username)` 部分唯一 | `uid INTEGER`、`password_hash TEXT`（bcrypt）、`username`、`nickname`、`recovery_code_hash`、`membership_level`、`membership_expire_at`、`avatar_url`、`gender`、`region`、`birthday`、`signature`、`created_at/updated_at` |
| `users` | 0 | `id INTEGER PK` | 旧版遗留表，空 |
| `characters_v2` | 677 | `id TEXT PK`；`display_name` UNIQUE | 40+ 列：`core_persona`、`speaking_style`、`knowledge_json`、`opening_messages_json`、`voice_json`、`soul_*`、`style_*`、`memory_*`、`heartbeat_*`、`voice_primary_provider`、`voice_primary_endpoint_id`、`cartesia_voice_id`、`qwen_voice_id`、`mimo_voice_sample_path`、`is_official`、`identity_type`、`gender`、`quality_score`、`schema_kind` |
| `personas` | 3 | `id INTEGER PK`；`name` UNIQUE | 旧版角色（`data` JSON），已被 `characters_v2` 取代 |
| `character_example_dialogues` | 35,082 | `id TEXT PK` | `character_id`、`user_text`、`assistant_text`、`scene`、`sort_order` |
| `character_lorebook_entries` | 17,215 | `id TEXT PK` | `character_id`、`trigger_keys_json`、`content`、`priority`、`enabled` |
| `character_assets` | 299 | `id INTEGER PK` | `persona_name`、`asset_type`、`path`、`url`、`metadata_json` |
| `persona_base_versions` | 1,738 | `signature TEXT PK` | `persona_name`、`revision`、`package_json` |
| `persona_packages` | 824 | `id TEXT PK` | `stored_path`、`status`、`metadata_json` |
| `persona_customizations` | 126 | `(user_id, persona_name) PK` | `state`、`patch_json`、`base_signature` |
| `user_friends` | 3,474 | `(user_id, persona_name) PK` | `added_at`（ISO Z） |
| `chat_history` | 294,325 | `id INTEGER PK`；`(source_job_id)` 部分唯一；`(user_id,persona_name,client_message_id)` 部分唯一 | `user_id TEXT`（= `app_users.id`）、`persona_name TEXT`、`role CHECK(user/assistant)`、`content`、`message_type`、`audio_url`、`audio_duration INTEGER`（秒）、`media_status`、`media_path`、`media_mime`、`media_expires_at`、`deleted_at`、`deletion_scope`、`client_message_id`、`quoted_author`、`quoted_content`、`created_at` |
| `chat_messages` | 0 | — | 旧版遗留，空 |
| `chat_groups` | 86 | `id TEXT PK` | `user_id`、`name`、`mode CHECK(dynamic)`、`archived`、`avatar` |
| `chat_group_members` | 362 | `id TEXT PK`；`UNIQUE(group_id,character_name)` | `group_id`、`character_name`、`role`、`speak_priority` |
| `group_messages` | 18,754 | `id TEXT PK`；`(group_id,user_id,client_message_id)` 部分唯一 | `group_id`、`user_id TEXT`、`sender_type CHECK(user/character/system)`、`sender_name`、`content`、`turn_id`、`scene_id`、`step_no`、`audio_*`、`media_*`、`deleted_at`、`client_message_id` |
| `group_memories` | 11,225 | `id TEXT PK` | `group_id`、`mem_type`、`content`、`confidence`、`enabled` |
| `group_scenes` | 1,394 | `id TEXT PK` | `topic`、`participants_json`、`status`、`scheduled_at` |
| `moments` | 4,757 | `id TEXT PK`；`(source_job_id)` 部分唯一 | `author_type`、`author_id TEXT`（角色=**display_name**）、`content`、`image_url`、`image_origin` |
| `moment_interactions` | 35,204 | `id TEXT PK`；`(moment_id,user_id)` 部分唯一 | `moment_id`、`actor_type`、`actor_name`、`type`、`content`、`user_id` |
| `user_memories` | 13,606 | `id TEXT PK` | `user_key`（会话/角色维度 UUID）、`owner_user_id`（= `app_users.id`）、`subject_character_id`、`mem_type`、`content`、`confidence`、`visibility`、`provenance_json`、`supersedes_id` |
| `conversation_summaries` | 944 | `id TEXT PK`；`UNIQUE(user_key,persona_name)` | `summary_text`、`covered_until_id`、`message_count`、`covered_from_id` |
| `persona_memory_tombstones` | 1,200 | `(user_id,memory_id) PK` | 记忆删除墓碑 |
| `character_voice_bindings` | 753 | `(character_id,endpoint_id,model) PK`；FK→`characters_v2` | `provider`、`voice_id`、`status` |
| `user_character_voice_styles` | 56 | `(user_id,persona_name) PK` | `style CHECK(vivid/realistic)` |
| `relationship_states` | 2,568 | `(user_id,persona_name) PK` | `score`、`stage`、`romance_paused` |
| `chat_read_cursors` | 2,935 | `(user_id,persona_name) PK` | `last_read_id`（= `chat_history.id`） |
| `user_client_prefs` | 297 | `user_id PK` | `prefs_json`、`revision` |
| `media_send_commands` | 8,914 | `(user_id,client_command_id) PK`；`UNIQUE(user_id,client_message_id)` | `kind`、`media_url`（`/api/chat/media/<messageId>`）、`transcript` |
| `public_files` | 10 | `id TEXT PK` | 10 条全部 `deleted_at` 非空，文件在旧机已不存在（`runtime/public_files` 0 文件） |
| `device_bindings` / `wechat_bindings` / `weibo_bindings` / `qq_bindings` | 713 / 28 / 57 / 1 | — | 设备令牌哈希、第三方机器人 token、第三方用户 ID |

### 1.3 新库结构（实测 `psql`：`information_schema` + `pg_constraint` + `pg_indexes`）

新库按 schema 分域（共 26 个 schema，含 `pg_catalog`/`information_schema`/`pgboss`/`public`；业务 schema：`identity`、`characters`、`chat`、`contacts`、`moments`、`media`、`ai_runtime`、`platform`、`importer`、`billing`、`growth`、`health`、`library`、`model_access`、`play`、`plaza`、`proactive`、`push`、`realtime`、`support`、`calls`、`client_logs`）。当前行数（实测）：

| 新表 | 现有行数 | 关键列 / 约束（与迁移相关） |
|---|---|---|
| `identity.users` | 15 | `id uuid PK`、`username`、`password_hash`（argon2id）、`role CHECK(user/admin)`、`status CHECK(active/deleting)`、`created_at/updated_at/last_active_at`、`current_alias`、`banned_*`；唯一索引 `lower(username)` |
| `identity.profiles` | 15 | `user_id PK`、`nickname`、`avatar_media_id uuid`、`birthday date`、`gender`、`city`、`about`、`time_zone`（NOT NULL）、`moments_cover_media_id` |
| `identity.login_aliases` | 15 | `alias PK`、`user_id`（FK→users，CASCADE） |
| `identity.preferences` / `notification_settings` | 15 / 15 | 主题、推送与免打扰默认值（注册时 `createDefaults` 写入） |
| `identity.memberships` | 1 | `user_id PK`、`pro_plus_until timestamptz`（单一档期，无 plus/pro 两级） |
| `identity.sessions` | 20 | `token_hash bytea UNIQUE`、`kind`、`device jsonb`、`expires_at` |
| `characters.characters` | 9 | `id uuid PK`、`owner_id`（预设为 NULL，自定义必填）、`kind`、`status`、`name`、`search_text`、`category_id`、`basis`、`real_person_kind`、`age_setting`、`child_appearance`、`draft_ciphertext bytea NOT NULL`、`published_ciphertext bytea`、`revision`、`persona_version`、`checks jsonb`、`origin_kind`、`is_trial`；`custom_has_owner` CHECK |
| `characters.persona_versions` | 9 | `(character_id,version) PK`、`ciphertext bytea`、`published_at`、`stability_passed` |
| `characters.default_voices` | 0 | `character_id PK`、`voice_id uuid`（→`media.voices`） |
| `characters.user_supplements` | 0 | `(user_id,character_id) PK`、`text_ciphertext`、`conflicts jsonb` |
| `chat.conversations` | 7 | `id uuid PK`、`owner_user_id`、`type CHECK(direct/group)`、`character_id`、`system_participant_id`（NOT NULL）、`content_scope`、`last_seq bigint`；唯一索引 `(owner_user_id, character_id)`、`(owner_user_id, create_key)` 部分唯一 |
| `chat.participants` | 16 | `id uuid PK`、`conversation_id`、`kind`、`ref_id`、`read_seq`；唯一 `(conversation_id,kind,ref_id)` |
| `chat.messages` | 130 | `id uuid PK`、`conversation_id`、`seq bigint`、`sender_participant_id`、`sender_kind`、`client_msg_id`（NOT NULL）、`content_ciphertext bytea`、`quote_message_id`、`status CHECK(normal/recalled)`、`scope`、`created_at`、`labels text[]`、`content_type`；唯一 `(conversation_id,seq)`、`(conversation_id,sender_participant_id,client_msg_id)` |
| `chat.user_conversation_states` | 7 | `(conversation_id,user_id) PK`、`pinned`、`muted`、`hidden`、`read_seq`、`cleared_through_seq` |
| `chat.hidden_messages` | 2 | `(message_id,user_id) PK`（按用户隐藏） |
| `contacts.contacts` | 5 | `id uuid PK`、`user_id`、`character_id`、`status CHECK(pending/active/deleted)`、`request_id`（NOT NULL）、`acceptance_mode`、`accept_after`、`known_since date`、`added_at`、`conversation_id`、`relationship_type`、`greeting_ciphertext`；唯一 `(user_id,character_id)` |
| `media.objects` | 1,612（全部 `state=ready`） | `id uuid PK`、`owner_id`、`purpose`、`mime_type`、`size_bytes`、`width/height`、`storage_key UNIQUE`、`state`、`duration_ms`、`transcript_status`、`transcript_ciphertext`、`content_hash`、`expires_at` |
| `media.voices` | 1 | `id uuid PK`、`name`、`sample_media_id`、`provider_voice_key`、`model_key`、`enabled`（现有行：`mimo_default` / `xiaomi/mimo-v2.5-tts`） |
| `media.user_stickers` / `library_stickers` / `sticker_packs` | 0 / 1,619 / 103 | 用户/库表情，均以 `media_id` 指向 `media.objects` |
| `ai_runtime.memories` | 6 | `id uuid PK`、`user_id`、`character_id`、`conversation_id`、`client_id`、`scope CHECK(normal/adult)`、`ciphertext`、`embedding`、`origin`；唯一 `(user_id,character_id,client_id)` |
| `ai_runtime.memory_states` | 5 | `(user_id,character_id,conversation_id)` 唯一，`summary_ciphertext`、`daily/monthly_summaries_ciphertext`、`cursor_seq`、`barrier_seq` |
| `ai_runtime.group_memory_states` | 1 | `(user_id,conversation_id)` 唯一，`result_ciphertext`、`cursor_seq` |
| `moments.posts` | 3 | `id uuid PK`、`owner_user_id`、`author_kind`、`author_character_id`、`text_ciphertext`、`link jsonb`、`visibility_kind`、`create_key`；`posts_author_check`（user→visibility 必填；character→visibility 必空） |
| `moments.post_media` / `likes` / `comments` | 0 / 1 / 0 | `post_media(post_id,position) PK`、`likes(post_id,actor_kind,actor_ref_id) PK` |
| `platform.user_data_keys` | 16 | `owner PK`（`platform` 或用户 uuid）、`wrapped_dek bytea`、`kek_version`、`rotated_at` |
| `importer.import_jobs` / `import_raw` | 0 / 0 | 现有"聊天记录导入"用，不含旧库用户数据，**不适用**本迁移 |

### 1.4 行数与数据画像（实测）

| 指标 | 数值 |
|---|---|
| 用户 | 553（`uid` 1–572，无重复；`channel` 全 `account`；`status` 全 `active`） |
| 会员 | free 476 / pro 55 / plus 22；`membership_expire_at`：无 474、已过期 30、未过期 49 |
| 密码/恢复码 | 553 条 `$2a$10$` bcrypt；恢复码同样 bcrypt；用户名全部小写字母数字、长度 6–11、无重复 |
| 头像 | 383 个用户有头像，均为本地 `/generated/user-avatars/...` |
| 角色 | 677；`is_official=1` 为 0；`identity_type` 空 676、`fictional` 1；性别 male 452 / female 222 / neutral 3；`quality_score` 全 0；`core_persona` 平均 717 字符（最长 2,387）；**`opening_messages_json` 677/677 为空**；`knowledge_json` 亦为空（知识在 lorebook 表） |
| 角色媒体 | 677 头像全部本地真人照片；488 个 MiMo 克隆样本；`character_voice_bindings` 753（351 角色、4 个 endpoint、3 个模型：`qwen-audio-3.0-tts-plus` 351、`qwen-audio-3.0-realtime-plus` 228、`qwen3.5-omni-plus-realtime` 174）；284 个角色有 `voice_primary_endpoint_id`，其中 278 条能与绑定对上 |
| 好友关系 | 3,474 对（510 用户、630 角色）；其中 222 对从未聊天；交集 3,252 对；另有 **795 对"聊过但不在好友表"** |
| 私聊 | 294,325 条 / 4,047 会话 / 543 用户 / 632 角色；时间 2026-07-12T10:14:33.912Z → 2026-10-23T19:15:44.504Z；`deleted_at` 非空 38,335；`client_message_id` 为空 174,196（59%）；`source_job_id` 非空 151,157；消息类型 text 272,094 / voice 14,057 / sticker 3,614 / system 2,590 / image 1,814 / call 156；`media_status` available 18,647 / deleted 2,463 / missing 5；正文 >4,000 字仅 1 条（最长 4,455） |
| 群聊 | 86 群 / 362 成员 / 18,754 条 / 82 群有消息 / 46 个用户；character 14,216、user 4,515、system 23；`client_message_id` 空 15,673；单群最多 5,217 条 |
| 朋友圈 | 4,757 条（角色 4,015 / 用户 742）；图片 1,031（705 条外链 `picsum.photos`、326 条本地 `moment-images`）；互动 35,204 条，303 个用户参与；**有互动的角色帖仅 1,338 条，2,677 条角色帖无人互动** |
| 记忆 | 13,606 条 / 313 用户；`owner_user_id` 5 条为空；`subject_character_id` 与 `characters_v2.id` 0 匹配、4,343 条为空（该列实为角色名/旧标识，需按名字映射）；摘要 944（其中 6 条 `user_key` 非用户 UUID）；墓碑 1,200（全部可对上用户） |
| 语音偏好 | `user_character_voice_styles` 56 条（22 用户、43 角色）：realistic 44 / vivid 12；无孤儿 |
| 其他 | 关系状态 2,568（粉丝 2,435 / 朋友 90 / 亲密好友 30 / 暧昧 7 / 恋人 4 / 伴侣 2）；阅读游标 2,935；客户端偏好 297；设备绑定 713；Web Push 45；微信绑定 28；微博绑定 57；QQ 1；`public_files` 10 条全部已删且文件不存在 |

### 1.5 媒体清单（实测 `find`/`du -sb`，单位字节）

| 旧路径（相对 `/opt/weiban-server`） | 文件数 | 体积 | 被引用情况 |
|---|---:|---:|---|
| `public/generated/avatars` | 688 | 68,345,993 | 角色头像 677 个 URL（全部本地） |
| `public/generated/chat-images` | 1,427 | 491,812,842 | 1,426 个图片消息引用 |
| `public/generated/voice` | 7,896 | 1,800,170,880 | 6,414 条 `audio_url`（角色语音）；约 1,482 个无引用 |
| `public/generated/voice-samples` | 907 | 264,824,776 | 488 条角色克隆样本 |
| `public/generated/persona-assets` | 299 | 4,547,306 | 299 条 `character_assets` |
| `public/generated/moment-images` | 334 | 331,543,757 | 326 条朋友圈图片 |
| `public/generated/group-avatars` | 24 | 10,654,905 | 86 群中 37 个不同 URL（含 `?t=` 查询串变体） |
| `public/generated/group-chat-images` | 73 | 20,442,477 | 群聊图片（`group_messages.media_path` 共 150 条） |
| `public/generated/stickers` | 157 | 13,251,041 | 旧表情（`sticker_catalog` 231 / `user_stickers` 317 行） |
| `public/generated/user-avatars` | 399 | 129,503,805 | 383 个用户头像 |
| `public/generated/user-prefs` | 579 | 291,323,329 | 客户端偏好图（`user_client_prefs.prefs_json` 内引用） |
| `public/generated/payment` | 2 | 307,984 | 支付二维码，非用户数据 |
| `public/generated/voice-samples-audio-realtime` | 3 | 363,015 | 实时音色样本 |
| `private/chat-media/user-voice` | 7,054 | 1,218,912,724 | 7,313 个不同绝对路径引用（用户语音） |
| `private/chat-media/group-user-voice` | 69 | 12,935,442 | 群内用户语音 |
| `persona_packages` | 849 | 36,539,334 | 824 条角色包（zip） |
| **合计** | **20,760** | **4,695,479,610（4.37 GiB）** | |

**引用—存在性核对（实测，逐文件 `-f`）**：

| 检查 | 引用数（去重） | 缺失 |
|---|---:|---:|
| `chat_history.media_path LIKE '/opt/%'`（用户语音绝对路径） | 7,313 | **259** |
| `/generated/*`（消息图片+角色语音+群语音） | 8,248 | **18** |
| `character_assets.path` | 299 | 0 |
| `persona_packages.stored_path` | 824 | 0 |
| `characters_v2.mimo_voice_sample_path` | 488 | 0 |
| `moments.image_url LIKE '/generated/%'` | 326 | 0 |

其他媒体事实：图片无 >10 MB；用户语音 9 个、角色语音 19 个 >2 MB（新库 `MEDIA_LIMITS.voiceMaxBytes=2 MiB`）；有 2,364 条 `sticker` 消息的 `media_mime='image/svg+xml'`（新库图片白名单不含 SVG）；抽样发现一个 `.png` 实际是 JPEG（扩展名不可信，必须按文件头判 MIME）。

### 1.6 字段三分类

**可迁（结构性等价，转换即可）**：用户账号（除密码）、昵称/资料、会员到期、角色主数据与知识库/示例对话、好友关系、私聊/群聊文本与时间、图片/语音二进制（重新封装）、记忆正文、摘要、墓碑、点赞/评论、阅读游标、语音风格偏好。

**不可迁（新库无对应或为凭据，必须重签/丢弃）**：
| 项 | 旧 | 原因 |
|---|---|---|
| 密码哈希 | `$2a$10$` bcrypt 553 条 | 新库 argon2id，无兼容校验路径（`[代码]` 全仓无 bcrypt） |
| 恢复码哈希 | bcrypt 553 条 | 新库无恢复码表/流程 |
| `uid`、`channel`、`buyer_ref` | `app_users` | 新库以 uuid 为身份，无对应列 |
| 设备/登录会话 | `device_bindings` 713、`sessions` 20 | 令牌哈希与设备语义不同，迁移等于伪造凭据；一律强制重新登录 |
| 微信/微博/QQ 绑定 | `wechat_bindings` 28、`weibo_bindings` 57、`qq_bindings` 1 | 含第三方 bot token/ilink id；新库无表，需用户重新绑定 |
| 支付/订单/CDK/邀请 | `membership_orders` 136、`payment_notifications` 86 等 | 属财务账，不在本迁移范围（另行对账） |
| 关系分值/阶段 | `relationship_states` 2,568 | 新库无对应表；且基于旧算法分制（100 起） |
| 客户端偏好 JSON | `user_client_prefs` 297 | 新库只有 `theme`，前端偏好结构已重写；其中的图片（579 个）同理 |
| 角色包/底稿签名 | `persona_base_versions` 1,738、`persona_packages` 824 | 新库角色卡为 WB-Card 1.0 加密载荷，无签名/包结构 |
| `public_files` | 10 条 | 全部已删除且文件不存在 |
| 旧"全局朋友圈"归属 | `moments` 4,015 条角色帖 | 新库 `posts.owner_user_id` 必填，旧角色帖没有归属用户（详见 §2.7） |

**需人工判断/需决策**：
| 项 | 事实 | 待定问题 |
|---|---|---|
| 密码登录 | bcrypt vs argon2id | 加兼容校验并在登录成功时升级为 argon2id（改代码，约 1–2 人日），还是全员强制重置（需要触达渠道，当前无短信/邮件）→ `[决策 D1]` |
| 真人肖像 | 677 头像均为真人照片；旧 `identity_type` 676 空 | 按新硬边界，`basis=real_person` 的 `portraitPolicy=forbidden`，头像不得沿用 → 全部置空/换默认头像；角色需逐个标注 real/fictional/original → `[决策 D2]` |
| 克隆音色 | 753 绑定、488 样本、`voice_requires_authorization=1`，**无任何授权证据字段/文件**；2026-10-23 盘点已定"缺授权不迁" | 默认不迁；只迁 `user_character_voice_styles` 56 条（无生物特征）。若业务坚持，须先补授权材料 → `[决策 D3]` |
| 朋友圈角色帖 | 2,677 条无互动、1,338 条有互动 | 丢弃 / 归给互动用户 / 全量复制（553×4,015≈222 万行，不可取）→ `[决策 D4]` |
| 旧系统消息 2,590 条 | 文案如"你已添加了X…" | 新 `SystemContent` 需客户端认识的 `code`；改为文本/新增 code/丢弃 → `[决策 D5]` |
| 旧表情 3,614 条 | 内容 `[表情:开心]`，2,364 条 SVG | 新 `StickerContent` 需 `stickerId+mediaId`；按目录映射、转文本、还是丢弃 → `[决策 D6]` |
| 通话消息 156 条 | 文案"语音通话 00:07" | 新 `CallRecordContent` 需 `callId`；旧 `realtime_call_sessions` 258 条可关联子集，其余转文本 → `[决策 D7]` |
| 8 个角色名不在 `characters_v2` | `小V同学` 3,878 条（旧助手）、`张艺谋。` 等 7 个错名共 18 条 | 助手会话是否迁？错名按别名归并？→ `[决策 D8]` |
| 群聊 | 86 群 / 18,754 条 | 新群会话语义（system participant、scene）差异大；可延后一批 → `[决策 D9]` |
| 语音超限 | 9 个用户语音、19 个角色语音 >2 MiB | 转码（ffmpeg→opus）或放宽上限 → `[决策 D10]` |

---

## 2. 字段映射表

### 2.0 ID 策略（统一规则）

原则：**能保留的旧 UUID 一律保留；旧自增整数与文本 ID 用确定性 UUIDv5 派生；所有新实体都有可重算的幂等键**，重复导入自然 `ON CONFLICT DO NOTHING`，不需要"先删后插"。

| 实体 | 旧 ID | 新 ID | 方法 | 幂等键/去重 |
|---|---|---|---|---|
| 用户 | `app_users.id TEXT`（553 个全为合法 UUID） | `identity.users.id uuid` | **保留原值** | PK |
| 角色 | `characters_v2.id TEXT`（677 个全为合法 UUID） | `characters.characters.id uuid` | **保留原值** | PK |
| 会话（私聊） | 无（`user_id+persona_name`） | `chat.conversations.id uuid` | `UUIDv5(NS, "wb:conv:direct:<uid>:<charId>")` | `(owner_user_id,character_id)` 唯一索引 |
| 会话（群） | `chat_groups.id uuid` | `chat.conversations.id` | **保留原值** | PK |
| 参与者 | 无 | `chat.participants.id uuid` | `UUIDv5(NS, "wb:participant:<conv>:<kind>:<refId>")` | `(conversation_id,kind,ref_id)` |
| 消息 | `chat_history.id INTEGER` | `chat.messages.id uuid` | `UUIDv5(NS, "wb:msg:<oldId>")` | `(conversation_id,seq)`、`(conv,sender,client_msg_id)` |
| 群消息 | `group_messages.id TEXT`（非 UUID） | 同上 | `UUIDv5(NS, "wb:gmsg:<oldId>")` | 同上 |
| 联系人 | 无 | `contacts.contacts.id uuid` | `UUIDv5(NS, "wb:contact:<uid>:<charId>")` | `(user_id,character_id)` |
| 媒体 | 旧路径 / `public_files.id` | `media.objects.id uuid` | `UUIDv5(NS, "wb:media:<规范化路径>")` | `storage_key` 唯一；`content_hash` 复核 |
| 记忆 | `user_memories.id`（仅 739 个是 UUID） | `ai_runtime.memories.id uuid` | `UUIDv5(NS, "wb:mem:<oldId>")` | `(user_id,character_id,client_id)` |
| 朋友圈帖 | `moments.id`（非 UUID） | `moments.posts.id uuid` | `UUIDv5(NS, "wb:moment:<oldId>")` | `(owner_user_id,create_key)` |
| 点赞/评论 | 文本 id | 对应表 id | `UUIDv5(NS,"wb:like:<moment>:<uid>")` / `"wb:comment:<oldId>"` | 各表唯一索引 |
| 语音风格 | `(user_id,persona_name)` | `ai_runtime.companion_settings` 或卡片 `social.voiceId` | 见 §2.9 | `(user_id,character_id)` |
| 旧 ID 对照 | — | — | 批次目录 `id-map.tsv`（审计用，不入库） | — |

`NS` 用固定常量（建议 `UUIDv5(URL 命名空间, "https://weiban.app/legacy")`），写入代码常量，**不得**用随机值，否则重跑会重复插入。

**碰撞检查（导入前必做，实测可跑）**：新库现有 15 用户 / 9 角色 / 4 私聊 / 2 群。`SELECT count(*) FROM identity.users WHERE id = ANY($1)` 应为 0；`lower(username)` 与旧 553 个用户名交集应为 0（已核对新旧用户名格式与取值，未见重叠，仍需用查询确认）。若真出现 ID 碰撞：**放弃该条并记入 `conflicts.tsv`**，不得覆盖新库现有行。

### 2.1 身份域（`app_users` → `identity.*`）

| 旧列 | 新列 | 转换 | 空值处理 |
|---|---|---|---|
| `id` | `users.id` | 原值 | — |
| `username` | `users.username` + `login_aliases.alias=lower(username)` | 原值；新旧规则均 4–32 位字母数字下划线，旧值全部合规 | 缺失→跳过该用户（不会发生，553 条全有） |
| `password_hash` | `users.password_hash` | **不能转换**；见 D1 | — |
| — | `users.role` | `'user'` | 新库现无旧管理员 |
| `status='active'` | `users.status` | `'active'` | — |
| `created_at`（`YYYY-MM-DD HH:MM:SS` UTC） | `users.created_at` | 解析为 UTC → `timestamptz` | — |
| `updated_at` | `users.updated_at` | 同上；空则取 `created_at` | — |
| — | `users.last_active_at` | `NULL`（旧库无可靠在线时间） | — |
| `nickname` | `profiles.nickname` | 原值，空→`NULL` | — |
| `avatar_url` | `profiles.avatar_media_id` | 文件→`media.objects(purpose=user_avatar, owner=uid)`→置 id | 文件缺失→`NULL`（缺失数记入报告） |
| `gender`（''/male/female/neutral） | `profiles.gender` | `''`→`unspecified`、`neutral`→`other` | 空→`unspecified` |
| `birthday`（'' 或日期） | `profiles.birthday date` | `''`→`NULL`；非法日期→`NULL` 并告警 | — |
| `region` | `profiles.city` | 原值；>32 字符截断并告警 | 空→`NULL` |
| `signature` | `profiles.about` | 原值；>500 截断并告警 | 空→`NULL` |
| — | `profiles.time_zone` | `'Asia/Shanghai'`（NOT NULL） | 必填 |
| — | `profiles.moments_cover_media_id` | `NULL` | — |
| `membership_level` + `membership_expire_at` | `memberships.pro_plus_until` | pro/plus 且未过期→`membership_expire_at`；已过期→不建行（或建行且 `pro_plus_until` 为空=普通） | free→不建行 |
| — | `preferences(user_id, theme)` | `'system'` 默认（`createDefaults` 同款） | 必建 |
| — | `notification_settings` | 全部走 `createDefaults` 默认值 | 必建 |
| `recovery_code_hash` | — | 丢弃 | — |
| `uid`/`channel`/`buyer_ref` | — | 写入 `id-map.tsv` 备查 | — |

> 每个用户必须同时建 `users`、`profiles`、`preferences`、`notification_settings`、`login_aliases` 五行并在同一事务内；`profiles.completed` 语义由 `nickname` 是否为空推导（新库 `CurrentUser.profileCompleted` 由昵称判断，实测 553 条全部有昵称）。

### 2.2 角色域（`characters_v2` + 附属表 → `characters.*`）

新库角色载荷是 **WB-Card 1.0** 的加密 JSON（`packages/contracts/src/character-card.ts` 的 `WeibanCardData`，`strictObject`，拒绝未知字段），写入时必须有 `AdminCharacterWrite`（`name/aliases/works/tagline/intro/tags/categoryId/avatar/birthday/fanName/classification/fallbackGreetings/card`）。

| 旧列/表 | 新位置 | 转换 | 说明 |
|---|---|---|---|
| `id` | `characters.id` | 原值 | — |
| `display_name` | `characters.name` + `card` 内检索词 | ≤32 字（旧值均短） | — |
| `canonical_name`、`aliases_json`、`nickname` | `aliases[]`、`search_text` | JSON 解析 | `search_text` = name+aliases+works+keywords 拼接（与 `create` 逻辑一致） |
| `avatar_url` | `card.avatar.image`（`mediaId`+`url`） | 导入 `media.objects(purpose=character_avatar)` | **真人角色禁止**：`basis=real_person` 时置 `null`，仅留 `display` 默认头像 |
| `core_persona` | `card.persona.summary/background/personality/values` | 需拆分；`summary` 必填 1–600，`personality` 必填 1–2000 | 旧文本平均 717 字，超长需截断/分段 → 人工或 AI 归并 |
| `speaking_style` | `card.speech.tone`，并补 `selfReference`（≥1）、`emojiHabit`、`sentenceLength` | 旧字段是自由文本，需补结构化必填项 | `selfReference` 建议 `["我"]` |
| `knowledge_json`（全空） | `card.knowledge.entries` | 空 | 真正的知识在 lorebook 表 |
| `character_lorebook_entries` 17,215 | `card.knowledge.entries[]` | 每条 `{id,title,category,keys,content,confidence}`；`category` 从 `title/content` 归并到 7 个枚举，`confidence='fictionCanon'`；`content` ≤300 | 每个角色 ~25 条，需限流到 `max(500)` |
| `character_example_dialogues` 35,082 | `card.examples[]` | `{id,scene,turns:[{role:'user'|'char',text}]}`；`scene` 从旧 `scene` 文本/内容启发式映射到 10 个枚举；**至少 6 条** | 平均 51.8 条/角色，取排序前 6–20 条 |
| `opening_messages_json`（677 全空） | `fallbackGreetings[]`（发布必填 ≥1） | 需从 `core_persona` 生成 1–3 条，或统一模板 | 发布门槛 `hasFallbackGreeting` 直接依赖此字段 |
| `identity_type`（676 空） | `basis`/`real_person_kind` | **必须人工标注**；默认 `real_person`+`celebrity` 而非 `fictional`（宁可多审） | 误判 real→fictional 属合规事故 |
| `gender` male/female/neutral | `card.profileExtra.gender` | `neutral`→`other` | — |
| `birthday`（无该列） | `card.birthday` | `NULL` | — |
| `is_official=0` | `characters.kind='preset'`、`owner_id=NULL` | 全部按预设迁入 | 旧库无 owner，不能造"某用户的角色" |
| — | `characters.status` | **`'draft'`**（不直接 `published`） | 上架前必须过分类与卡片完整度 |
| — | `characters.basis/real_person_kind/age_setting/child_appearance` | 与 `classification` 同源；`age_setting='adult'` 默认，`child_appearance=false` | 有未成年疑点的角色单独阻断 |
| `quality_score`、`schema_kind`、`schema_version`、`heartbeat_*`、`soul_*`、`style_*`、`memory_*`、`moment_profile_json`、`group_chat_json` | `card.admin.extensions` 或按语义映射到 `card.persona/simulation/social` | 无 1:1 对应 | 未映射内容**不得丢弃**，整体塞 `admin.extensions.legacy` 保留原文 |
| `mimo_voice_sample_path`、`cartesia_voice_id`、`qwen_voice_id`、`voice_*` | `media.voices` + `characters.default_voices` / `card.social.voiceId` | 见 §2.9 | 克隆默认不迁 |
| `character_assets` 299 | 不进 `media`（文档类 md/txt），归档到 `persona-assets` 备份 | — | 非图片，不进对象存储 |
| `persona_base_versions`/`persona_packages` | 归档（tar） | 不入库 | 新库无签名/包结构 |
| `persona_customizations` 126 | `characters.user_supplements`（可选） | `patch_json` → 用户补充文本，AAD `characters:supplement:<uid>:<charId>` | 首批可不迁 |

**角色卡完整度是本次迁移最大的内容工作量**：677 个角色 × (拆分人设 + 归并 25 条知识 + 选 6 条示例 + 生成开场白 + 标注分类) ≈ 15 分钟/角色 ≈ **169 小时 ≈ 21 人日**。工程上先落 `draft`，按"消息量 Top 20 角色覆盖 52.6% 消息、Top 50 覆盖 74.7%"的顺序逐批过审上架。

### 2.3 联系人域（`user_friends` → `contacts.contacts`）

| 旧 | 新 | 转换 |
|---|---|---|
| `(user_id, persona_name)` | `(user_id, character_id)` | `persona_name` → `characters_v2.display_name` → 保留的角色 uuid；630 个名字需全部命中（8 个异常名见 §2.4） |
| `added_at`（ISO Z） | `added_at timestamptz` | UTC |
| — | `id` | UUIDv5(`wb:contact:<uid>:<charId>`) |
| — | `status` | `'active'`（旧好友表只存已通过关系）；未聊天的 222 对同样 `active` |
| — | `request_id` | 必填，无来源 → 用 UUIDv5(`wb:req:<uid>:<charId>`) 生成稳定占位 |
| — | `acceptance_mode` | `'restored'`（历史关系） |
| — | `accept_after` | 取 `added_at`（NOT NULL） |
| — | `known_since date` | `added_at::date` |
| — | `relationship_type` | 旧 `relationship_states.stage` 映射：恋人/伴侣/暧昧→`romantic`，其余→`friend`（新库枚举需读 `contacts` 模块确认，`[未验证]` 枚举全集） |
| — | `conversation_id` | 有私聊的 3,825 对→对应会话；未聊天的 222 对→`NULL`（新库允许，等用户首次发言再建） |
| — | `greeting_ciphertext` | `NULL`（旧库无问候语） |
| — | `remark`/`address_as`/`custom_avatar_media_id` | `NULL` |
| **795 对"聊过但不在好友表"** | — | 建议同时建 `contacts`（`acceptance_mode='restored'`），否则消息属于"非联系人会话"，客户端可能不显示 → `[决策]` |

### 2.4 私聊域（`chat_history` → `chat.conversations/participants/messages`）

**会话**：4,047 个 `(user_id, persona_name)` → 4,047 个 `direct` 会话 + 每个 2 个 participants（`user` + `character`）+ 1 个 `system` participant（新库 `conversations.system_participant_id` NOT NULL，需先建 `kind='system'` 的 participant 并把 id 回填）。

**消息逐列映射**：

| 旧列 | 新位置 | 转换 |
|---|---|---|
| `id INTEGER` | `messages.id` | UUIDv5(`wb:msg:<id>`) |
| `user_id` | `conversations.owner_user_id`；`participants(ref_id)` | 原 uuid（294,325 条 100% 命中 `app_users.id`，已实测） |
| `persona_name` | `conversations.character_id` / 角色 participant | 按 `display_name` 映射；8 个异常名见下 |
| `role` user/assistant | `sender_kind` + `sender_participant_id` | user→用户 participant；assistant→角色 participant |
| `content` | `content_ciphertext`（JSON 序列化后的 `MessageContent`） | 见下表 |
| `created_at`（ISO Z） | `messages.created_at` | UTC |
| `deleted_at` 非空（38,335） | 默认保持消息 + 写 `chat.hidden_messages(message_id,user_id)`；`deletion_scope='all'` 时改 `status='recalled'` | 语义等价"仅自己删除" |
| `client_message_id`（59% 空） | `client_msg_id` | **统一** `'legacy:<oldId>'`；原值写 `labels[]` 的 `legacy_client_id:<v>`，避免 `(conv,sender,client_msg_id)` 唯一冲突 |
| `source_job_id` | `labels[]` `legacy_job:<id>` | 旧库有唯一索引，重复时会暴露 |
| `quoted_author`/`quoted_content` | `quote_message_id`（能定位则引用，否则并入文本） | 旧库无引用 id |
| `media_expires_at` | 无对应；媒体对象写入 `media.objects.expires_at` | 旧值全部晚于今天（实测过期 0 条） |
| — | `seq` | 每个会话按 `(created_at, oldId)` 升序赋 1..N；`conversations.last_seq=N` |
| — | `scope` | `normal`（旧库无成人分区） |
| — | `content_type` | 取 content JSON 的 `type` |

**消息类型映射（旧 `message_type` → 新 content）**：

| 旧 | 条数 | 新 content | 处理 |
|---|---:|---|---|
| `text` | 272,094 | `TextContent{text}` | 1 条 >4,000 字（4,455）需拆分或截断并告警 |
| `voice` | 14,057 | `VoiceContent{mediaId,durationMs,transcript}` | `audio_duration` 秒×1000；`transcript=content`；`audio_url=/api/chat/media/<id>` 时用该行 `media_path` 找文件 |
| `image` | 1,814 | `ImageContent{mediaId,width,height,sizeBytes}` | 用 `media_path`；`media_status=missing` 的 5 条降级为 `UnsupportedContent` 或占位文本 |
| `sticker` | 3,614 | `StickerContent{stickerId,source,mediaId,description}` | 旧内容只是 `[表情:开心]`；2,364 条是 SVG（新库不支持）→ 按 D6 决策 |
| `system` | 2,590 | `SystemContent{code,params}` | 新 code 需客户端认识；建议新增 `legacy_notice` 并携带 `text` 参数，或降级文本 → D5 |
| `call` | 156 | `CallRecordContent{callId,direction,outcome,durationSec}` | 旧 `realtime_call_sessions` 258 条可配对一部分；无法配对转文本 → D7 |

**8 个无法直接映射的角色名（实测）**：`小V同学` 3,878 条（旧系统助手/引导）、`张艺谋。` 8、`在源地等你🇲🇾` 3、`紫薇` 2、`将奇明` 2、`妮妮` 2、`嫣然` 1、`困困井` 1。建议：`小V同学` 单独迁成一个系统会话或整体归档；其余 7 个名字按"去掉尾标点/别名表"人工确认归属，否则这些消息会丢失或挂到错误角色。

### 2.5 媒体域（文件 → `media.objects`）

| 旧来源 | 新 `purpose` | 处理 |
|---|---|---|
| `generated/chat-images` | `chat_image` | 原样导入；按文件头判 MIME（发现 `.png` 实为 JPEG） |
| `generated/voice`（角色语音） | `chat_voice` 或 `generated_voice` | 建议 `chat_voice`（消息内引用）；>2 MiB 的 19 个需转码 |
| `private/chat-media/user-voice` | `chat_voice` | 用户语音；259 个缺失→消息降级并记入报告；9 个 >2 MiB 转码 |
| `private/chat-media/group-user-voice` | `chat_voice` | 69 个 |
| `generated/voice-samples` | `voice_sample` | 488 个（克隆样本；是否迁见 D3） |
| `generated/avatars` | `character_avatar` | 677；真人角色置空（D2） |
| `generated/user-avatars` | `user_avatar` | 383 |
| `generated/group-avatars` | `group_avatar` | 24 个文件 / 37 个 URL（去查询串后归一） |
| `generated/group-chat-images` | `chat_image` | 73 |
| `generated/moment-images` | `moments_image` | 326 |
| `generated/stickers` | `user_sticker`/`sticker_library` | 157；需与旧 `sticker_catalog`/`user_stickers` 行配对 |
| `generated/user-prefs` | **无** | 不迁（随客户端偏好废弃） |
| `generated/payment` | **无** | 不迁 |

**对象写入规则（`[代码]` `media.ts`）**：`id=UUIDv5(...)`；`storage_key='<id>.sealed'`；文件内容经 `EnvelopeCrypto.seal(owner, "media:<id>", bytes)` 后写卷；缩略图 `thumb_storage_key` 用 `media-thumb:<id>`；`state='ready'`；`owner_id` = 用户 id（用户媒体）或 `NULL`（平台素材，owner 记为 `platform` 加密）；`content_hash=sha256(明文)`；`mime_type` 以文件头为准；图片同时落 `width/height`（可用 sharp）。

### 2.6 记忆域（`user_memories` / `conversation_summaries` / 墓碑 → `ai_runtime.*`）

| 旧 | 新 | 转换 |
|---|---|---|
| `user_memories.id` | `memories.id` | UUIDv5 |
| `owner_user_id`（5 条空） | `memories.user_id` | 空的跳过并记报告 |
| `user_key`（803 个，非用户 id） | 用于推导 `character_id` | 实测 `user_key` 不等于用户 id，也不等于角色 id → **必须按 `(owner_user_id, 角色名)` 或旧表内其他线索重建**；`subject_character_id` 与角色 id 0 匹配（疑似存的是名字）→ 逐条按名字解析，解析失败则挂到该用户最近会话角色并标记 `origin='system'` |
| `content` | `memories.ciphertext` | `seal(uid, "ai:memory:<id>", JSON{payload})`；新库 memory 载荷结构需按 `memory.ts` 定义的 JSON 组装（`[代码]`，字段含 content/type/confidence/source） |
| `mem_type`、`confidence`、`source`、`visibility` | 载荷内字段 | `visibility` 与 `scope` 映射：single→`normal`；adult→`adult`（旧库无 adult，全部 normal） |
| `conversation_id` | 由 `(uid, characterId)` 找 direct 会话 | 找不到则跳过 |
| `client_id` | 旧 `id` | 用于 `(user_id,character_id,client_id)` 唯一 |
| `created_at` ISO Z | `memories.created_at` | UTC |
| `conversation_summaries` 944 | `memory_states.summary_ciphertext`（按 uid+char+conv 聚合） | 旧摘要文本 → 新摘要 JSON（结构不同，需适配层）；`covered_until_id` 映射为 `cursor_seq` |
| `persona_memory_tombstones` 1,200 | 不迁（导入时直接不导入对应记忆） | 墓碑即"已删除"，迁移后无需保留删除记录 |
| `group_memories` 11,225 | `group_memory_states.result_ciphertext` | 需把 72 个群的 1.1 万条记忆聚合成每群一份 JSON；建议**延后一批**，先只迁群消息 |

> 记忆是"AI 生成内容"，丢失可重建（代价是角色忘事），因此放在 P6 批，允许部分降级：解析不出角色的记忆写入报告而不是硬失败。

### 2.7 朋友圈域（`moments`/`moment_interactions` → `moments.*`）

新库模型是"**每个用户自己的朋友圈**"：`posts.owner_user_id` 必填；角色帖 `author_character_id` 必填且 `visibility_kind` 必须为空；用户帖必须有 `visibility_kind`。

| 旧 | 新 | 转换 |
|---|---|---|
| 用户帖 742（`author_type='user'`，`author_id`=用户 uuid） | `posts(owner_user_id=author_id, author_kind='user', visibility_kind='all_characters')` | 直接可迁 |
| 角色帖 4,015（`author_id`=**角色 display_name**，已实测 100% 命中） | `posts(owner_user_id=?, author_kind='character', author_character_id=角色, visibility_kind=NULL)` | **归属缺失**：仅 1,338 条有互动用户。方案 A：只迁有互动的 1,338 条并归给最早互动的用户；方案 B：全部丢弃；方案 C：复制到每个用户（否决，222 万行） → D4 |
| `content` | `text_ciphertext` | `seal(uid,"moments:post:<id>",text)` |
| `image_url` 本地 326 | `post_media(position=0,media_id)` | 导入 `moments_image` |
| `image_url` 外链 705（`picsum.photos`） | `posts.link`（或按外链图片处理） | 外链不稳定，建议只保留 `link`，不下载 |
| `moment_interactions` 35,204（点赞/评论，`user_id` 14,175 条非空、21,029 条空） | `likes`（actor=user/character）+ `comments`（`text_ciphertext`） | 空 `user_id` 的互动无法归属 → 丢弃或挂到帖子归属用户；`reply_to_*` 有值 0 条（旧库未用） |
| `created_at` | `created_at` | UTC |
| — | `create_key` | `'legacy:<oldId>'`（配 `(owner,create_key)` 唯一） |

### 2.8 群聊域（`chat_groups`/`chat_group_members`/`group_messages` → `chat.*`）

| 旧 | 新 | 转换 |
|---|---|---|
| `chat_groups.id`（uuid） | `conversations.id` | 保留 |
| `chat_groups.user_id` | `conversations.owner_user_id` | 原值（86/86 命中） |
| `name`、`avatar` | `conversations.title`、`group_avatar_media_id` | 头像 24 个文件 |
| — | `conversations.type='group'`、`system_participant_id` | 需建 system participant |
| `chat_group_members` 362 | `participants(kind='character',ref_id=角色)` | 按 `character_name` 映射；用户自己也是 participant |
| `group_messages.sender_type` character/user/system | `messages.sender_kind` + participant | character 按 `sender_name` 映射 participant；system 用 system participant |
| `group_messages.content` | 同私聊 content 规则 | `message_type` normal/voice/image/… |
| `group_messages.id TEXT` | UUIDv5(`wb:gmsg:<id>`) | 非 UUID |
| `turn_id`/`scene_id`/`step_no`/`turn_reply_index` | `labels[]` | 新库无对应结构 |
| `group_memories` 11,225 / `group_scenes` 1,394 | 见 §2.6/延后 | 群场景在新库是 `ai_runtime` 规划产物，非历史数据 |
| 86 群 / 18,754 条 | — | 建议独立一批（P8），可先不迁群记忆与场景 |

### 2.9 语音域（`character_voice_bindings`/`user_character_voice_styles` → `media.voices`/`characters.default_voices`/用户设置）

- 新模型：`media.voices(id, provider_voice_key, model_key, sample_media_id)` + `characters.default_voices(character_id PK, voice_id)`（**每角色只能一个默认音色**）。
- 旧模型：每角色×endpoint×model 一条（753 条，4 endpoint），`user_character_voice_styles` 是"用户对某角色的风格偏好"（vivid/realistic）。
- 映射建议：
  1. 先把 4 个 endpoint 的 `(provider,model,voice_id)` 去重成 `media.voices` 行（预计 ≤ 数百），`provider_voice_key=voice_id`、`model_key=model`、`sample_media_id` 取该角色的 MiMo 样本（488 个）；
  2. 每角色只取 **`characters_v2.voice_primary_endpoint_id` 命中的那条**（278 条可直接对上；其余 73 条取任一 ready 绑定并记报告）；
  3. 753 条里剩下的绑定**不迁**（新库无 per-endpoint 结构），归档 TSV；
  4. 56 条 `user_character_voice_styles`：新库 `ai_runtime.companion_settings` 或 `media.voices` 无对应列 → 需产品确认落点（可暂存 `characters.user_supplements` 或客户端偏好）→ D3。
- **合规闸门**：`voice_requires_authorization=1` 只是旧系统的开关，不是授权书；2026-10-23 盘点结论是"本人声音授权缺失时不得开通克隆"。本方案默认：**克隆音色（753 绑定 + 488 样本）不迁入可播放路径**，只迁 `media.voices` 元数据并把 `enabled=false`；待补授权后再启用。

### 2.10 时间与时区

| 旧格式 | 出现位置 | 转换 |
|---|---|---|
| `YYYY-MM-DD HH:MM:SS` | `app_users.created_at/updated_at`、`character_voice_bindings` 等 `datetime('now')` 默认列 | 按 **UTC** 解析 → `timestamptz` |
| `YYYY-MM-DDTHH:MM:SS.sssZ` | `chat_history`、`group_messages`、`moments`、`user_memories`、`user_friends.added_at` | 按 ISO UTC 解析 |
| 空串 `''`（大量"空时间"） | `membership_expire_at`、`deleted_at`、`*_at` 可空列 | SQLite 里 `''` ≠ NULL，必须**显式转 NULL**，否则 `timestamptz` 解析报错 |

校验：新旧两侧 `min/max(created_at)` 必须一致（UTC）；抽样 1,000 条时间戳逐一相等；前端展示仍按用户 `time_zone='Asia/Shanghai'`（新库已有该列）。

### 2.11 加密（旧明文 → 新信封）

**事实纠正**：旧库正文是明文（`[实测]` 直接读出 `你已添加了…`、`[表情:开心]`），媒体文件也是明文（`[实测]` `file` 识别为 JPEG/MP3）。因此不存在"用旧 DEK 解开"这一步；迁移是"**明文读入内存 → 用新 owner 的新 DEK 封装 → 只写密文**"。

`[代码]` 新库 AAD 一览（`EnvelopeCrypto.seal(owner, aad, plaintext)`，AAD 实际拼成 `weiban:data:<owner>:<aad>`）：

| 目标列 | owner | AAD 模板 | 来源 |
|---|---|---|---|
| `characters.draft_ciphertext` | `owner_id ?? 'platform'` | `character:<id>:draft:<revision>` | `characters.ts` `decode/create/update` |
| `characters.published_ciphertext` + `persona_versions.ciphertext` | 同上 | `character:<id>:published:<persona_version>` | `characters.ts` publish |
| `characters.user_supplements.text_ciphertext` | 用户 id | `characters:supplement:<uid>:<charId>` | `supplements.ts` |
| `chat.messages.content_ciphertext` | 会话 owner（用户 id） | `chat:message:<messageId>` | `chat/write.ts` |
| `contacts.greeting_ciphertext` | 用户 id | `contacts:greeting:<id>` | `contacts/commands.ts` |
| `ai_runtime.memories.ciphertext` | 用户 id | `ai:memory:<id>` | `memory.ts` |
| `moments.posts.text_ciphertext` | `owner_user_id` | `moments:post:<id>` | `moments.ts` |
| `moments.comments.text_ciphertext` | `owner_user_id` | `moments:comment:<id>` | `moments.ts` |
| `media.objects` 内容 | `owner_id ?? 'platform'` | `media:<id>`；缩略图 `media-thumb:<id>` | `media.ts` |

**约束**：AAD 里的 id 与 version 必须与写入的新行**完全一致**；改 AAD 或改 owner 都会导致运行期解密失败（表现为"媒体/消息打不开"，且无明文可救）。导入器必须直接调用 `EnvelopeCrypto`（`apps/server/src/platform/crypto/envelope.ts`），**禁止**自写 AES 或手工拼 AAD。

**密钥**：KEK 在 `/srv/weiban/secrets/kek`（`PLATFORM_KEK_VERSION=1`），DEK 在 `platform.user_data_keys`。迁移后 `platform.user_data_keys` 应新增 553 条用户 owner + 1 条 `platform`（若不存在）；`EnvelopeCrypto.inspectKeys()` 应输出 `kek_version=1` 且全部可解包。KEK 丢失 = 所有密文永久不可解，因此**KEK 备份与数据库备份必须分开存放**（现状 KEK 只在 `/srv/weiban/secrets`，`[风险]`）。

---

## 3. 迁移流程（冻结 → 快照 → 加密导出 → 传输 → 干跑 → 分批导入 → 校验 → 切流）

> 前置代码交付（当前**不存在**，必须另行授权开发）：`scripts/ops/export-legacy-users.mjs`、`apps/server/src/cli/import-legacy-users.ts`、`legacy-user-import` 模块、`verify-legacy-users` 子命令、以及一张批次台账表（建议迁移 `0140_legacy_user_import`：`platform.legacy_import_batches(batch_id, shard, sha256, rows, applied_at, receipt jsonb)`）。没有台账也能靠确定性 ID 幂等，但有台账才能审计"哪一批、多少行、谁批的"。

### Phase 0 预备（不碰数据，1–2 天）

1. 在 `weiban-dryrun-postgres` 上建演练库：
   ```bash
   docker exec weiban-prod-postgres-1 pg_dump -U weiban -d weiban -Fc \
     | docker exec -i weiban-dryrun-postgres psql -U weiban -d weiban_dryrun   # 按实际库名调整
   ```
   产物：演练库；用途：导入彩排 + 校验脚本调试。
2. 在演练库跑一次"新库基线"导出（本文 §1.3 的数字即基线）。
3. 建批次目录（新服，0700，属主与容器 `node` 用户一致）：
   ```bash
   install -d -m 700 -o www -g www /srv/weiban/migration
   ```
4. 资产核对清单（旧服，只读）：
   ```bash
   sqlite3 'file:/opt/weiban-server/weiban.db?mode=ro' \
     "SELECT media_path FROM chat_history WHERE media_path LIKE '/opt/%'" > /tmp/paths.txt
   while read -r p; do [ -f "$p" ] || echo "$p"; done < /tmp/paths.txt > /tmp/missing.txt
   ```
   产物：`missing.txt`（预期 259 行）、`generated-missing.txt`（预期 18 行）。**预期缺失之外的任何新增缺失都视为阻断**。

### Phase 1 冻结（维护窗口 T-0，约 10 分钟）

1. 公告与只读提示；确认无正在写入的客户端批量任务。
2. 停旧服写进程（旧机 `server.js` 不在 systemd 里，实测由 root 手工拉起；`voice_bridge.js` 同）：
   ```bash
   sudo -n pkill -TERM -f '/opt/weiban-server/server.js'
   sudo -n systemctl stop weiban-voice-bridge weiban-voice-agent weiban-livekit
   sleep 5
   sudo -n fuser -v /opt/weiban-server/weiban.db   # 应为空
   ```
3. 记录冻结时刻与 WAL 大小；**冻结期间旧服不再对外服务**（或由入口切到维护页）。
4. 失败处理：任一进程未退出 → `kill -TERM` 重试 → 仍不退则放弃本窗口（不 `-9` 硬杀，避免半写事务），恢复服务并重新排期。
5. 回滚点 **R-1**：重新拉起旧服即可（`cd /opt/weiban-server && node server.js` + systemd 启动语音服务）。

### Phase 2 只读快照（约 10–20 分钟，1.7 GB）

1. 生成一致快照（`[实测]` 旧盘仅剩 8.6 GB，够放 1.7 GB 快照，但不要再留多份）：
   ```bash
   sudo -n install -d -m 700 -o root -g root /opt/weiban-server/_migration-20261024
   sudo -n sqlite3 'file:/opt/weiban-server/weiban.db?mode=ro' \
     ".backup '/opt/weiban-server/_migration-20261024/weiban-snapshot.db'"
   sudo -n sqlite3 /opt/weiban-server/_migration-20261024/weiban-snapshot.db 'PRAGMA integrity_check;'   # 期望 ok
   sudo -n sha256sum /opt/weiban-server/_migration-20261024/weiban-snapshot.db | tee /tmp/snapshot.sha256
   ```
   说明：`.backup` 对源库只读，会把 WAL 内容并入快照，**不要在未停写时用 `cp`**（`db`+`-wal` 三件套必须同时刻，否则不一致）。
2. 媒体清单（流式 sha256，不落第二份副本）：
   ```bash
   sudo -n find /opt/weiban-server/public/generated /opt/weiban-server/private/chat-media \
        /opt/weiban-server/persona_packages -type f -print0 \
     | xargs -0 sha256sum > /opt/weiban-server/_migration-20261024/media-manifest.sha256
   ```
3. 产物：`weiban-snapshot.db`、`media-manifest.sha256`、`snapshot.sha256`。
4. 失败处理：`integrity_check` 非 `ok` → 放弃窗口，恢复旧服；重新在更干净的窗口重做（先 `PRAGMA quick_check` 定位）。

### Phase 3 加密导出（快照上跑，约 20–30 分钟）

按"用户分片"导出，每片一个 JSONL + 一个 manifest；分片键用用户 uuid 首字符（16 片，实测分布 553/16≈35 用户/片，最大片仍可能含 3–5 万条消息，需再按会话二次切分，单片 ≤ 64 MiB）。

1. 在旧机用 `better-sqlite3` 只读打开**快照**（不碰生产库），导出器输出：
   - `shard-<n>/users.jsonl`、`characters.jsonl`（只导一次，不按用户切）、`contacts.jsonl`、`conversations.jsonl`、`messages.jsonl`、`memories.jsonl`、`moments.jsonl`、`groups.jsonl`；
   - `shard-<n>/manifest.json`：`{shard, tables:{name:rows}, media:[{path,sha256,bytes}], sourceSnapshotSha256, exportedAt}`；
   - `shard-<n>/sha256.txt`。
2. 用接收方公钥做 CMS 认证加密（沿用 `export-legacy-upstreams.mjs` 同一套参数）：
   ```bash
   openssl cms -encrypt -binary -aes-256-gcm -outform DER \
     -in shard-0/messages.jsonl -out shard-0/messages.cms \
     -recip receiver.crt \
     -keyopt rsa_padding_mode:oaep -keyopt rsa_oaep_md:sha256 -keyopt rsa_mgf1_md:sha256
   sha256sum shard-0/messages.cms
   ```
3. 产物：`shard-*/**.cms` + `sha256.txt`；明文 JSONL 在加密后立即 `shred -u`。
4. 失败处理：CMS 结构校验失败（非 AuthEnvelopedData / 非 aes-256-gcm / 非 rsaesOaep）→ 该片作废重导；证书指纹与 `receiver.json` 的 `recipientSha256` 不一致 → 停止，重新 `prepare`。
5. 回滚点 **R0**：本阶段不写新库，旧服仍在冻结；任何失败可恢复旧服。

### Phase 4 传输（约 30–60 分钟，4.7 GB 媒体 + 约 300–600 MB 文本密文）

1. 文本密文：`rsync -av --partial -e "ssh -i weiban_deploy" shard-*/ root@103.231.58.124:/srv/weiban/migration/<batchId>/incoming/`
2. 媒体：同样的 rsync（SSH 传输加密）；到新服后**立即**重新封装进 `media.objects` 并删除暂存明文：
   ```bash
   rsync -av --partial -e "ssh -i weiban_deploy" /opt/weiban-server/public/generated/chat-images/ \
     root@103.231.58.124:/srv/weiban/migration/<batchId>/media/chat-images/
   ```
3. 产物：新服 `/srv/weiban/migration/<batchId>/`（0700，`www:www`），`incoming/` 与 `media/`。
4. 失败处理：rsync 中断可续传；sha256 不符的片重传；**任何明文媒体在新服停留不得超过 24 小时**。
5. 回滚点 **R0**（删除批次目录即可，无库写入）。

> 传输方式说明：媒体 4.7 GB 逐文件 CMS 加密不现实（2 万个 `openssl` 进程），采用"SSH 传输加密 + 落地即封装 + 24 小时内清除明文"的折中；文本数据仍走标准 CMS。若审计要求媒体也走 CMS，可改为按目录打 tar 后整包 CMS（单片 ≤ 512 MiB）。

### Phase 5 干跑 plan（只读，约 10 分钟）

1. 先由运维在新服执行接收方 `prepare`（沿用现有 CLI；需要管理员 uuid 与本次加密备份回执）：
   ```bash
   docker compose -p weiban-prod run --rm --no-deps \
     -v /srv/weiban/migration:/migration \
     app node dist/import-legacy-upstreams.js --prepare \
       --operator-id <admin-uuid> --secret-root /migration/<batchId>/receiver \
       --scope-file /migration/<batchId>/scope.json --backup-reference <backup-id>
   ```
   产物：`receiver/receiver.crt`、`receiver-key.sealed`、`receiver.json`（1 小时有效；过期重做）。
2. 新导入器干跑（**只读事务**，与现有 `--plan` 相同：`SET default_transaction_read_only=on`）：
   ```bash
   docker compose -p weiban-prod run --rm --no-deps \
     -v /srv/weiban/migration:/migration \
     app node dist/import-legacy-users.js --plan \
       --batch-directory /migration/<batchId> --shard shard-0 \
       --expected-sha256 <sha256> --operator-id <admin-uuid>
   ```
3. 产物：`plan-<shard>.json`：每表 `wouldInsert / wouldSkip(conflict) / wouldReject(reason)`；媒体 `wouldSeal / missing`。
4. 通过条件：`wouldReject=0`（除已知 259+18 缺失媒体，需显式列入 `allowedMissing`）；`wouldSkip` 只允许出现在"已导入过的同片"重跑场景。
5. 失败处理：干跑不写库，失败即改数据/改映射重跑；**不得**为了通过而放宽校验。

### Phase 6 分批导入（4 个窗口，见 §6）

每片一个事务；顺序固定：用户 → 角色 → 联系人 → 会话/参与者 → 消息 → 媒体 → 记忆 → 朋友圈 → 群聊 → 语音。

```bash
docker compose -p weiban-prod run --rm --no-deps \
  -v /srv/weiban/migration:/migration \
  app node dist/import-legacy-users.js --apply \
    --batch-directory /migration/<batchId> --shard shard-0 \
    --expected-sha256 <sha256> --operator-id <admin-uuid> \
    --backup-reference <backup-id>
```

- 产物：`import-receipt.json`（每表 inserted/skipped、媒体 sealed/missing、耗时）、`accepted-packet.sha256`（防重放）、`platform.legacy_import_batches` 行、`platform.audit_log` 记录。
- 失败处理：单片事务回滚 → 修复 → 重跑同片（确定性 ID 保证不重复）；**跨片不回滚**，已提交片保留，后续片继续。
- 回滚点：
  - **R1**：单片事务自动回滚；
  - **R2**：`pg_dump` 全库回滚（导入前 `pg_dump -Fc` 到 `/srv/weiban/backups/pre-import-<ts>.dump`，恢复需停 app，约 10–20 分钟）；
  - **R3**：切流后回滚 = 入口切回旧服（旧服保留只读 + 原库，至少 14 天）。

### Phase 7 校验（见 §4，约 1–2 小时）

### Phase 8 切流

1. 新服验收通过后：入口/DNS/客户端配置切到新服；旧服保持停机但**不删库、不删媒体**。
2. 观察 24–72 小时；期间旧服可随时回切（R3）。
3. 稳定后：旧服设只读、导出最终审计归档、按保留策略下线；`_migration-20261024` 与 `/srv/weiban/migration/<batchId>` 加密归档后删除明文。

---

## 4. 校验规则与通过标准

### 4.1 行数（硬门槛，必须完全相等）

| 检查 | 期望 |
|---|---|
| `identity.users` | 553（旧）+ 15（新库已有）= 568；若走"重置密码"分支也必须是 568 |
| `identity.profiles/preferences/notification_settings/login_aliases` | 各 568（每用户一行） |
| `characters.characters` | 677 + 9 = 686；其中 `kind='preset'` 686、`status='draft'` ≥ 677 |
| `characters.persona_versions` | 677（每个角色 version=1）+ 9 |
| `characters.default_voices` | 278（可对上的主音色）+ ≤73（兜底取一条）；`enabled=false` 期间允许 0 |
| `contacts.contacts` | 3,474 + 5 = 3,479（若采纳"795 对非好友也建团"则 3,474+795+5 = 4,274） |
| `chat.conversations`（direct） | 4,047 + 4 = 4,051 |
| `chat.conversations`（group） | 86 + 2 = 88 |
| `chat.messages` | 294,325 + 130 = 294,455（不含被丢弃的 8 个异常角色消息；若丢弃需在回执中列出条数） |
| `chat.messages`（群） | 18,754 |
| `media.objects` | 1,612 + 实际导入对象数（预期 1,426+6,414+7,054+69+488+677+383+24+73+326+157 = 17,091；若去重/转码会变化，以 manifest 对账为准） |
| `ai_runtime.memories` | 13,606 - 5（空 owner）- 解析失败数 + 6 |
| `moments.posts` | 742（用户帖）+（1,338 或 0，按 D4）+ 3 |
| `moments.likes`/`comments` | 与旧 35,204 中可归属部分一致 |
| `platform.user_data_keys` | 16 + 553 = 569（含 `platform`） |

### 4.2 引用完整性（必须为 0）

```sql
-- 消息必须有会话；会话必须有 owner 与 system participant
SELECT count(*) FROM chat.messages m LEFT JOIN chat.conversations c ON c.id=m.conversation_id WHERE c.id IS NULL;
SELECT count(*) FROM chat.conversations WHERE system_participant_id IS NULL OR owner_user_id IS NULL;
-- 联系人/记忆/朋友圈必须能对上用户与角色
SELECT count(*) FROM contacts.contacts c LEFT JOIN identity.users u ON u.id=c.user_id LEFT JOIN characters.characters ch ON ch.id=c.character_id WHERE u.id IS NULL OR ch.id IS NULL;
SELECT count(*) FROM ai_runtime.memories m LEFT JOIN identity.users u ON u.id=m.user_id LEFT JOIN characters.characters c ON c.id=m.character_id WHERE u.id IS NULL OR c.id IS NULL;
-- 消息引用的媒体必须存在且 ready
-- （媒体 id 在加密载荷内，用导入器 --verify-media 逐个解密核对）
```

### 4.3 时间线连续性（必须为 0）

```sql
-- seq 从 1 连续、无空洞、无重复，且 last_seq 一致
SELECT count(*) FROM (
  SELECT conversation_id, count(*) c, min(seq) mn, max(seq) mx, count(DISTINCT seq) d
  FROM chat.messages GROUP BY 1
  HAVING mn<>1 OR mx<>c OR d<>c
) x;
SELECT count(*) FROM chat.conversations c
WHERE c.last_seq <> (SELECT coalesce(max(seq),0) FROM chat.messages m WHERE m.conversation_id=c.id);
-- created_at 在会话内单调不减（允许同秒并列）
SELECT count(*) FROM (
  SELECT conversation_id, seq, created_at,
         lag(created_at) OVER (PARTITION BY conversation_id ORDER BY seq) prev
  FROM chat.messages
) t WHERE prev IS NOT NULL AND created_at < prev;
-- 全局时间范围与旧库一致（UTC）
SELECT min(created_at), max(created_at) FROM chat.messages;
-- 期望 2026-07-12 02:14:33.912+00 ~ 2026-10-23 11:15:44.504+00
```

### 4.4 抽样字段比对（内容正确性）

| 项 | 方法 | 通过标准 |
|---|---|---|
| 消息正文 | 导入器 `--verify-content --sample 0.05`：从旧 JSONL 取 5%（≥14,700 条）与新库解密结果做 sha256 比对 | 100% 相同；解密失败 0 |
| 时间戳 | 同一批抽样逐条比较 `created_at` | 100% 相等（UTC 微秒级；旧库毫秒精度） |
| 消息类型 | 抽样比对 `content.type` 与旧 `message_type` 映射表 | 100% 符合映射；降级项在回执中列明 |
| 用户资料 | 抽 50 个用户比对 nickname/avatar 有无/会员到期 | 100% 相同（允许 avatar 因缺失置空并记录） |
| 角色卡 | 全部 677 个 `published/draft` 载荷过 `WeibanCardData.parse`/`DraftCharacterCard.parse` | 解析成功率 100% |
| 记忆 | 抽 500 条比对正文 | 100% 相同 |

### 4.5 媒体可读性（量化）

1. 新库 `SELECT count(*) FROM media.objects WHERE state<>'ready'` = 0。
2. 卷上每个 `storage_key` 文件存在、大小与 `size_bytes` 匹配：`--verify-media` 全量执行，失败 0。
3. 抽样 10%（≥1,700 个）解密后 sha256 与旧 `media-manifest.sha256` 比对：100% 相同；全量解密失败必须为 0。
4. MIME 与文件头一致率 100%（禁止用扩展名）；不合法 MIME 0。
5. 已知缺失只允许出现在白名单：`chat_history.media_path` 259 个、`/generated` 18 个；**新增缺失 0**。缺失对应消息必须显式降级（占位文本/`UnsupportedContent`），不得静默丢消息。
6. 体积/时长上限：`chat_voice` ≤2 MiB 且 ≤60 s；超限 28 个必须转码或列白名单（D10）；图片 ≤10 MiB（实测 0 超限）。

### 4.6 角色卡完整度（发布门槛，量化）

| 指标 | 门槛 |
|---|---|
| 全部角色 `draft_ciphertext` 存在且可解析 | 100% |
| 发布前 `requiredFieldsComplete` + `personaStabilityPassed` + `hasFallbackGreeting` | 上架角色 100% |
| `fallbackGreetings` 至少 1 条 | 100%（旧库 0 条开场白，必须生成） |
| `card.examples` ≥6 且每角色 ≤100 | 上架角色 100% |
| `card.knowledge.entries` 每条 ≤300 字、`confidence` 合法 | 100% |
| `classification` 与 `basis` 组合通过 `checkClassificationCombination` | 100% |
| `safetyStyle.careFallbackText` 含 12356/110/120 与"信任"字样 | 上架角色 100%（模板兜底） |
| 真人角色头像为空 | `basis=real_person` 的角色 100% |

### 4.7 幂等与可重放

- 同一 shard 连续 `--apply` 两次：第二次 `inserted=0、skipped=全部`，全库行数不变；
- 篡改一个字节后 `--apply`：`PACKET_DIGEST_MISMATCH` 退出 1，库无变化；
- 换证书重放：`REPLAY_CONFLICT`（沿用 `accepted-packet.sha256`）。

### 4.8 整体通过标准

**全部满足才算迁移成功**：§4.1 行数全对；§4.2 = 0；§4.3 = 0；§4.4/§4.5 抽样 100% 一致且解密失败 0；§4.6 上架角色达标；§4.7 三条通过；业务方抽查 20 个真实用户会话（含最长会话 39,995 条那个）逐屏比对无差异。

---

## 5. 风险清单

| # | 风险 | 现状/证据 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | **密码不可迁移** | 553 条 bcrypt `$2a$10$`；新库 argon2id；全仓无 bcrypt | 全员无法登录，迁移"上线即不可用" | D1：二选一（兼容校验+登录时升级 / 强制重置）。推荐兼容方案：`accounts.ts` 校验顺序 argon2→bcrypt，成功后立即用 argon2id 重写；开关 `LEGACY_BCRYPT_LOGIN=1`，观测 30 天后关闭 |
| R2 | **角色归属与合规分类缺失** | 677 角色无 owner；`identity_type` 676 空；头像全真人照片；克隆授权无证据 | 角色卡不能上架；真肖像/克隆音色可能违规 | 全部以 `preset`+`draft` 迁入；真人角色头像置空；753 克隆绑定 `enabled=false`；分类逐个人工标注后才 publish（D2/D3） |
| R3 | **媒体缺失与不可读** | 实测 259 个用户语音、18 个 generated 引用文件不存在；2,364 条 SVG 表情；`.png` 实为 JPEG | 消息打开 404；校验"媒体缺失"掩盖真实问题 | 迁移前生成 `missing.txt` 白名单；缺失消息显式降级；MIME 用文件头；SVG 走 D6；超限 28 个转码（D10） |
| R4 | **重复导入 / 半批失败** | 现有接收器有 `accepted-packet.sha256`，但用户数据量大、分片多 | 重复行、seq 冲突、last_seq 错乱 | 确定性 UUIDv5 + 唯一索引 + `ON CONFLICT DO NOTHING` + 每片事务 + 批次台账 + 重跑只补差 |
| R5 | **ID 冲突** | 新库已有 15 用户/9 角色/4 私聊/2 群；旧 UUID 若撞上会被覆盖 | 覆盖线上测试数据或外键错乱 | 导入前跑碰撞查询（§2.0）；冲突行写 `conflicts.tsv` 并跳过；禁止 `ON CONFLICT DO UPDATE` 覆盖既有行 |
| R6 | **加密密钥不匹配** | KEK 仅存 `/srv/weiban/secrets/kek`（版本 1）；AAD 绑定 id+version | 解密失败 = 数据永久不可读；KEK 丢失 = 全库报废 | 导入前后跑 `EnvelopeCrypto.inspectKeys()`；AAD 由代码生成禁止手拼；KEK 离线备份（与 DB 备份分离）并在演练库做一次 seal/open 回环 |
| R7 | **旧库 0666 + 明文媒体** | `weiban.db` 0666；库与媒体均为明文；旧机 root 运行 | 同机任何用户可读全量用户隐私；导出期间明文落盘 | 冻结窗口内 `chmod 600`（需账号持有人授权）；快照/导出目录 0700 root；加密后 `shred` 明文；传输只用 SSH；新服暂存 24 小时内清除 |
| R8 | **迁移期间新写入** | 旧服 `server.js` 手工常驻，冻结前仍在写（WAL 179 MB 且在涨） | 快照后到切流间的消息丢失 | 冻结窗口内停写并对外维护页；快照取"停写后"；不做增量双写（成本高），改为"窗口内不接受写入 + 切流后旧库只读" |
| R9 | **朋友圈归属语义变化** | 4,015 条角色帖无 owner，仅 1,338 条有互动 | 全量复制 222 万行；丢弃则用户"记忆中的朋友圈"消失 | 推荐只迁 1,338 条并归给最早互动用户，其余归档 JSON；提前告知产品（D4） |
| R10 | **性能与磁盘** | 旧盘剩 8.6 GB；单会话 39,995 条；294k 消息 | 快照+导出撑爆旧盘；单事务过大超时 | 快照后立即导出并删快照；消息按会话二次切分（单片 ≤64 MiB），大会话单独一片；导入每片 ≤10 分钟 |
| R11 | **旧库无系统级停服入口** | `server.js` 不在 systemd（实测仅语音三个 service 在 systemd） | 冻结时漏杀 → 快照不一致 | 冻结清单写死 PID 与 `pkill -f` 命令，`fuser` 复核为空再快照；演练一次 |
| R12 | **克隆音色/第三方绑定合规** | `voice_requires_authorization=1` 非授权书；微信/微博 token 是凭据 | 违规使用声音；凭据泄露 | 克隆默认不迁、`enabled=false`；第三方绑定不迁，要求用户重新授权绑定 |

---

## 6. 工作量与顺序

### 6.1 交付物与估算

| 阶段 | 交付物 | 人日 | 依赖 |
|---|---|---:|---|
| P0 代码 | 导出器（分片/清单/CMS）、导入器（plan/apply/verify）、批次台账迁移、单测与合成数据测试 | 10 | 本方案批准；D1 决策（影响 users 导入） |
| P1 身份 | 553 用户 + 资料/设置/会员/别名；密码方案落地 | 1.5 | P0、D1 |
| P2 角色 | 677 角色 draft + 35,082 示例 + 17,215 知识 + 299 资产归档 | 3 | P0、D2（分类初值） |
| P3 联系人 | 3,474（或 3,825）联系人 + 关系类型 | 0.5 | P1/P2 |
| P4 私聊 | 4,047 会话 + 8,094 participants + 294,325 消息 + 阅读游标 | 2 | P1/P2 |
| P5 媒体 | 17,091 对象封装 + 缺失白名单 + 转码 | 3 | P4（消息内引用） |
| P6 记忆 | 13,606 记忆 + 944 摘要 | 1.5 | P4 |
| P7 朋友圈 | 742 用户帖 + 1,338 角色帖（D4）+ 互动 | 1 | P1/P2 |
| P8 群聊 | 86 群 + 362 成员 + 18,754 消息（群记忆/场景延后） | 1.5 | P4 |
| P9 语音 | `media.voices` 去重 + 278 default_voices + 56 风格（D3） | 0.5 | P2/P5 |
| 彩排与校验 | 演练库 2 轮全量彩排 + 校验脚本 + 回滚演练 | 3 | 全部 |
| **合计（工程）** | | **≈28 人日** | |
| 角色卡人工归集 | 677 张卡的人设/知识/示例/开场白/分类 | ≈21 人日（可并行、可分角色批次） | P2 |

### 6.2 批次与窗口

| 窗口 | 批次 | 内容 | 预计耗时 | 依赖 |
|---|---|---|---|---|
| W0（演练，不对外） | 全量彩排 | 在 `weiban-dryrun-postgres` 上跑完整 plan+apply+verify | 4–6 h | P0 完成 |
| W1（凌晨 03:00–06:00） | B1 | 冻结+快照+导出+传输+plan；apply P1 身份 + P2 角色 draft | 3 h | W0 通过、D1/D2 有初值 |
| W2 | B2 | P3 联系人 + P4 私聊 + P5 媒体 | 3 h | B1 校验通过 |
| W3 | B3 | P6 记忆 + P7 朋友圈 + P9 语音元数据 | 2.5 h | B2 校验通过 |
| W4 | B4 | P8 群聊 + 切流演练 | 2.5 h | B3 校验通过 |
| 切流 | — | 入口切换 + 24–72 h 观察 | 0.5 h | B4 全绿 |
| 后续（非阻塞） | — | 角色卡逐批 publish（Top 50 优先）、群记忆、克隆音色授权后启用 | 持续 | 内容团队 |

### 6.3 顺序上的硬依赖

1. P0 必须最先（没有导入器寸步难行）；D1 必须在 P1 前定，否则 553 用户导进去也是死的。
2. 角色必须先于联系人/会话/消息（外键 + 名字映射）。
3. 媒体必须与消息同批或紧随，否则消息内 `mediaId` 指向不存在的对象。
4. 记忆依赖会话（要 `conversation_id`）；朋友圈依赖用户+角色；群聊依赖角色。
5. 切流必须在校验全绿后；旧服保留 14 天只读作为 R3 回滚点。

---

## 7. 未验证项与待决策

### 7.1 未验证（本次未做，不得当成结论）

1. **KEK 实际可用性**：未在容器内做 `seal/open` 回环；`inspectKeys()` 输出未采集。
2. **新库是否就是正式目标**：当前仅 15 用户、9 角色，疑似测试/预发数据；`[需确认]` 是否先清空或保留。
3. **旧服停服方式**：`server.js` 无 systemd 单元，实际由 root 手工/脚本拉起，`pkill -f` 是否被监管脚本拉起需确认。
4. **旧→新直连网络**：未测 `rsync` 直连；若不通需经操作机中转（多一跳，注意明文落盘）。
5. **导入吞吐**：294k 消息、4.7 GB 媒体的实际耗时未测，本文按经验估算。
6. **克隆音色授权**：旧库无任何授权字段/文件，视为"无证据"。
7. **角色真人分类**：`identity_type` 676 空，名字多为真人艺人，需人工确认，不能由脚本猜测。
8. **群头像**：37 个 URL vs 24 个文件，差异未逐一定位（疑为查询串或缺失）。
9. **`relationship_type` 新库枚举**：未读全 `contacts` 模块枚举，映射需在实现时确认。
10. **`ai_runtime.memories` 载荷 JSON 结构**：`memory.ts` 内部结构需按代码精确组装，本文只给出 AAD 与唯一键。

### 7.2 待决策（阻塞或有重大影响）

| 编号 | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | 密码 | A 兼容 bcrypt 并在登录时升级（改代码 ≈1–2 人日）；B 全员重置（无触达渠道）；C 先不迁用户只迁内容 | **A**，开关 + 30 天观测 |
| D2 | 真人角色 | A 全部 `basis=real_person`+头像置空+逐个人工复核；B 按"虚构同名"处理（有合规风险）；C 只迁非真人角色 | **A**，先迁 draft 不 publish |
| D3 | 克隆音色 | A 不迁播放路径（`enabled=false`）；B 补授权后启用；C 全量迁 | **A**，等授权 |
| D4 | 角色朋友圈 | A 只迁 1,338 条有互动的并归给互动用户；B 全丢；C 全量复制 | **A** |
| D5 | 旧系统消息 | A 新增 `legacy_notice` code；B 降级文本；C 丢弃 | **B**（最省事，语义损失小）或 A |
| D6 | 旧表情消息 | A 映射到新表情库/用户表情；B 降级文本 `[表情:开心]`；C 丢弃 | **B**，后续再做映射 |
| D7 | 通话消息 | A 关联旧通话记录生成 `CallRecordContent`；B 降级文本 | **B**（156 条，成本不划算） |
| D8 | 8 个异常角色名 | A `小V同学` 单独系统会话，其余按别名归并；B 全部归档 | **A**，先出清单给产品确认 |
| D9 | 群聊批次 | A 独立一批；B 延后到切流后 | **A**（W4） |
| D10 | 28 个超限语音 | A 转码 opus；B 放宽 `voiceMaxBytes`；C 丢弃 | **A**（ffmpeg 在导入器内做） |

---

## 8. 附录：本次只读证据

### 8.1 采集命令（可复现，均未写入）

```bash
# 旧库结构 / 行数 / 画像（只读 URI）
ssh -i weiban_old.pem ubuntu@152.136.111.51 \
  "sqlite3 'file:/opt/weiban-server/weiban.db?mode=ro' '.schema'"
ssh -i weiban_old.pem ubuntu@152.136.111.51 \
  "sqlite3 'file:/opt/weiban-server/weiban.db?mode=ro' 'select count(*) from chat_history;'"
# 媒体清单与存在性
ssh -i weiban_old.pem ubuntu@152.136.111.51 \
  "find /opt/weiban-server/public/generated -type f | wc -l; du -sb /opt/weiban-server/public/generated/*"
# 新库结构 / 行数 / 约束
ssh -i weiban_deploy root@103.231.58.124 \
  "docker exec weiban-prod-postgres-1 psql -U weiban -d weiban -c '\\d+ identity.users'"
ssh -i weiban_deploy root@103.231.58.124 \
  "docker exec weiban-prod-postgres-1 psql -U weiban -d weiban -Atc \
   \"select schemaname||'.'||tablename from pg_tables order by 1;\""
# 容器与卷
ssh -i weiban_deploy root@103.231.58.124 \
  "docker inspect weiban-prod-app-1 --format '{{.HostConfig.ReadonlyRootfs}} {{.Config.User}}'"
```

### 8.2 关键源码位置（映射与加密的依据）

| 主题 | 文件 |
|---|---|
| 信封加密 / AAD | `apps/server/src/platform/crypto/envelope.ts` |
| 角色卡载荷与发布 AAD | `apps/server/src/modules/characters/application/characters.ts` |
| WB-Card 结构 | `packages/contracts/src/character-card.ts` |
| 分类/头像/发布校验 | `packages/contracts/src/http/characters.ts` |
| 消息内容类型 | `packages/contracts/src/http/chat.ts`（`MessageContent`） |
| 消息写入 AAD | `apps/server/src/modules/chat/application/write.ts` |
| 媒体对象与封装 | `apps/server/src/modules/media/application/media.ts` |
| 媒体用途/上限 | `packages/contracts/src/http/media.ts` |
| 现有 CMS 导入通道 | `apps/server/src/modules/model-access/application/legacy-receiver.ts`、`apps/server/src/cli/import-legacy-upstreams.ts` |
| 现有导出器 | `scripts/ops/export-legacy-upstreams.mjs` |
| 身份 CLI 与默认设置 | `apps/server/src/cli/identity.ts`、`apps/server/src/modules/identity/application/settings.ts` |
| 用户名/密码规则 | `packages/contracts/src/http/identity.ts`、`apps/server/src/modules/identity/infra/password-hasher.ts` |

### 8.3 明确未做的事

- 未执行任何迁移、导入、导出、`pg_dump` 恢复、`rsync`。
- 未写旧库（含未执行 `VACUUM`/`wal_checkpoint`/`.backup`）；未改旧库 0666 权限；未停旧服进程。
- 未写新库（未建表、未插行、未跑 `prepare`）。
- 未改任何代码、未切分支、未 push。
