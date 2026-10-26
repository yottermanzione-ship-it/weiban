# 语音发布与生产配置（2026-10-24 03:5x）

## 已上线

- 源码 `c7be0e3f53b225c399df6252cfd96aa2c2f0c184`，2026-10-23T19:51:55Z 切换，`publish.exit=0`。
- 发布前本地优先来源闸门通过（包含最后已知 origin/main、本地 main/trunk、共享 HEAD `7a913c8`、线上 `1272d1c8`）；GitHub 当时不可达，未声称远端 fetch。
- 加密备份 `weiban-20261023T195136Z-mmrdaJ`（DB + 媒体，sha256 校验通过）；回退镜像 `weiban-app:before-20261023T195136Z`、`weiban-edge:before-...`、上一来源目录均保留。
- 健康：app `200 ok crypto=true`、`http://127.0.0.1/health` 200、`http://127.0.0.1:8081/health` 200；无新迁移（仍 `0135_client_logs`），契约 3.37。
- 首次发布尝试因我的健康检查写成 HTTPS 域名（本机是 IP:80/8081 方案）而失败，**自动回滚成功**，站点未受影响；只修正检查命令后重发成功。这次失败不计为产品缺陷。

## 已启用的语音配置（内部价，非对外定价）

- 上游：MiMo、SiliconFlow 两个旧服迁入账号 `enabled=true`、`status=active`，写入 `upstream_status`（source=admin_test）。
- 模型：`xiaomi/mimo-v2.5-tts`（voice_message）、`siliconflow/sensevoice-small`（speech_recognition）、`xiaomi/mimo-v2.6-flash-voice`（voice_call，复用 MiMo 文字模型）。
- 音色：`默认音色`（providerVoiceKey `mimo_default`，绑定 MiMo TTS）。
- 价目：新版本 `voice-internal-2026-10-23`，**复制了原价目全部条目**再追加语音，未丢既有模型价格。
  - TTS：1,820,000 微元/万字符（参考成本 1.4 元/万字符 × 1.3；MiMo 当前为限时免费促销，若按字面成本则为 0）。
  - ASR：10,833 微元/分钟（参考成本 0.008333 元/分钟 × 1.3；SiliconFlow 当前免费）。
  - **这是按“可比付费供应商参考成本”而非本轮实际 0 成本计算**，需总经理确认是否接受；改价只需再发一个价目版本。
- 推荐模型已指向上述三个模型（保留了原有 internal 配置）。

## 发布后复核发现的阻塞问题（尚未修复）

**浏览器录音的语音输入目前无法识别。** 网页录音格式是 `audio/webm;codecs=opus`（Chrome）或 `audio/mp4`（Safari），而 [`transcribeSpeech`](../../apps/server/src/modules/model-access/application/media-gateway.ts) 只用 `pcmWavSeconds()` 从 WAV 头推导时长；非 WAV 返回 null 就直接 `model_unavailable`。隔离验收当时上传的是 WAV，因此掩盖了这个问题。

影响：角色发语音（TTS）已可用；**用户录一段语音让角色听懂，线上仍会失败**。

建议修复（未实施）：新增有界的 `ffprobe` 时长探测（生产镜像已有 `/usr/bin/ffprobe` 5.1.9），在 WAV 头不可用时读容器真实时长，用于冻结估算；结算仍以供应商上报秒数为准。需补直接测试并在 Chrome 真实录音下复验，再二次发布。

## 其它未完成

- 百炼下载仍失败，未启用。
- 正式账单对账、真机听感、跨静音段识别归属未做。
- 生产环境还没有用真实浏览器录 webm 跑过语音输入（正因上述缺陷）。
