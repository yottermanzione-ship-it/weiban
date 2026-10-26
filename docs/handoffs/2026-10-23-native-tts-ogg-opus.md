# 语音消息格式补齐：原生TTS转真正的Ogg/Opus

2026-10-23 21:38（北京时间）发布。开发自测与运维回执，不是独立验收，不构建APK。

## 结果

原生MiMo/百炼合成过去只能给WAV或PCM，语音消息请求的`ogg_opus`被直接拒绝。本批在取得编码租约后，把供应商返回的24kHz单声道PCM交给系统FFmpeg/libopus编码成真正的Ogg/Opus，不再拿WAV改MIME冒充。

生产环境实际核对：容器内以非root用户运行、`/usr/bin/ffmpeg`可执行、libopus编码器存在。

## 实际验证（不是只查文件头）

在**发布所用的同一Linux镜像**内、断网条件下，用生产模块本身编码一段0.5秒合成PCM：

| 项目 | 实测 |
|---|---|
| PCM输入 | 24,000字节（24kHz单声道16位） |
| 产出 | 1,950字节Ogg |
| ffprobe识别 | `codec_name=opus`、`format_name=ogg`、单声道、时长0.5065秒 |
| 解码回PCM | 正好24,000字节 |
| FFmpeg版本 | 5.1.9-0+deb12u1，libopus可用 |

这证明容器、封装、编码、解码往返都对，而不只是"开头有OggS"。仍未验证的是真实供应商音色、真实用户发送/播放、供应商实际用量与账单。

## 实现要点

- [native-opus.ts](../../apps/server/src/modules/model-access/infra/native-opus.ts)：固定`/usr/bin/ffmpeg`与固定参数，`shell:false`，全程管道，无临时文件，不接受用户文本/URL/文件名作参数，仅启用pipe协议、去掉元数据。
- 编码前先取租约，最多2个并发；无编码器返回本地失败且**不先向供应商发可能计费的请求**；饱和时回报本地限流，不冒充供应商限流。
- 输入仅接受非空、偶数字节、≤12MB的PCM；输出≤10MB、stderr只计数丢弃≤64KiB、15秒超时，异常一律杀进程并销毁管道，错误码固定且不夹带上游原文。
- 供应商已成功后编码失败，明确返回失败，不谎称免费、不自动重试、不换用户模型。
- [媒体适配器](../../apps/server/src/modules/model-access/infra/media-adapter.ts)只在原生模型收到`ogg_opus`时走这条路径，WAV/PCM与通话流式路径不变；[生产镜像](../../deploy/prod/Dockerfile)增加Debian ffmpeg包并保留非root、只读根目录。
- 方案与取舍记录在[ADR](<../decisions/ADR-20261023-native-tts-opus.md>)，未新增HTTP契约、未改价目或用户模型选择。

## 检查与边界

- server类型检查通过；相关测试集合 **63/63通过**（编码器30、适配器路由7、MiMo 7、百炼5、音频下载14）。
- 首轮相关测试1条失败，原因是测试对12MB数组做了逐元素深比较导致超时，改为引用比较后**只复测一次**通过；产品代码未因该失败改动。
- 首轮容器验证失败是**验证脚本自身**的Bug（对Uint8Array调用writeInt16LE），改用Buffer后重跑通过；不算产品缺陷。
- 没有真实凭据、没有调用付费供应商、没有做真人克隆；OGG仅覆盖原生合成路径。

## 发布回执

- 源码`fc76c5c2edd0aa65005fb198b66d5273e29495b2`，`2026-10-23T13:38:05Z`（北京21:38）。
- 本地优先来源闸门通过，包含本地main/trunk、最近已知origin/main、共享集成头及实时线上`159f01f...`；候选2763个Git对象逐项校验，未覆盖共享工作区。
- 加密备份`/srv/weiban/backups/weiban-20261023T133747Z-9rZIOb`，DB与媒体age包均校验OK；状态`/srv/weiban/backups/release-state-20261023T133747Z`。
- App `sha256:ed2751ffc4517c323e48c38d18f73ed600dcc43fa3bffdd56b69a8e4153a60f3`；Edge `sha256:d1601d96b5b6bcc0620fb48be8a51967585e9b61c7d6fbf9173061ab7d344f1e`。
- 回退镜像`weiban-app:before-20261023T133747Z`及edge同名保留，上一来源目录可追溯。
- 契约3.37、迁移仍为0135_client_logs、无待执行迁移；前后台健康、加密配置正常。
- 正式库核对未变：商店21系列/351张，生态`decision_model=NONE`（仍暂停）。
- 构建前磁盘仅剩2.57GB，只清理了构建缓存与悬空镜像（保留全部28个带标签的回退镜像），恢复至约6.0GB后发布。

## 仍未完成

真实供应商短音频、音色对应与账单；用户登录后完整发送/播放验收；**原生低延迟流式与打断（当前是把完整音频切块）**；实时通话/Omni；ASR逐厂商协议；克隆授权流程。均在[完整需求与进度清单](2026-10-23-all-requirements-ledger.md)保留。
