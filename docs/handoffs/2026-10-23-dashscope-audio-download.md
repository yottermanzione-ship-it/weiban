# 百炼语音：音频下载安全与正向返回补齐

2026-10-23，用户既有“先不迁凭据，继续语音协议/计费适配”范围内的一次小补丁；不改生态、用户模型/价格或HTTP契约，不调用真实供应商，不构建APK。

## 本批结论

本地实现与相关检查已完成，发布状态见后续回执。不能把本补丁当作“百炼语音、通话、Omni、真实音色及账单全部可用”。

## 解决的具体问题

原生百炼合成先POST生成音频，再取返回的audio.url。原实现仅看域名后缀和HTTPS，然后普通fetch；没有把DNS检查结果固定到连接。旧测试标题声称成功下载音频，实际只是断言本机URL被拒绝，没有正向音频字节证据。本批纠正标题/说明并补真正的离线正向链路。

- 新的[下载器](../../apps/server/src/modules/model-access/infra/dashscope-audio.ts)仅接受HTTPS官方子域，拒绝用户信息、非443端口、片段及误导后缀。
- 仅解析A记录，拒绝私网、环回、元数据、CGNAT、文档/保留地址以及混合公共/私有结果，再将连接固定到已检查的公共IPv4地址；保留原域名的TLS证书检查。IPv6-only明确拒绝，不以更宽松fetch兜底。
- 不跟随重定向；无Cookie，不转发合成API的Authorization或密钥；音频单次下载DNS/正文共享30秒时限，声明和流式正文均限制12MB。
- 对CDN的401/403统一记为provider_error，不误认“供应商API Key无效”；POST可能已被计费，不标zeroCost、不自动重试、不输出签名URL。
- 返回音频先检查RIFF/WAVE标识；需要PCM时继续沿用24kHz/单声道/16位解析。不是新增重采样、OGG封装或完整音频解码器。
- [原生适配器](../../apps/server/src/modules/model-access/infra/media-adapter.ts)复用此下载器；合成POST格式、用户选择、售价及计费单位均未改变，MiMo与其他协议保留原路由。

## 必要检查及真实边界

- 首轮类型检查发现Node HTTPS RequestOptions类型不接受autoSelectFamily字段，测试未执行；仅修正为显式family=4（禁止双栈自动选择），复查一次后类型通过。
- 只执行一次实际相关测试集合：[下载器14条](../../apps/server/src/modules/model-access/infra/dashscope-audio.test.ts)、[百炼协议5条](../../apps/server/src/modules/model-access/infra/dashscope-tts-adapter.test.ts)、[MiMo协议7条](../../apps/server/src/modules/model-access/infra/mimo-tts-adapter.test.ts)，**26/26通过**；成功即停。
- 正向测试包含WAV真实字节返回、24kHz PCM的9600字节/200ms、DNS固定与无密钥、私有/混合地址拒绝、重定向拒绝、字节上限、DNS超时、假WAV拒绝及失败不重试。
- 新14条使用合成音频和模拟DNS/HTTPS传输，旧协议测试使用本地合成HTTP；没有连接真实CDN或供应商，也不把传输选项断言当作真实公网TLS验收。
- 没跑全仓、没有真实凭据导出/导入、没有改用户音色；旧来源权限与真人克隆问题不在此补丁中被默认放行。

## 仍没完成

OGG/Opus语音消息封装、原生真正流式/中断、ASR逐厂商验证、级联/实时通话与Omni、音色绑定不越过用户模型选择、供应商usage及已调用后失败补账，仍在[完整需求与进度清单](2026-10-23-all-requirements-ledger.md)中保留；不再以合成测试代替这些真实验收。
