# V02–V06 第二个断点：真实用量、百炼限次复验与两家账号受控接入

2026-10-24；分支 `codex/voice-v02-v06-20261024`，源码 `75634865017c4814e9c4c37728949a3caf514c41`，基于上一 [接手交接](2026-10-24-voice-v02-v06.md)。这是开发/运维实证，不是独立验收，不是生产功能已开通。

## 本批结果

- **一次相关检查通过**：server 类型、七份变更源码 ESLint、八个专项文件 **66/66通过**，测试33.81秒，`CHECK_EXIT_CODES=0,0,0`。不复测已通过集合，不跑全仓/Web/安卓。
- 源码变化：百炼官方 HTTP 对象 URL 只升级为 HTTPS，仍保留原公共 IPv4 固定连接/无凭据/无跳转/限时限量；仅修复已知 WAV 长度哨兵，任意坏长度仍拒绝。合成/下载/编码/本地保存失败及播放中断都保留供应商已返回字符数，字符冻结上界与真实结算量分开；缺真实量标估算。兼容 ASR 接回真实 `usage.seconds`。
- **百炼单次真实复验仍失败**，不得写成根因完全解决或继续反复付费调用。MiMo 已有样音在真实 Chromium 中实际播放到 ended（1.44秒，无错误）；没有替换 Audio，也没有假装新站消息收发已验收。
- 只将**已跑通的 MiMo 与 SiliconFlow 两家官方账号**通过标准 CMS 认证加密迁入新站，二者仍 **disabled / unavailable / lastTestedAt=null**。新站语音目录与音色仍为0，用户默认、价格和既有账号未改，未部署新代码。百炼未迁/未启用。

## 本批代码

- [下载门禁](../../apps/server/src/modules/model-access/infra/dashscope-audio.ts)：只改变 URL 的 HTTPS 表述，不发送 HTTP、不放宽域名/IP、不跟随重定向。
- [适配器](../../apps/server/src/modules/model-access/infra/media-adapter.ts)：原生 WAV 规范化，内部可选 `reportedUsage` 保留真实 ttsChars（包括下载/Opus失败）；原生整段转流保留已发生用量；兼容 ASR 返回真实 seconds。
- [媒体网关](../../apps/server/src/modules/model-access/application/media-gateway.ts)：Qwen 字符冻结用保守输入上界而非拿6码点冒充实报10；真实结算用上游值；本地保存失败/流设置失败/取消保留已知费用证据，不声明免费。未改 HTTP/Android/业务 Port 或价格单位，无数据库迁移。
- [真实用量管线测试](../../apps/server/src/modules/model-access/application/tts-reported-usage.test.ts)、[下载回归](../../apps/server/src/modules/model-access/infra/dashscope-audio.test.ts)、[编码失败用量](../../apps/server/src/modules/model-access/infra/native-opus-adapter.test.ts)、[兼容ASR回归](../../apps/server/src/modules/model-access/infra/native-stream-lifecycle.test.ts)。数据/账务为受控端口，不冒充真实 PostgreSQL 收费对账。

## 百炼真实失败：保留证据，限次停止

[复验回执](<C:/wb-dev/artifacts/voice-v02-v06-20261024-r1/dashscope.json>)：

- `qwen-audio-3.0-tts-plus` / 公共系统音色 `longanlingxin`，固定合成句“你好，微伴。”；HTTP200，请求 `4b4fe410-3e9c-9828-83fb-7d56147a04d9`，供应商 characters=10。
- **实证**返回音频对象是 `http:`、官方域名、有签名查询（不保存/输出完整 URL），新适配器已安全升级为HTTPS，但仍返回 `provider_error`。本次真实失败保留 `reportedUsage.ttsChars=10`，不再丢成本证据。
- 没有可用百炼样音，空 WAV 不交付；不能宣称新站播放或供应商账单通过。已达到本轮失败后一次真实复验的限制，不继续付费试跑。
- 后续明确代码差异：旧 [合成报文](<C:/wb-ref/old-weiban/server/lib/voice/qwen_tts_adapter.js#L233-L245>) 显式 `input.sample_rate=24000`，新报文未传；**尚未证明这就是残余故障原因**。下载 DNS/TLS/HTTP/解码阶段也尚未获得完整脱敏分段证据。后续先设计不泄密的阶段诊断及离线协议修正；若还需新的付费诊断，须另获明确授权，不把本轮失败证据抹掉。

## 真实浏览器播放

- 使用 [MiMo真实样音](<C:/wb-dev/artifacts/voice-v02-v06-20261024/mimo.wav>)，不再调用供应商。
- Playwright 默认所需 headless-shell 缺失，首次未启动；未安装浏览器、未伪造通过。发现已有 Chromium1248，显式指定其真实可执行文件，仅复验一次通过。
- 实际 HTMLAudioElement 经点击播放：`endedCount=1`、`duration=currentTime=1.44`、`ended=true`、`paused=true`、`readyState=4`、`errorCode=null`，音频SHA `a7ca4bd7cde06aeea6e81dcd150cbbbd2c2ede21a0dd3d1b02439f56a412c58e`。[浏览器回执](<C:/wb-dev/artifacts/voice-v02-v06-20261024/mimo-browser.json>)、[执行脚本](<C:/wb-dev/logs/voice-browser-playback-20261024.mjs>)。
- 只证明真实供应商 WAV 的浏览器解码/播放/结束，不是真机扬声器听感、新站气泡、鉴权下载、连播或电话验收。

## 受控接入回执（不是开通）

1. 新站只读预检：当前运行源码仍 `1272d1c8ce91f54b9eb368cb7c575b8a87407a1d`；app UID1000，维护CLI/OpenSSL/FFmpeg在镜像内，可用空间3.0GB。首次末行 df 因 Windows CRLF 失败，单独更正查询后通过；后续脚本在远端仅去掉脚本文本 CR，不改二进制包。
2. 仅数据库变更前的加密快照：`/srv/weiban/backups/voice-config-20261024T-v02v06-E8B6ag`；pg_dump custom→age，`sha256sum -c`通过。应用未暂停，没有删除旧备份；未碰媒体所以不是完整发布备份，发布前仍需按原规则另做DB+媒体备份。
3. 维护操作者：现有 active admin `01a12a78-aeb5-711a-a7ce-b373c65b8e53`；未读取密码/token。接收根 `/srv/weiban/migration/voice-v02v06-20261024`，0700、UID1000。批次 `36e00c27-eba4-4ff3-93c3-2ea066f36bff`，接收证书 SHA `e323ff5a0aca06660d3cee6c3df3bcb9b6153804c3f0da620e2b80d4d72d04d3`。新私钥只在新机、并由新平台 DEK/KEK封装；有效到 `2026-10-23T19:20:45.739Z`（之后不能重用此批次做新导入）。
4. 旧机只读 exporter 只选两个 endpoint：MiMo系统TTS `7681f43a-1611-4b49-aea3-190778341f34`、SiliconFlow ASR `b7546e81-f959-4e15-a944-464c841af648`；**不用 provider 全选**。2账号/2端点元数据/0 env凭据，不读克隆、角色声音、私聊或其他场景。
5. 公开接收证书仅通过 Python Linux memfd（RAM、`/proc/<父pid>/fd/<fd>`）交 exporter/OpenSSL，旧机不落脚本/证书文件、不安装包、不改权限或服务。密文 stdout 经二进制SSH写本地，旧KEK/API Key/新私钥不出所属服务器；不经过PowerShell文本管道搬密文。
6. 包 **2110字节**，SHA `cedf1dbf1dc55e897a883fd4228822e741c6aa74e5f78c2f61727773c42ba060`；新机再次比对通过。`--plan` 返回 accounts2/endpointMetadataOnly2/targetEnabled=false/applies=false；`--apply` 创建2、未改既有行。原生产镜像内现有接收CLI执行，没有从本地换一份未经发布的接收逻辑。
7. 真实PG事后核验：SiliconFlow `bfd21489-df0c-5b5f-8349-7ef61d06f939`、MiMo `5454a6c0-4d27-5808-8869-6f007e6ea9db`；均 enabled=false、status=unavailable、secret_present=true、tested=false。目录 voice_models=0、voices=0。原上游/价目/默认/用户选择均未覆盖。
8. 本地只存公开证书、认证密文和脱敏回执：[导出回执](<C:/wb-dev/artifacts/voice-import-20261024/export-receipt.json>)、[导出启动器](<C:/wb-dev/logs/export-voice-accounts-20261024.mjs>)。密文文件不提交Git，也不打开打印；接收端私有批次状态继续保留便于审计，不贸然清理。

## 下一步，保持目标活动

- **先完成已可用 MiMo+SiliconFlow 的新服务整链路验证**：与真实用户会话隔离，用测试账号/角色验证合成→Ogg→加密媒体→聊天提交→鉴权读取→真实网页播放，以及短音频识别和两轮级联/中断。源码尚未部署，不能拿现网旧镜像证明本批代码已生效；不要修改真实客户默认模型。
- 真实供应商单价/零售价/促销有效期和账单尚未确认。可在隔离验收环境登记零价测试夹具，但不得当正式用户价格发布；现有正式价目/协议若缺对应项，需取得产品定价，而不是猜或从旧服机械复制。业务价格判断不该悄悄当作工程默认。
- 百炼保持未迁/未启用；MiMo ASR保持旧 disabled、Qwen3.1 token/Omni/WS等未支持范围保留。不能把部分原生协议通过写成V02–V06全部完成。
- 如需要发布本批代码，先执行来源防覆盖闸门，包含当前远端/本地主线及实时线上完整提交，再做加密DB+媒体备份、正式构建发布和实站核对；本批只做账号停用接入，未替代发布流程。
