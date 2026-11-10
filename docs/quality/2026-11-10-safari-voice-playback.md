# 苹果浏览器语音显示“重试”：调查及开发自测

## 结论与范围

经理指定用户、角色张函瑞及今天上午；随后确认手机系统为 iOS 18.1。已唯一定位账号，调查只处理状态、时间、模型、文件大小/存在性及固定客户端错误类别，未读取聊天正文、转写或解密/收听真实音频。基线及开工线上为 `0a484f006f2b3883d32b0af38f98f4fcab4ae84e`。

Q-071：旧 Apple WebKit 不支持 Ogg 音频，而角色语音当前保存为 Ogg/Opus；客户端播放失败统一把时长换成“重试”。这是播放兼容缺口，非本次模型合成失败。

## 生产证据

- 北京时间 08:54、09:02 的两次张函瑞语音合成均成功，语音消息正常写入；对应两个媒体对象 ready、未设过期、加密文件存在，明文长度元数据分别852和16092字节。
- 今天同角色四次合成记录实际为 `qwen-audio-3.0-tts-plus`。账号全局语音选择是 `xiaomi/mimo-v2.5-tts`，当前张函瑞单独选择前者；不擅自改动用户模型选择，不把模型选择差异当作播放失败原因。
- 客户端记录为 iOS / Safari 18，经理进一步确认18.1。09:18另有一次媒体请求网络失败，同时多个其他接口失败；这是额外的网络现象，不能替代已经确认的音频格式缺口，也不能据此断言每次重试都只有一个原因。
- Apple官方说明：Ogg Opus/Vorbis容器支持从 Safari/iOS 18.4加入；MP3为各平台支持的兼容格式。来源：[WebKit 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/#media)、[Safari媒体指南](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/Introduction/Introduction.html)。

## 修复

仅修改已签名媒体下载的播放响应：先沿用原到期、签名和归属检查，再为iOS浏览器/主屏幕网页及桌面Safari将Ogg转为MP3。其他浏览器继续取得原文件，已有与新发语音均适用；不重新合成、不改音色配置、不再次扣费、不修改消息或加密原文件。无数据库迁移、契约字段或安卓包改动，契约仍7.10。

转码复用生产镜像已有ffmpeg；只通过内存管道输入/输出，限定Ogg输入及pipe协议，不访问模型或网络、不写临时音频、不打印诊断正文；限制输入10MB、输出6MB、诊断64KB、处理12秒及最多两个并发。下载响应采用实际Content-Type/Content-Length，Vary追加User-Agent，保持private,no-store。较新Apple浏览器也采用同一兼容响应。

同时补齐音频HTTP Range：Apple官方要求媒体服务器支持字节分段读取，原下载控制器始终返回完整200响应。现在使用Express已有范围解析，单段返回206及转换后字节对应的Content-Range，越界416，无Range正常200；不支持的多段/格式不正确请求忽略Range并返回完整内容，权限仍最先检查。该协议缺口由源码确认，未把它冒充成已抓到的手机原始请求。来源：[Apple服务器配置说明](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html)。

## 开发自测

- 独立测试库 `weiban_test_codex_safari_voice_1110`，媒体签名/归属/真实HTTP分段检查7项和新增兼容/响应7项，共14项通过；代码规则和服务器类型检查通过。覆盖首两字节、尾段、完整读取、越界、无效/多段请求、跨用户及过期链接；转换后长度另有用例验证。
- 首轮发现新增错误码拼写不符合现有契约，已使用现有service_unavailable并复核6项新用例；未新增错误类型或放宽接口检查。
- 本机旧应用镜像没有ffmpeg，未把它当作生产结果；建立独立Linux音频检查容器，使用项目实际兼容转换函数及真实ffmpeg。两秒虚构正弦音从Ogg/Opus转换为MP3并再次解码成功，解码长度2.064秒（包含编码填充），有效音频能量、原格式保留及重复转换字节一致性通过（保证分段读取稳定）。候选生产镜像也确认含libmp3lame/libopus编码器。无真实用户音频，无上游费用。
- 真实iOS18.1手机播放仍待用户复核；不能以模拟浏览器标识或本机解码代替真机通过。本记录属于开发自测，不自签独立验收关闭。

## 发布与亲测

发布前执行来源门禁并等待既有完整检查通过。上线回执登记到本次合并请求及服务器发布清单。

经理亲测：让该用户回到张函瑞聊天，直接点今天上午原来显示“重试”的语音。能听到声音、播放进度结束且不新增扣费记录算正常；不要求再次生成或付款。若还有失败，记录发生时间即可，不提供聊天内容。
