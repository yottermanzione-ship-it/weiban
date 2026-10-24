# 语音/迁移现状交接（2026-10-24 17:00）

给接手的 Agent：先读这一页，再读 [迁移方案](2026-10-24-legacy-data-migration-plan.md) 与 [只读审查](../quality/2026-10-24-readonly-project-review.md)。

## 一、一句话现状

线上已发布到 `33480b0`（16:31），语音链路（MiMo TTS + 组合通话模型 + 密码兼容 + 后台批量/硬删）可用；**角色卡“旧卡直读”尚未开始实现**，677 个角色、1.7 万条世界书、3.5 万条示例对话都还没导入。

## 二、代码与线上版本

| 项目 | 值 |
|---|---|
| 分支 | `codex/voice-v02-v06-20261024` |
| 本地 HEAD | `bc579f8`（契约 3.39 + 删除提示词护栏）**未推送、未发布** |
| 远端分支 | `33480b0`（已推送） |
| 线上版本 | `33480b0`，契约 3.38，2026-10-24T08:31:07Z |
| 线上备份 | `/srv/weiban/backups/weiban-*`（发布脚本自动加密备份） |
| 发布方式 | `/srv/weiban/incoming-voice-20261024/{build.sh,publish.sh}`，服务器从 GitHub 取指定 SHA（scp 大文件会断） |

## 三、总经理已拍板的方向（重要，别再问）

1. **旧角色卡就是运行格式**：`characters_v2` 的字段结构直接在新服务器上跑，**不要转成 WeibanCardData，不要再提“新卡”**。之前 `bc579f8` 里“映射到新卡”的方向作废，只保留其中“删除平台护栏”的部分。
2. **提示词护栏全删**：`AUTHOR_GUARD` 与各处的“平台规则优先/以平台规则为准”已从运行时删除；policy、模型闸门、未成年/真人/成人校验这些**代码层拦截保留**（总经理原话：其他规则已拦截，不重复）。
3. **角色要能真删**：已完成（后台“彻底删除”，连带联系人/会话/消息/朋友圈，账单保留）。
4. **用户密码**：旧库 bcrypt 可登录，登录后自动升级 argon2id；登录不再限制最少 8 位（注册/改密仍 8 位）。
5. **用户数据**：553 个旧站账号 + `lomjy3`（重置为临时密码，总经理已知）= 554，外加 1 个管理员 `weiban_admin`；新站试注册账号已全部删除。
6. **头像**：角色头像是否迁移**尚未决定**（旧角色头像几乎全是真人照片，有肖像风险）。
7. **发布**：可以发布，走既有来源闸门 + 加密备份 + 回滚流程。

## 四、下一步要做的（按顺序）

1. **旧卡直读接线**（最优先）：把读角色卡的代码从“新卡字段”改为直接读旧字段，并逐条接通：
   - 私聊提示词：`core_persona`、`soul_personality`、`soul_emotional_tone`、`speaking_style`、`style_chat_style`、`style_emoji_level`、`style_avoid_json`
   - 世界书：`knowledge_json` + `character_lorebook_entries`（17,215 条）
   - 开场白：`opening_messages_json`
   - 群聊：`group_chat_json`
   - 朋友圈：`moment_profile_json`
   - 通话：`voice_json`、`qwen_voice_id`
   - 广场/搜索：`display_name`、`nickname`、`aliases_json`、`signature`、`identity_*`
   - 成长/熟悉度：`soul_relationship_mode`、`relationship_mode`
2. **导入角色**：677 条 `characters_v2` + 世界书 + 示例对话，JSON 原样入库（不转换）。导入前先跑干跑报告。
3. **角色头像决定**：不搬 / 原样搬 / 只搬非真人（旧库 `identity_type` 676 条为空，实际筛不出来，建议不搬）。
4. **克隆音色**：千问 `character_voice_bindings` 753 条、`user_character_voice_styles` 56 条导入；MiMo 走“每次带参考音频”。
5. **语音枚举补齐**：ASR 三条（`FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR`、MiMo ASR 需实现旧协议）；TTS 四条（MiMo 2.5、MiMo 克隆、Qwen 3.1 Flash、Qwen Pro）。
6. **百炼账号迁移**：官方公共端点 `8eed4824-…`，不用两个私有 workspace；迁移后配 TTS/克隆。
7. **实时通话**：`qwen-audio-3.0-realtime-plus`（私有 workspace `8d1b5e3b`）与 Omni 属开发项，未开始。
8. **积分与倍率**：联网搜索 `search_call` 目前 0.5 积分/次且未选为内部搜索；JEV 输出价为 0、`internal.planner` 为空；全部用户可选模型倍率为空。
9. **用户内容迁移**：联系人、私聊 29 万条、群聊 1.8 万条、朋友圈、记忆、媒体 4.37GB（已知 277 个引用文件缺失）。
10. **运维/安全**：备份与生产同盘无异地、SSH 允许 root+密码（已见 1.7 万次爆破）、全站 HTTP、`/api/v1/admin/*` 公网可达；发布全量重建，可优化为按改动重建。

## 五、必须知道的坑

- **两版契约不一致**：线上 3.38，本地 `bc579f8` 是 3.39。接手后先决定是否发布 `bc579f8`（它包含护栏删除）。
- **不要再走“映射到新卡”**：总经理明确否决，重复会被打回。
- **旧库数据是明文 SQLite**（1.59 GiB，113 表），媒体 4.37 GiB；只读导出，别写旧库。
- **密码哈希导出后必须删**：本次已从旧服、新服、本地清理，只留条数记录。
- **scp 大文件会断**：改用服务器 `git fetch` GitHub 的方式（本仓库已推送分支）。
- **发布脚本会全量重建**（约 6–8 分钟），不是故障。

## 六、关键路径

- 旧库：`ubuntu@152.136.111.51:/opt/weiban-server/weiban.db`（只读，`better-sqlite3` 在 `/opt/weiban-server/node_modules`）
- 新服：`root@103.231.58.124`，源码 `/srv/weiban/src`，发布目录 `/srv/weiban/releases/<sha>-web`
- 维护脚本：`/srv/weiban/incoming-voice-20261024/{build.sh,publish.sh}`；组合通话模型 CLI `node dist/voice-call-pipeline.js --show|--set`
- 证据：`C:/wb-dev/artifacts/voice-prod-20261024/evidence.json`、`docs/handoffs/2026-10-24-voice-e2e-acceptance.md`
