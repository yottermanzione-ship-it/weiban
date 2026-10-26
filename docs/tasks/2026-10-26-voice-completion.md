# 2026-10-26 批 V：语音链路按旧版补齐（server + admin + web）

| 项 | 内容 |
|---|---|
| 派发人 | 项目总负责人（Claude） |
| 依据 | 总经理 10-26：「把旧版服务器上的链路都拿过来」；Codex 清单 `docs/handoffs/2026-10-24-voice-remaining-work.md`、`2026-10-24-voice-migration-handoff.md`、`2026-10-24-voice-v02-v06.md`、`2026-10-24-cascade-call.md` |
| 生产实查（10-26） | 目录里语音识别只有 SenseVoice（硅基流动）1 条；语音消息有 MiMo 2.5、MiMo 克隆、Qwen TTS Pro 3 条；通话只有「级联通话」（识别 → DeepSeek V4.1 Flash → MiMo 合成） |

## 旧版应有、新版现状

| 类 | 旧版条目 | 新版现状 |
|---|---|---|
| 识别 | SenseVoice（硅基流动） | 已上线 |
| 识别 | TeleSpeech（硅基流动） | 协议已支持，**未登记目录 / 价格** |
| 识别 | MiMo 识别（旧协议） | 代码已写（`mimo-asr.ts`，4d3cf7c），**未登记目录 / 价格、未真实验证** |
| 合成 | MiMo 2.5、MiMo 克隆、Qwen TTS Pro | 已上线 |
| 合成 | Qwen 3.1 TTS Flash | 代码已放行，**未登记目录 / 价格** |
| 通话 | 级联（识别 + 文字 + 合成） | 已上线 |
| 通话 | `qwen-audio-3.0-realtime-plus` 实时通话（旧版私有 workspace `8d1b5e3b` 账号） | **未开始**：需 WebSocket 实时传输、打断、按 token 计费；账号需按既有 CMS 加密通道从旧服迁入（只读旧服，不迁 156 号 workspace） |
| 通话 | Qwen Omni 3.1 | **未开始**，同上 |

## 公共约定

基线 `local/trunk`（先 `git fetch origin` 确认已含 origin/main）。worktree `C:/wb-dev/wb-voice`，分支 `voice-complete`。不 push、不合入、不碰生产服务器、不打印密钥；真实付费调用只做每条一次最小烟测且须在报告列明（由总负责人安排在服务器隔离环境执行，子代理本地只用夹具）。迁移、契约编号接在当时主线之后。交接 `docs/handoffs/2026-10-26-voice-complete.md`。

## 要做的事

1. **识别补齐**：TeleSpeech、MiMo 识别两条的目录登记脚本（或后台导入配置）与价格（售价 = 成本 × 1.3，1 积分 = 0.01 元，与现有语音内部价口径一致）；用户端「语音识别」场景能选这三条。
2. **合成补齐**：Qwen 3.1 TTS Flash 同上；确认旧版 753 条角色音色绑定 / 56 条用户音色偏好已随 5c9ffb7 恢复，缺的补导。
3. **实时通话**：实现百炼实时语音（`qwen-audio-3.0-realtime-plus`）与 Qwen Omni 3.1 的通话传输：服务端 WebSocket 中转（密钥只在服务端）、用户插话打断、静音不计费、挂断无残留冻结、按供应商实际用量计费；用户端「语音通话」场景可在「级联 / 实时 / Omni」之间选，显示约每分钟积分。私密模式仍不开放通话。
4. 旧版私有 workspace 账号迁入步骤写成运维脚本 + 说明，由总负责人在服务器执行（复用 `docs/decisions/ADR-20261023-legacy-config-export.md` 的通道）。
5. 交接写清：每条链路现在能不能用、总经理要在后台做什么。
