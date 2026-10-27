# V2 实时通话按需复刻音色（全部走公共百炼账号）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人（Claude） |
| 日期 | 2026-10-28 |
| 状态 | 进行中 |

## 目标

实时通话（Audio 3.0 Realtime Plus、Omni 3.5 Plus、Omni 3.8 Flash）像旧版一样：角色第一次用某个实时模型通话时，用它已有的声音样本当场复刻一个该模型专用的音色，存下来以后复用；全部跑在新站已有的公共百炼账号上，不再迁旧版私有 workspace。

## 背景（10-28 生产实查，只读）

- 批 V 交接（`docs/handoffs/2026-10-26-voice-complete.md`）的前提有误：旧库里 `8d1b5e3b` 不是端点 ID，而是**供应商**（`ai_providers`）ID，旧后台名称就叫「156语音」，与「不迁 156 号 workspace」的规则自相矛盾；`export-realtime-workspace.mjs discover` 按端点前缀查得 0 行。
- 旧库 402 条实时绑定分属三个账号：
  - 端点 `eb3630dd…`（Realtime Plus，旧版已停用）→ 私有 workspace 供应商 `cb9de005…`「DashScope Beijing Workspace」：213 条；
  - 端点 `6b29cca6…`（Realtime Plus，旧版启用）→ 私有 workspace 供应商 `8d1b5e3b…`「156语音」：15 条；
  - 端点 `0975357a…`（`qwen3.5-omni-plus-realtime`）→ **公共**百炼供应商 `8eed4824…`：174 条。新站公共百炼上游 `2fed2a60-eaaf-5571-9a59-7253830e76bf`（Alibaba Bailian）用的就是这个账号。
- 旧版是按需复刻的：`C:/wb-ref/old-weiban/server/lib/voice/qwen_realtime_gateway.js` 的 `ensureRealtimeVoice` / `prepareRealtimeVoice`（约 236–400 行）——没有现成绑定时，用角色的 MiMo 声音样本截 15 秒，调 `services/audio/tts/customization`：Realtime Plus 用 `voice-enrollment` + `create_voice`，Omni 用 `qwen-voice-enrollment` + `create`（`audio.data`、`language: zh`），同一角色+模型并发只发一次。
- 官方（[Omni 声音复刻](https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning)）：支持 `qwen3.8-omni-flash-realtime`、`qwen3.5-omni-plus-realtime` 等；样本 WAV(16bit)/MP3/M4A、≥24 kHz 单声道、推荐 10–20 秒、<10 MB、至少 3 秒连续清晰朗读；0.01 元/个、失败不计费；音色只能用于创建时的 target_model；每账号上限 1000 个；一年未用自动删除。
- 生产现状（10-28 04:40 已由总负责人登记，写了审计）：`qwen/qwen3.5-omni-plus-realtime`（停用，无默认音色）、`qwen/qwen3.8-omni-flash-realtime`（停用，默认音色 Tina）都挂公共上游；两者显示名都是「千问 Omni 实时通话」，用户分不出。Realtime Plus 未登记。新站声音样本在 `media.voices.sample_media_id`。

## 输入文档

- `docs/handoffs/2026-10-26-voice-complete.md`（批 V 实现说明、计费与遗留）
- `apps/server/src/cli/voice-catalog.ts`、`voice-catalog-options.ts`、`import-legacy-realtime-voices.ts`
- `apps/server/src/modules/ai-runtime/application/realtime-call-agent.ts` 及实时会话/适配器（`dashscope-realtime.ts`、`realtime-voice-session.ts`）
- `scripts/ops/export-realtime-workspace.mjs`
- 上面列的旧版网关源码

## 范围

1. **按需复刻**：接通前若该角色在该实时模型下没有 ready 绑定、且有声音样本，就当场复刻并写入 `model_access.realtime_voice_bindings`，之后复用；同一角色+模型并发只复刻一次；超时或失败时退回该模型默认音色，再没有就按现状不接通，并给用户可理解的提示（不要无限等待）。两种复刻协议按旧版与官方文档实现；样本按官方要求转码裁剪（核实容器里有没有 ffmpeg，没有就用已有的媒体处理方式）。
2. **复刻费用**：0.01 元/个。按项目「后台消耗用户承担、售价=成本×1.3」原则接进现有计费；如果为此必须改契约，先写变更申请，不要直接改，先按平台成本记账并在交接里说明。
3. **旧 Omni 174 条迁入**：修正 `export-realtime-workspace.mjs`，bindings 步骤改为按明确的端点 ID 选（只允许公共供应商下的 `qwen3.5-omni-plus-realtime` 端点；两个私有 workspace 供应商 `cb9de005`、`8d1b5e3b` 一律拒绝），删掉错误的「8d1b5e3b 前缀」前提；确认 `import-legacy-realtime-voices` 能把这 174 条映射到 `qwen/qwen3.5-omni-plus-realtime`，给出总负责人要跑的确切命令。
4. **显示名区分**：目录 CLI 登记 Omni 时显示名带版本（如「千问 Omni 3.5 Plus 实时通话」「千问 Omni 3.8 Flash 实时通话」）；另给一条改生产现有两行显示名的办法（CLI 选项或 SQL，含审计）。
5. **Realtime Plus 挂公共上游**：`--realtime-upstream` 允许公共百炼上游；交接里写明「公共账号能否调用 `qwen-audio-3.0-realtime-plus` 未核实，由冒烟确认」，并评估官方现行 `qwen-audio-3.1-realtime-plus` 是否应一并支持（只评估，写进交接）。
6. **3.5 Omni Plus 默认音色**：查官方音色列表给出一个已核实可用的默认值写进交接；查不到就保持无默认。

不可以改：其他模块的表、通话客户端协议；不 push、不合入主线、不碰任何服务器、不发真实付费调用。

## 验收标准

- [ ] 无绑定且有样本 → 复刻一次并落库，第二通直接复用（假供应商测试）
- [ ] 并发两通同角色同模型 → 只发一次复刻请求
- [ ] 复刻失败/超时 → 退默认音色；无默认 → 不接通且提示明确；不残留冻结
- [ ] Omni 与 Realtime Plus 的复刻请求体分别与旧版/官方一致
- [ ] 导出脚本拒绝两个私有供应商，选公共 Omni 端点导出；`node --test` 安全边界测试更新并通过
- [ ] 显示名带版本；改现有两行的办法可用
- [ ] server typecheck、lint、相关测试各跑一次通过；仓库根 `pnpm format:check` 通过

## 交付物

- worktree `C:/wb-dev/wb-voice2`、分支 `voice-ondemand`，基于最新 `local/trunk`（先 `git fetch origin` 确认含 origin/main）
- 交接：`docs/handoffs/2026-10-28-realtime-voice-on-demand.md`（含总负责人要在服务器上跑的命令、冒烟清单）
