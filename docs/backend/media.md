# media 最小版（D-L0-07）

上传接口按 `MediaEndpoints` 和 `MediaAdminEndpoints`：multipart字段 `file`，用途由查询参数指定。用户头像/通讯录头像本人可见；管理员预设头像为平台素材，登录用户全员可见，上传写审计。`MEDIA_READ_PORT.getMedia`供其他模块验证头像归属并取得临时链接。

接收JPEG/PNG/WebP/GIF，最多10MB；服务端解码确认真实格式，限制4000万解码像素，去EXIF/GPS并重新编码WebP（支持动图），不使用客户端文件名。文件本体用户DEK信封加密；平台头像用平台DEK。元数据不存签名访问令牌。

下载入口 `/api/v1/media/:mediaId/content?token=...`：5分钟平台加密访问凭证，绑定媒体ID、发起用户和过期时刻；下载重新验证元数据存在和归属。响应 `private,no-store`、`nosniff`。请求日志不记录查询参数。删除元数据后旧链接立即失效。

存储：`MEDIA_STORAGE=disk`（默认），目录 `MEDIA_DISK_ROOT`（默认`.data/media`）；`s3`使用AWS签名私有桶，不开放桶匿名读取。设置 `MEDIA_S3_BUCKET`、`MEDIA_S3_REGION`、`MEDIA_S3_ENDPOINT`（可选）、`MEDIA_S3_CREDENTIALS_FILE`（JSON含accessKeyId/secretAccessKey）、`MEDIA_S3_FORCE_PATH_STYLE`。凭据不从接口或日志输出。`MEDIA_PUBLIC_BASE_URL`设为客户端访问服务器的HTTPS地址；开发默认http://127.0.0.1:3000。

上传先登记pending再写加密对象，最后ready；失败清理；存储失败不丢掉注销清理位置。每10分钟回收超过10分钟的pending对象。注销删除本人的对象与元数据，可重复；预设角色头像属于平台，不随上传管理员注销删除。

迁移0007与对应down。后续L5扩展缩略图、语音、表情包、对象生命周期和素材库；S3兼容协议用本地HTTP替身验证，真实云桶及生产域名需要部署时验证。

# media 完整版与素材库（T-069，L5）

**迁移**：0040（objects 加缩略图、时长、转写、内容摘要、到期时间；宽高可空）、0041（sticker_packs、library_stickers、user_stickers、voices、card_templates）、0042（characters.work_links、characters.default_voices）。

**上传**：`POST /media` 与 `POST /admin/media` 接受 multipart 字段 `file` 和可选表单字段 `durationMs`。图片照旧重编码为 WebP，短边大于 360px 时另存一份缩略图（同样加密）；`MediaObject.thumbnailUrl` 指向缩略图，小图直接等于原图链接。音频（chat_voice、generated_voice、voice_sample）按文件头识别真实格式，chat_voice 必须带时长、最长 60 秒、最大 2 MB；素材音频最长 5 分钟、最大 10 MB。音频不转码（服务器没有 ffmpeg）。素材库用途（character_avatar、sticker_library、voice_sample、card_template、pet_art）只能管理员上传，所有者为平台，全体登录用户可读；上传写审计 `asset.uploaded`。

**访问链接**：仍是 5 分钟加密凭证；凭证里带 `v`（o 原文件 / t 缩略图），同一个下载地址按凭证返回原图或缩略图。

**生命周期**：每 10 分钟回收超时的 pending 上传；每小时 `media.lifecycle` 删除 `expires_at` 已到的对象，并重试删除中途失败（state = deleting）的对象。`deleteObject` 先标记 deleting，存储删除失败留给生命周期任务，不会丢清理位置。本机磁盘和 S3 两种实现走同一套逻辑；S3 桶本身建议另配「未完成分段上传 7 天清理」规则（部署时做）。

**系统端口**（`index.ts` 导出令牌）：`MEDIA_SYSTEM_PORT`（canUse / readBytes / putObject / copyObject / deleteObject）、`MEDIA_TRANSCRIPT_PORT`、`MEDIA_ASSET_READ_PORT`、`LINK_PREVIEW_PORT`、`MEDIA_STICKER_CHECK`（chat 发送校验）。转写文字用媒体所有者的密钥加密；`setTranscript` 在同一事务里发 `media.transcript_ready`。

**素材库**：表情包分类（指定角色，空 = 全部角色；用户可见；启停）、表情（添加时 `confirmNoRealPersonPortrait` 必须为 true，审计记录确认人；删除为软删除，已发消息仍能显示）；音色（名称经归一化后包含任一已录入真人预设角色姓名即 422 bad_request；试听与关怀兜底文件必须是 voice_sample）；卡面模板（文件必须是 card_template）。

**我的表情**：上限 300（422 limit_reached，details.limit）；同一张图（按重编码后内容的 SHA-256）重复添加返回 409 conflict「已经添加过了」；从消息添加会复制一份为本人的 user_sticker（对方删除或注销不影响）；新添加的排第一；增删改发 `data.changed(stickers)`。删除表情不删媒体对象（已发出的消息仍能显示），注销时随用户全部删除。

**链接预览**：`POST /links/preview` 每用户每分钟 20 次（进程内计数）；只访问 http(s) 公网地址、80/443 端口，每一跳都解析域名并检查全部地址，连接固定到已检查地址；最多 3 次跳转、6 秒超时、页面读 512 KB。封面转存为本人的 chat_image。`LinkPreviewPort.preview` 供 AI 做可访问性检查（不转存封面）。

**作品链接库与默认音色**（数据在 characters）：管理端接口按 `WorkLinkAdminEndpoints`；保存或改网址后立即检查一次，之后每天 04:40 检查全部启用链接；`CharacterWorkLinkReadPort.listUsableWorkLinks` 只返回启用且最近检查通过的。

**chat 发送校验**：用户发 image / voice 时媒体必须是本人的 chat_image / chat_voice；sticker 必须是本人表情或启用且用户可见的库内表情（mediaId 对应）；link 的封面必须是本人的 chat_image。角色发送的媒体由 ai-runtime 保证。

**注销**：删除本人所有媒体对象（含缩略图）和「我的表情」记录；`countUserData` 两者合计。
