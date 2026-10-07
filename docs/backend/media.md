# media 最小版（D-L0-07）

上传接口按 `MediaEndpoints` 和 `MediaAdminEndpoints`：multipart字段 `file`，用途由查询参数指定。用户头像/通讯录头像本人可见；管理员预设头像为平台素材，登录用户全员可见，上传写审计。`MEDIA_READ_PORT.getMedia`供其他模块验证头像归属并取得临时链接。

接收JPEG/PNG/WebP/GIF，最多10MB；服务端解码确认真实格式，限制4000万解码像素，去EXIF/GPS并重新编码WebP（支持动图），不使用客户端文件名。文件本体用户DEK信封加密；平台头像用平台DEK。元数据不存签名访问令牌。

下载入口 `/api/v1/media/:mediaId/content?token=...`：5分钟平台加密访问凭证，绑定媒体ID、发起用户和过期时刻；下载重新验证元数据存在和归属。响应 `private,no-store`、`nosniff`。请求日志不记录查询参数。删除元数据后旧链接立即失效。

存储：`MEDIA_STORAGE=disk`（默认），目录 `MEDIA_DISK_ROOT`（默认`.data/media`）；`s3`使用AWS签名私有桶，不开放桶匿名读取。设置 `MEDIA_S3_BUCKET`、`MEDIA_S3_REGION`、`MEDIA_S3_ENDPOINT`（可选）、`MEDIA_S3_CREDENTIALS_FILE`（JSON含accessKeyId/secretAccessKey）、`MEDIA_S3_FORCE_PATH_STYLE`。凭据不从接口或日志输出。`MEDIA_PUBLIC_BASE_URL`设为客户端访问服务器的HTTPS地址；开发默认http://127.0.0.1:3000。

上传先登记pending再写加密对象，最后ready；失败清理；存储失败不丢掉注销清理位置。每10分钟回收超过10分钟的pending对象。注销删除本人的对象与元数据，可重复；预设角色头像属于平台，不随上传管理员注销删除。

迁移0007与对应down。后续L5扩展缩略图、语音、表情包、对象生命周期和素材库；S3兼容协议用本地HTTP替身验证，真实云桶及生产域名需要部署时验证。
