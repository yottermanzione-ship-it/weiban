# 旧卡角色头像 / 音色导入（2026-10-24）

- 分支：`codex/voice-v02-v06-20261024`，基于线上 `22f2cf1`（677 个旧角色已用 `legacy_card` 原样入库）。
- 本批只提交代码，**未发布、未 push、未写生产库/生产媒体**。生产库仅做过只读查询；真实写入测试使用新服 dryrun 容器里临时创建的 `weiban_test_codex` 库，测完可删。
- 结论：头像 **677/677 可导入**；音色 **351/677 可映射**（176 条来自 `qwen_voice_id`，175 条来自旧 `character_voice_bindings` 兜底），**326 条缺供应商音色 key**。音色当前即使登记也不会出声，因为新库目录里还没有 `qwen-audio-3.0-tts-plus` 模型（见 §6）。

## 1. 只读盘点（旧库 `characters_v2`，677 行）

### 1.1 头像

| 项目 | 实测 |
|---|---|
| `avatar_url` 形态 | 677 条全部本地 `/generated/avatars/...`；HTTP 0、空 0、其他 0 |
| 文件存在性 | 677/677 存在（0 缺失） |
| 格式（按文件头） | JPEG 676、PNG 1；扩展名 `.jpg` 675、`.jfif` 1（实际 JPEG）、`.png` 1 |
| 大小 | 总计 67,201,436 B（64.1 MiB）；最大 3,714,874 B；无 >5 MB |
| 大小分布 | <10 KB 14；10–50 KB 327；50–200 KB 260；200 KB–1 MB 72；1–5 MB 4 |
| 唯一 URL | 677 个（无重复） |

结论：按本 CLI 的 5 MB / PNG-JPEG-WebP 规则，**可导入 677、文件缺失 0、格式不支持 0、超大 0**。旧站头像是 AI 模仿图、不是真人照片，总经理 2026-10-24 已明确可直接导入。

### 1.2 音色

| 项目 | 实测 |
|---|---|
| `voice_json` | 677/677 非空字符串，69 种结构，长度 245–512；`provider` / `primary_provider` 均为 `qwen`；`clone_status` 均为 `not_cloned` |
| `qwen_voice_id` 非空 | **176**（形如 `qwen-audio-3.0-tts-plus-wb-<32hex>`） |
| `voice_json.qwen_voice_id` 非空 | 12（其中 175 条与顶层不同/为空，字段未同步） |
| `voice_json.voice_id` 非空 | 1（`huangjingyu_male`） |
| `mimo_voice_sample_path/url` 非空 | 488；488/488 文件存在；486 MP3、2 WAV；总计 123,837,452 B；最大 3,736,854 B |
| `character_voice_bindings` | 753 行 / 351 个角色，全部 `status=ready`；qwen TTS-plus 351、qwen audio realtime 228、qwen3.5 omni realtime 174 |
| 顶层 qwen id 与 qwen TTS 绑定 | 176/176 能对上，0 条有顶层 id 却没有 qwen TTS 绑定 |
| 只有 qwen TTS 绑定、没有顶层 id | 175 个角色（旧迁移只回填了部分角色，字段不一致） |
| 488 个样本的归属 | 351 个有 qwen TTS 绑定；137 个只有 MiMo 样本、没有 qwen 音色 key |

盘点结论与映射口径：

- **351 可映射**：优先取顶层 `qwen_voice_id`（176），否则取 `voice_json.qwen_voice_id/qwenVoiceId/voice_id/...`，再否则取 `character_voice_bindings` 里 `provider=qwen AND model=qwen-audio-3.0-tts-plus AND status=ready` 的 `voice_id`（175）。
- **326 不可映射**：全部是 `no_voice_key`；其中 189 个既无 key 也无样本，137 个只有 MiMo 样本但无 qwen key。`clone_sample_missing=0`、`provider_retired=0`、`realtime_only=0`、`unsupported_provider=0`（按本批数据实测）。
- 228 条 qwen audio realtime / 174 条 omni realtime 只用于实时通话，不能当一次性 TTS 音色；351 个 TTS 角色都另有 TTS-plus 绑定，所以不影响映射数。

## 2. 头像导入 CLI

文件：`apps/server/src/cli/import-legacy-character-avatars.ts`（构建入口同名）。

```bash
# dry-run：只读库、只检查文件/URL，不打开 KEK/存储
node dist/import-legacy-character-avatars.js \
  --input /srv/weiban/import/characters/avatars.json

# apply：写 media.objects + characters.avatar_media_id
node dist/import-legacy-character-avatars.js \
  --input /srv/weiban/import/characters/avatars.json \
  --apply --operator-id <ACTIVE_ADMIN_UUID> \
  --allow-host 152.136.111.51 \
  --report /srv/weiban/import/characters/avatars-report.json
```

输入 JSON：

```json
{
  "version": 1,
  "allowHosts": ["152.136.111.51"],
  "avatars": {
    "<characters.characters.id>": "/srv/weiban/import/avatars/xxx.jpg",
    "<id2>": "https://152.136.111.51/generated/avatars/yyy.jpg"
  }
}
```

- 本地路径必须绝对路径；拒绝符号链接 / 硬链接（复用表情导入的 `assertNoLinks` / `readCheckedFile`）。
- 只接受 PNG/JPEG/WebP（按文件头，不信任扩展名），≤5 MB。
- URL 只允许 `allowHosts` + `--allow-host` 中的主机；手动处理 301/302/303/307/308，**每一跳都校验**，最多 3 跳；不跟随到白名单外；流式读取超 5 MB 立即中止。
- 幂等：已有 `avatar_media_id` 的角色跳过；`--batch-size` 默认 50；每条输出进度 JSON 行，可中断后重跑。
- dry-run 不打开 KEK/存储；apply 才要求 `PLATFORM_KEK_FILE`、媒体存储配置和 active admin。

写入：

| 表 / 列 | 内容 |
|---|---|
| `media.objects` | `purpose=character_avatar`、`owner_id=NULL`（平台所有）、加密落盘、`state=ready`、WebP + 缩略图（短边 >360 时） |
| `characters.characters.avatar_media_id` | 新增列，绑定上述对象；只写仍为空的行 |
| `platform.audit_log` | `legacy_avatar_import.started/finished` 与每批 `batch_finished` |

资料页/后台读取：`characters.ts` 的旧卡 `legacyProfile` / `legacyAdmin` 已改为读取 `avatar_media_id`，通过既有 `MediaReadPort.getMedia` 生成 5 分钟签名 URL；媒体缺失或无图时回退到原来的默认绘制头像。

## 3. 音色导入 CLI

文件：`apps/server/src/cli/import-legacy-character-voices.ts`。

```bash
# dry-run：只读库 + 只读 media.voices，逐条报告
node dist/import-legacy-character-voices.js \
  --input /srv/weiban/import/characters/voices.json \
  --sample-root /srv/weiban/import/voice-samples

# apply：写 media.voices + characters.default_voices
node dist/import-legacy-character-voices.js \
  --input /srv/weiban/import/characters/voices.json \
  --sample-root /srv/weiban/import/voice-samples \
  --apply --operator-id <ACTIVE_ADMIN_UUID> \
  --report /srv/weiban/import/characters/voices-report.json
```

输入 JSON（旧库整行，字段名保持 snake_case；bindings 可选）：

```json
{
  "version": 1,
  "characters": [ { "id": "...", "display_name": "...", "voice_json": "...", "qwen_voice_id": "...", "mimo_voice_sample_path": "...", "mimo_voice_sample_url": "..." } ],
  "bindings": [ { "character_id": "...", "provider": "qwen", "voice_id": "...", "model": "qwen-audio-3.0-tts-plus", "status": "ready" } ]
}
```

映射与写库：

- 候选顺序：`qwen_voice_id` → `voice_json` 里的 qwen 字段 → `character_voice_bindings` 里 ready 的 qwen TTS-plus 绑定。
- `qwen-audio-3.0-tts-flash-*` 视为旧站已退役（`provider_retired`）；realtime / omni 键视为只能通话（`realtime_only`）；MiMo 克隆必须提供样本（`clone_sample_missing`）。
- `media.voices` 幂等键是 `(model_key, provider_voice_key)`：已有同键音色复用；若该音色被停用则报告 `existing_voice_disabled`，不把角色绑到无声资产。
- 每角色只写一条 `characters.default_voices`；已有同音色 = `already_bound`，已有不同音色 = `bind_conflict` 不覆盖。
- `--sample-root` 把旧绝对路径/URL 的 basename 映射到新机样本目录；本批只校验样本存在，不上传样本音频（`sample_media_id` 暂为 NULL）。
- 每条角色输出状态 JSON 行；无法映射的原因逐条进 `issues`，不静默跳过。

写入：

| 表 | 内容 |
|---|---|
| `media.voices` | `name=旧卡音色 <key 后 12 位>`、`tags=['legacy']` 或 `['legacy','clone']`、`provider_voice_key`、`model_key=qwen-audio-3.0-tts-plus`、`enabled=true` |
| `characters.default_voices` | `(character_id, voice_id, updated_at)`，每角色一条 |
| `platform.audit_log` | `legacy_voice_import.started/finished` |

## 4. 迁移 0137

`apps/server/drizzle/0137_character_avatar_media.sql`（已登记 `meta/_journal.json`）：

```sql
ALTER TABLE characters.characters ADD COLUMN avatar_media_id uuid;
COMMENT ON COLUMN ...;
CREATE INDEX characters_avatar_media_idx ON characters.characters(avatar_media_id)
  WHERE avatar_media_id IS NOT NULL;
```

回滚 `.down.sql` 先删索引再删列；已在临时测试库实测 down/up 后列可正常恢复。生产当前 `latestMigration=0136`，**apply 前必须先执行 0137**（发布或单独 `db:migrate`）。

## 5. 测试结果

| 检查 | 结果 |
|---|---|
| `pnpm --filter @weiban/server typecheck` | 通过 |
| `pnpm --filter @weiban/server build` | 通过；生成两个新 CLI bundle |
| 新增 dry-run 单测（头像 6 / 音色 10） | **16/16 通过**：计数、已存在跳过、缺失文件、格式、超大、URL 白名单/跳转、缺 key、flash 退役、realtime、克隆样本缺失、已有音色停用、modelNotRegistered |
| 真实 PG 写入测试 `test/legacy-character-media-import.test.ts` | **2/2 通过**（新服 dryrun 容器临时库 `weiban_test_codex`，SSH 隧道）：头像写 `media.objects` + `avatar_media_id`，音色写 `media.voices` + `default_voices`，重跑幂等 |
| `test/migrations.test.ts` | 4 通过；2 个完整 up/down 用例在远程隧道下 30s/120s 超时（环境延迟，不是断言失败）；0137 已由 reset 执行验证，并单独手工验证 down/up |
| ESLint（改动文件） | 通过 |
| Prettier（改动 TS/JSON/MJS） | 通过（SQL 不在 Prettier 支持范围） |
| CLI 实跑 dry-run | 头像：已有 1 / 缺失文件 1；音色：mapped 1 / reuse 1 / modelNotRegistered=`qwen-audio-3.0-tts-plus` |
| CLI 实跑 apply | 头像：1 条真实 PNG 加密入库 + 绑定，重跑 `already_has_avatar`；音色：1 条绑定，重跑 `already_bound`；两者 audit 均写入 |
| 真实盘点输入回放 | 用旧库 677 行 + 753 条 bindings 实跑规划：mapped 351（qwen_voice_id 176 + binding 175）、unmapped 326（全部 no_voice_key）、cloneSampleMissing 0 |

## 6. 真实导入前主代理要准备的事

1. **先上 0137**：生产库当前没有 `avatar_media_id`；不迁移直接 `--apply` 会报列不存在。
2. **确认 Qwen TTS 已在新库可用（最关键）**：生产 `model_access.model_catalog` 目前只有 `xiaomi/mimo-v2.5-tts`、`xiaomi/mimo-v2.6-flash-voice`、`siliconflow/sensevoice-small`、`voice/cascade-call`，**没有 `qwen-audio-3.0-tts-plus`**。本 CLI 会把 351 条音色登记好并绑定，但网关 `resolve('speech_synthesis','qwen-audio-3.0-tts-plus')` 会返回 `model_unavailable`，仍然不出声。需要先完成百炼 TTS 上架（上游账号、model_catalog、价格/场景）。
3. **确认旧克隆音色能在新百炼账号/workspace 使用**：旧 `qwen_voice_id` 是旧 workspace 里的克隆音色 id（`...-wb-...`），跨账号通常不可用。要么迁同一 workspace/账号，要么在新账号重新克隆；否则登记成功也不会合成。这是音色能否真正出声的第二道闸门。
4. **准备两批输入和文件**：
   - 头像：677 个文件，67,201,436 B；建议 `tar` 后放 `/srv/weiban/import/avatars`，生成 `avatars.json`（角色 id → 绝对路径）。
   - 音色：677 行 JSON（约 639 KB；可用旧库 `SELECT` 导出）+ 753 行 bindings；488 个样本 123,837,452 B 放 `/srv/weiban/import/voice-samples`（本批只校验，不需要上传，但后续 MiMo 克隆会用到）。
5. **准备运维条件**：active admin uuid；DB + 媒体备份；在 app 容器内/带 `DATABASE_URL`、`PLATFORM_KEK_FILE`、`MEDIA_*` 环境执行；头像 apply 需要 KEK/存储，音色 apply 不需要 KEK。
6. **决定 326 个不可映射角色**：137 个只有 MiMo 样本、189 个无 key。如果要做 MiMo 克隆，还需要实现“每次带参考音频”的合成路径；本批不伪造这条能力。
7. 头像授权口径已由总经理确认（AI 模仿、非真人），CLI 不再做肖像审核；如后续要上架真人角色，仍按平台分类/portraitPolicy 规则处理。

## 7. 未做 / 边界

- 未上传音色样本音频，`media.voices.sample_media_id` 为 NULL；后台试听暂时没有样本。
- 未导入 `character_voice_bindings` 的 228 条 realtime / 174 条 omni 绑定（新库没有 per-endpoint 结构，且不能用于一次性 TTS）。
- 未导入 56 条 `user_character_voice_styles`（用户风格偏好，新库无对应列）。
- 未改旧 `legacy_card` 原文；头像和音色都是新列/新表绑定。
- 未发布、未 push；生产库、生产媒体零写入。
