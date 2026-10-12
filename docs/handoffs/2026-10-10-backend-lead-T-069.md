# 交接说明：T-069 L5 后端——media 完整版、素材库、自定义表情、链接卡片与作品链接库

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-069-media`，`5930c30`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 自检 | 服务器 typecheck、build、根目录 lint（ESLint + dependency-cruiser）通过；按要求未写测试、未跑测试 |

## 做了什么

1. **media 完整版**：图片上传同时生成短边 360px 的缩略图（`MediaObject.thumbnailUrl`）；语音上传（multipart 表单字段 `durationMs`，按文件头识别真实格式，chat_voice 最长 60 秒 / 2 MB）；签名访问链接区分原图和缩略图；对象生命周期（超时上传回收、到期删除、删除失败重试），本机磁盘和 S3 共用。
2. **素材库**：表情包分类与表情（指定角色、用户可见、启停；添加时必须确认不含真人肖像并写审计）、音色库（名称含已录入真人预设角色姓名时 422；试听 / 关怀兜底文件校验用途）、卡面模板库、作品链接库与预设角色默认音色（后两者在 characters，按对照表）。管理端接口全部按契约。
3. **我的表情**：添加（从消息复制 / 从上传）、排序、删除、上限 300、重复添加 409；发 `data.changed(stickers)`；注销删除清单已登记（媒体对象 + 表情记录）。
4. **聊天四种消息**：存储与下发沿用 L1 同步机制（无需改动）；新增用户发送校验——图片 / 语音必须是本人的 chat_image / chat_voice，表情必须本人或库内可用，链接封面必须本人的 chat_image。
5. **链接工具**：`POST /links/preview`（每用户每分钟 20 次，封面转存）与 `LinkPreviewPort.preview`（AI 用的可访问性检查）；防内网访问（每跳检查解析地址、固定连接地址、限跳转 / 超时 / 大小）。作品链接保存后立即检查、之后每天检查。
6. 实现说明追加在 `docs/backend/media.md`。

## 改了哪些文件

- 迁移：`apps/server/drizzle/0040_media_l5(.down).sql`、`0041_media_assets(.down).sql`、`0042_character_work_links(.down).sql`、`meta/_journal.json`（0043 未用）
- media：`modules/media/{tokens.ts,index.ts,media.module.ts}`、`application/{media.ts,assets.ts,link-preview.ts}`、`http/{media.controller.ts,assets.controller.ts}`、`infra/db/schema.ts`
- characters：`application/work-links.ts`、`http/work-links.controller.ts`、`infra/db/schema.ts`、`tokens.ts`、`index.ts`、`characters.module.ts`
- chat：`application/write.ts`、`chat.module.ts`
- 装配：`apps/server/src/app.module.ts`（新增 `MediaCompositionModule`）
- 文档：`docs/backend/media.md`
- 契约未改，安卓生成物无需重生成。

## 遗留问题

- **任务卡与对照表范围不一致（已按对照表做，上报）**：卡的「可以改」只写了 media、chat，但对照表写明 `WorkLinkAdminEndpoints`（含 `setDefaultVoice`）在 characters 实现、`CharacterWorkLinkReadPort` / `CharacterVoiceReadPort` 由本卡提供，所以改了 characters 并用了迁移 0042。
- 音频不转码、不校验真实时长（服务器没有 ffmpeg），时长以客户端 / 生成方提供为准；文件头不对的直接拒绝。
- 链接预览的限流是进程内计数，多实例部署时每实例各算 20 次。
- 用户发的「转文字」：上传 chat_voice 后状态为 pending，需 ai-runtime（T-071）调用 `MediaTranscriptPort.setTranscript` 写入，否则一直 pending。
- 角色发送的图片 / 语音 / 表情不在 chat 做归属校验（由 ai-runtime 传入合法 mediaId）；T-064 提到的朋友圈角色图片归属校验同理未加，如需加可在 moments 用 `MEDIA_SYSTEM_PORT.canUse(ownerUserId, mediaId, ['generated_image'])`。
- 删除「我的表情」不删媒体对象（已发出的消息要能显示），这些对象只在注销时删除。
- S3 桶的「未完成分段上传清理」规则、真实云桶需部署时配置验证（待配置后验证）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-071、T-072）：从 `../../media/index.js` 注入令牌——`MEDIA_SYSTEM_PORT`（读字节识图 / 识别语音、`putObject` 存生成图 generated_image 与角色语音 generated_voice，ownerUserId 填用户）、`MEDIA_TRANSCRIPT_PORT`（写转写结果，自动发 `media.transcript_ready`）、`MEDIA_ASSET_READ_PORT`（`listStickersForCharacter`、`getVoice`）、`LINK_PREVIEW_PORT`（分享搜索结果前做可访问性检查，`reachable=false` 不得分享）。从 `../../characters/index.js` 注入 `CHARACTER_WORK_LINK_READ_PORT`（只返回启用且检查通过的链接，可用 `recordLinkCheck` 回写）、`CHARACTER_VOICE_READ_PORT`（预设默认音色）。音色停用后 `getVoice().enabled=false`，请退回默认音色。
- 给 Web（T-073）/ 安卓（T-074）：上传语音用 multipart 字段 `file` + 表单字段 `durationMs`（整数毫秒）；`thumbnailUrl` 小图时等于 `url`；添加表情重复时 409 `conflict`（「已经添加过了」），满 300 时 422 `limit_reached`；`POST /links/preview` 返回 200；管理员上传素材用 `POST /admin/media?purpose=sticker_library|voice_sample|card_template|pet_art|character_avatar`，再调各素材接口登记。
- 给 T-070（通话）：关怀兜底音频通过 `MEDIA_ASSET_READ_PORT.getVoice().careFallbackMediaId` 取，再用 `MEDIA_SYSTEM_PORT.readBytes`。
- 给 T-076（卡片）：`MEDIA_ASSET_READ_PORT.listCardTemplates(kind, portraitFreeOnly)`，真人角色传 `portraitFreeOnly=true`。
- 给 T-077（宠物）：图鉴图片由管理员以 `pet_art` 上传（平台所有，所有人可读），宠物照片用 `putObject({purpose:'pet_photo' 或 'generated_image', ownerUserId})`。
- 给 T-080（注销）：media 的 `purgeUser` 已覆盖本人所有媒体对象（含缩略图）和「我的表情」；characters 的作品链接、默认音色是平台数据，不随用户删除。
- 给 T-087（广场）：`MEDIA_SYSTEM_PORT.copyObject({mediaId, ownerUserId:null, purpose:'plaza_avatar'})`，作品删除时 `deleteObject`。
- 给总负责人：请把「遗留问题」第 1 条转架构确认；迁移 0043 未使用，可回收。
