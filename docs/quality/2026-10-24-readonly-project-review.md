# 2026-10-24 只读项目审查：语音链路 / 部署运维 / 安全 / 计费账务

> 审查人：Codex 子会话（只读审查，无写生产、无迁移、无部署、无 push）
> 日期：2026-10-24（Asia/Shanghai）
> 目标分支：`codex/voice-v02-v06-20261024`
> 目标提交（完整 SHA）：`1db77af3437a6f6d12aa8a03a940b099f34f49aa`
> 比较基线：远端 `main` = `7d059f067932dfee9f71b00918e0ceea1e852019`（2026-10-23 17:50 +08）
> 生产运行版本：`sourceCommit=1db77af3437a6f6d12aa8a03a940b099f34f49aa`（`deployedAt=2026-10-23T22:37:12Z`，即 2026-10-24 06:37 +08），app healthy
> 证据来源：仓库实际文件（行号见正文）+ 生产服务器只读 SSH 命令 + 生产库只读 SELECT（均为 2026-10-24 06:44–06:57 +08 之间执行）

## 结论

**未完成验收。** 本轮是只读审查，没有运行测试、没有登录后台、没有调用任何真实供应商，也没有改动代码、配置或生产数据；因此本报告不登记任何「通过」项，只登记事实、风险与未验证项。

已核实的事实里，最需要总经理和开发负责人先处理的是：生产正在运行一个**从未推送到 GitHub 的本地分支提交**（远端 40 个 ref 都不包含该提交），备份与生产数据在同一块数据盘且失败无告警，SSH 仍允许 root 密码登录且全站无 TLS，组合通话模型存在「音色模型不匹配时静默无声但继续计费」的路径，以及计费口径（约 3 积分/分钟 vs 代码公式约 6.05 积分/分钟）与展示倍率口径不一致。

线上语音现状（只读 SQL）：语音合成成功 3 次、语音识别（语音消息）成功 2 次；**`calls.call_sessions` 为 0 行，语音通话从未在生产发生过**。网页端当前是 IP + HTTP，浏览器禁用麦克风，通话入口即使存在也无法完成通话。

---

## 一、事实基线（生产快照，只读）

| 项目 | 事实 | 证据 |
|---|---|---|
| 运行版本 | `1db77af…`，镜像 `sha256:bc8f8952…`，契约 3.37，迁移 `0135_client_logs` | `/srv/weiban/deployment-version.txt` |
| 健康 | `/health` 200，`status=ok`，`database.ok=true`（1ms），`crypto.configured=true` | `curl http://127.0.0.1/health` |
| 容器 | app / caddy / postgres 均 Up；app、postgres healthy；重启次数 0 | `docker compose ps`、`docker inspect` |
| 入口 | 对外只有 80（用户端）和 22（SSH）；后台 127.0.0.1:8081（隧道）；无 443 监听 | `ss -tlnp` |
| 磁盘 | `/` 50G 用 18%；`/srv/weiban` 40G 用 18G（47%） | `df -h` |
| 磁盘占用 | containerd 13G、docker 3.7G、backups 1.4G、releases 1.0G、build cache 4.5G、镜像 8.9G（可回收 4.4G） | `du -sh`、`docker system df` |
| 备份 | 9 份完整包，最新 `weiban-20261023T223653Z-5aDsns`，`sha256sum -c` 通过，age 加密 | `sha256sum -c`、`od -c` |
| 备份定时 | 每天 04:00（Asia/Hong_Kong），`Persistent=true`，失败 `OnFailure=` 为空 | `systemctl cat/show` |
| SSH | `PermitRootLogin yes`、`PasswordAuthentication yes`、端口 22 | `sshd -T` |
| fail2ban | active，累计失败 17,219 次，当前封禁 6 个 IP | `fail2ban-client status sshd` |
| 系统 | 需要重启（`/var/run/reboot-required`），68 个包待升级；无监控 agent | `journalctl`、`apt-get -s`、`systemctl list-units` |
| 目录/配置 | `voice/cascade-call` 已登记并启用；`voice_call_pipeline` = sensevoice / deepseek-v4.1-flash / mimo-v2.5-tts | `model_access.model_catalog`、`model_access.settings` |
| 价格 | 识别 10,833 µ/分钟（成本 8,333）；合成 1,820,000 µ/万字符（成本 1,400,000）；搜索 5,000 µ/次（成本同价） | `billing.price_items`（active 版本） |
| 语音资产 | 音色库只有 1 条（`xiaomi/mimo-v2.5-tts`）；无千问音色 | `media.voices` |
| 通话数据 | `calls.call_sessions` = 0 行 | 只读 SQL |
| 生产源码 | `HEAD` 不在任何远端 ref；`origin/main..HEAD` = 46 个提交 | `git ls-remote origin`、`git rev-list` |

---

## 二、语音链路

### V1（高）组合模型的 TTS 组件与音色模型强绑定，失败时不告知用户、通话继续

**事实**
- 组合通话合成走 `voice_call_pipeline.ttsModelKey`：`apps/server/src/modules/model-access/application/media-gateway.ts:723-752`，其中 `:751-752` 规定 `speech_synthesis` 的 `preferredModelKey`（= 音色所属模型，`apps/server/src/modules/model-access/application/media-gateway.ts:594-596`、`apps/server/src/modules/media/application/assets.ts:873-891`）必须等于解析出的组件模型，否则返回 `model_unavailable`。
- 但开话前只检查「音色存在且启用」，不检查音色模型是否等于流水线 TTS：`apps/server/src/modules/ai-runtime/application/call-agent.ts:539-544`；音色解析函数 `apps/server/src/modules/ai-runtime/application/media-ai.ts:662-678` 也不看 `modelKey`。
- 合成失败后 `speak()` 直接 `return`，不发任何状态帧、不结束通话：`call-agent.ts:419-432`（`if (!tts.ok) return;`）。
- 音色所属模型来自 `media.voices.model_key`：`apps/server/src/modules/media/application/assets.ts:873-891`；网关用它作为 `preferredModelKey`：`apps/server/src/modules/model-access/application/media-gateway.ts:594-596`。

**影响**：一旦用户/角色的音色属于另一个 TTS 模型（例如以后导入 ADR 提到的 753 条千问音色），组合通话会「接通但角色永远没有声音」，同时 ASR 和文本仍在计费。ADR「组件停用或下架时整通不可用」只覆盖了组件本身，没有覆盖音色-组件不匹配。

**证据补充**：`voice-call-runtime.test.ts:263` 只断言网关对不匹配音色返回错误，未覆盖「开话成功后每轮静默失败」这一上层行为。

**建议**：`openSession` 打开通话前校验 `voice.modelKey === pipeline.ttsModelKey`，不匹配按明确原因拒绝开话；或让 TTS 组件按音色选择（多组件），不要单值 `ttsModelKey`。`speak()` 失败应发出可观察状态（至少结束通话），不能静默继续计费。

### V2（高）ADR 的「复用旧版 753 条千问音色」与单一全局 TTS 组件自相矛盾

**事实**：`docs/decisions/ADR-20261024-voice-cascade-composite-model.md:32-34` 写「旧版音色绑定（753 条千问 voice_id）作为 TTS 组件的音色来源」；但同一 ADR `:15-19` 与代码只允许一个 `ttsModelKey`（`apps/server/src/modules/model-access/application/voice-call-pipeline.ts:2-6` 的 CLI 说明、`apps/server/src/modules/model-access/domain/voice-call-pipeline.ts:11-33` 的严格三字段解析）。

**影响**：单一 TTS 组件无法同时服务 MiMo 与千问两类音色。只要按 ADR 导入千问音色，V1 的静默失败会成为必现问题；如果不导入，ADR 的后续承诺不成立。

**建议**：先决定「单 TTS 厂商」还是「按音色选组件」；后者需要把 `voice_call_pipeline` 扩展为按音色/模型的选择表（并同步契约），不能靠单值字段硬扛。

### V3（中）ADR 与实现不一致：`ttsVoiceMode` 未实现、克隆未接

**事实**：ADR `:15-19` 的 `settings` 示例包含 `"ttsVoiceMode": "system|clone"`；实际严格解析器只允许三个字段，未知字段直接判为非法/未配置：`apps/server/src/modules/model-access/domain/voice-call-pipeline.ts:14-27`。`media.voices` 也没有克隆/授权字段（`media/infra/db/schema.ts:95-105`）。

**影响**：文档让人以为可以配置克隆模式，实际无法写入；运维按文档操作会得到「pipeline 未配置」。属于文档/实现不一致，不影响现有系统音色。

**建议**：删除 ADR 中的 `ttsVoiceMode`，或实现并加迁移；克隆功能另立 ADR（涉及用户授权、样本存储、隐私）。

### V4（中）「3 积分/分钟」与代码公式不符：按现价手算约 6.05 积分/分钟

**事实**
- 代码混合口径：识别 1 分钟 + 合成 68 字 + 文本 6 轮，`apps/server/src/modules/model-access/application/voice-call-composite.ts:36-40`、`:193-200`。
- ADR `:21` 写「旧版实测每分钟约 3 积分（ASR 1.08 + TTS 约 68 字≈1.24 + 文本约 6 轮 token）」。
- 用生产 active 价目和 `defaultReplyMicros`（`apps/server/src/modules/model-access/domain/rules.ts:126-141`）手算：
  - ASR：10,833 µ = 1.08 积分
  - TTS：1,820,000 × 68 ÷ 10,000 = 12,376 µ = 1.24 积分
  - 文本：deepseek-v4.1-flash（输入 2,160,000、缓存 21,600、输出 8,640,000 µ/百万）× 标准回复假设（2,000 输入 + 8,000 缓存 + 200 输出）= 6,221 µ/轮，6 轮 = 37,326 µ = 3.73 积分
  - 合计 **60,535 µ ≈ 6.05 积分/分钟**
- 展示倍率用的基准 `openai/gpt-6.1-sol`：48,960 µ/条 × 6 = 293,760 µ；组合倍率 = 60,535 / 293,760 = **0.21**

**影响**：ADR 的成本预期把文本部分写成约 0.68 积分（3 − 1.08 − 1.24），与实现的 3.73 差 5 倍以上；「每分钟约 3 积分」不能作为定价依据。

**说明**：以上为按代码公式 + 线上价目**手算**，未调用生产接口读取实际返回值（未登录），标记为「未在接口实测」。

**建议**：以实际调用数据（一轮对话真实 token）重算混合常数，或把展示倍率改成「按实际近 7 天平均」；同步修正 ADR 与对外文案。

### V5（中）展示倍率口径不可比：「分钟 vs 6 条回复」混在「单条」列表里

**事实**
- 组合模型的倍率 = 一分钟混合成本 ÷ 基准模型 **6 条回复**成本：`apps/server/src/modules/model-access/application/voice-call-composite.ts:206-213`。
- 其他模型的倍率 = 加权价 / 基准加权价，是**单条回复**口径：`apps/server/src/modules/model-access/application/display-pricing.ts:200-203`。
- 用户端列表把两者放在同一个「×倍率」列：`apps/server/src/modules/model-access/application/catalog.ts:759-795`。

**影响**：用户看到「Voice Cascade 0.21×」，会理解成一分钟通话 ≈ 0.21 条基准回复（约 1 积分），实际是 ≈ 6 积分；更容易误判为便宜。另外组合模型的「约每次积分」为 null（`apps/server/src/modules/model-access/application/display-pricing.ts:217-222` 只对文本场景给 `perReply`，组合模型没有 token 价），列表该项为空。

**建议**：给组合模型单独标注单位（「约 X 积分/分钟」），或统一换算成「每分钟 vs 每分钟」；不要让两种口径共用一列。

### V6（中）语音场景有两个可选模型，推荐仍指向旧条目

**事实（只读 SQL）**
- `model_access.model_catalog` 中 `scenarios` 含 `voice_call` 且启用的有两条：
  - `voice/cascade-call`（显示名 `Voice Cascade`，标签 `pipeline:call`，排序 0）
  - `xiaomi/mimo-v2.6-flash-voice`（显示名「小米 MiMo v2.6 Flash（通话）」，排序 92，能力为空）
- `model_access.settings.model_uses.recommended.voice_call` = `xiaomi/mimo-v2.6-flash-voice`（**不是**组合模型）。
- 组合条目的能力数组为空（`capabilities={}`），只有场景 `voice_call`。

**影响**：用户「一键选推荐」得到的是旧的单文本模型；组合模型虽然排在最前，但没有被推荐、没有能力标记，客户端按能力过滤时可能直接消失（未在真实客户端验证）。两套通话路径并存，也增加排障成本。

**建议**：推荐改为 `voice/cascade-call`；旧条目停用或改成「旧版通话（不推荐）」；给组合条目补上必要能力（若客户端依赖）。

### V7（中）协议分流靠模型名正则，新增厂商容易走错协议

**事实**
- MiMo 识别：`/^mimo-[^/]*-asr/` → `apps/server/src/modules/model-access/infra/mimo-asr.ts:21-23`；原生识别：`/^qwen[^/\s]*-asr/` 或 `mimo-…-asr` → `apps/server/src/modules/model-access/infra/native-asr.ts:36-39`；分流顺序在 `apps/server/src/modules/model-access/infra/media-adapter.ts:745-748`。
- MiMo 合成：`/^mimo-[a-z0-9.]*-tts/` → `apps/server/src/modules/model-access/infra/media-adapter.ts:434-435`；百炼：`kind === 'dashscope' && /^qwen-audio-[\d.]+-tts/` → `media-adapter.ts:595-602`。
- 合成计费单位由 `billing_bounds.tts.counting` 决定（`apps/server/src/modules/model-access/application/media-gateway.ts:1154-1162`），生产为 `codepoints`。

**影响**：协议由「模型名字符串」推断，而不是目录里显式的 protocol 字段。以后接新厂商（例如名字不带 `-tts`、或同一厂商两种协议）会静默落到 OpenAI 兼容路径，表现为 400/解析失败，而不是配置错误。

**建议**：在 `model_catalog` 或上游配置中增加显式 `protocol`（可空，默认按现有正则），并在启用模型时校验协议与上游 kind 匹配。

### V8（中）MiMo 供应商按 token 计费，本地按码点计费，未对账

**事实**
- 本地 MiMo 合成按 `counting: "codepoints"` 计费（生产 bounds，`apps/server/src/modules/model-access/application/media-gateway.ts:1154-1162`）；供应商真实回执为 prompt 145 + completion 11 = 156 tokens（`docs/handoffs/2026-10-24-voice-v02-v06.md:46-47`）。
- `ttsReceipt` 只读取 `usage.characters`（`apps/server/src/modules/model-access/infra/media-adapter.ts:508-513`），MiMo 不返回该字段，所以结算永远按本地码点数，且 `usageReported=false`。

**影响**：如果 MiMo 实际按 token 或按音频时长计价，本地成本价（1.4 元/万字符）与实际账单没有对应关系；「成本账」和对账页无法验证。供应商计价单位我**未验证**。

**建议**：查清 MiMo 官方计价单位并写进价目备注；若按 token，需新增计费单位或换算规则（属于契约/计费变更），不能继续用「参考成本」冒充实际成本。

### V9（低）ASR 分段的计费步长完全依赖后台配置，配错会成倍放大成本

**事实**：每段识别按 `ceil(秒 / billingStepSeconds) * step` 计费（`apps/server/src/modules/model-access/domain/media-billing-bounds.ts:49-52`、`apps/server/src/modules/model-access/application/media-gateway.ts:1322`）；生产 `siliconflow/sensevoice-small` 的 bounds 是 `maxSeconds=300, billingStepSeconds=1`（只读 SQL），当前正常。

**影响**：如果管理员以后把某模型的 step 改成 60（测试夹具就是 60 或 15），每次说话（≤15 秒，`apps/server/src/modules/model-access/application/media-gateway.ts:125`）都会按 1 分钟计费，成本放大最多 4 倍，且没有任何提示。

**建议**：后台保存 `billingStepSeconds` 时显示「最小计费单位」和示例金额；对 step > 15 的语音模型给出警告。

### V10（低）组合模型的管理端保存后可用性显示不准确

**事实**：`ModelAdminService.upsert` 返回时用 `availability: { available: !detail }`（`apps/server/src/modules/model-access/application/models.ts:256-270`），没有走组合模型的 `compositeAvailability`；只有 `list()` 走了（`models.ts:127-136`、`:154-155`）。

**影响**：管理员保存组合条目后，接口响应可能显示「无路由/缺价格」，刷新列表才正确。只是显示问题，但会误导运维。

### V11（低）MiMo ASR / 百炼 TTS 代码路径在生产没有对应目录/上游

**事实**：生产目录只有 `siliconflow/sensevoice-small`（识别）与 `xiaomi/mimo-v2.5-tts`（合成），没有 MiMo ASR 条目、没有百炼模型/上游（只读 SQL）；但代码里两套协议都在（`apps/server/src/modules/model-access/infra/mimo-asr.ts`、`apps/server/src/modules/model-access/infra/media-adapter.ts:590-670`）。

**影响**：这些代码从未在生产被调用；MiMo ASR 的协议依据来自旧项目而非真实复验（`mimo-asr.ts:8-11` 自述）。不能把它们当作「已支持」。

### V12（信息）计费的三次调用与用途正确

**事实**：通话文本 `purpose: 'chat_reply'`（`apps/server/src/modules/ai-runtime/application/call-agent.ts:335-336`）、合成与识别 `purpose: 'voice'`（`:423-424`、`:567-568`），计费分别落在 chat / media 分类；组合模型只做解析、不自己产生调用（`apps/server/src/modules/model-access/application/scenarios.ts:108-130`、`apps/server/src/modules/model-access/application/media-gateway.ts:723-748`），与 ADR「三次真实调用」一致。这条是自洽的，但不构成「通话可用」的结论。

---

## 三、部署与运维

### D1（高）生产运行的是未推送的本地提交，远端没有任何副本

**事实**
- `git ls-remote origin`：远端 `main` = `7d059f0…`；远端 40 个 ref 中**没有任何一个包含** `1db77af…`。
- `git rev-list --count origin/main..HEAD` = **46**；`git branch -r --contains HEAD` 为空；本地分支没有 upstream。
- 生产 `deployment-version.txt` 的 `sourceCommit` 就是 `1db77af…`；另有一个文件名带 CR 的残留 `/srv/weiban/deployment-version.txt\r`（44 字节，内容为两行 `sourceAuthority=local`），是本地优先发布的痕迹。
- 发布闸门允许本地优先：`deploy/hk/Assert-ReleaseSource.ps1:25-41`（`-LocalOnly` 只校验本地 main/trunk、共享 HEAD 和最后一次观测到的 `origin/main`，明确写「no remote fetch claimed」）。

**影响**：当前生产源码只存在于这台开发机和服务器上。开发机或服务器任一损坏，都没有 GitHub 副本可恢复；CI 也从未对这 46 个提交运行过（`ci.yml:10-17` 只在 push/PR 触发）。这是数据/源码层面的真实损失风险，不是流程美观问题。

**建议**：立刻把这 46 个提交推到独立远端分支（不必合 main）并开 CI；把「发布提交必须存在于远端」加进闸门（或至少在发布清单里记录远端 ref）；再安排合并 main。

### D2（高）备份与生产同盘、无异地副本、失败无告警

**事实**
- 备份目录 `/srv/weiban/backups` 与数据库/媒体卷同在 `/dev/vdb1`（`df -h`、`lsblk` 未单独挂载）；最新包 147M，保留 7 份（`deploy/hk/backup.sh:11,29-32`）。
- 备份时先 `stop app` 再 dump + tar（`backup.sh:18-25`），每天 04:00 停服务约 1 分钟。
- systemd 单元没有 `OnFailure`（`systemctl show`），失败只留在 journal；没有异地/对象存储复制步骤（脚本与文档都没有）。
- 最新包 `sha256sum -c` 通过、age 加密（本次只读校验），但**没有做过恢复演练**（本轮禁止写，未恢复）。

**影响**：单块数据盘损坏（云主机磁盘故障、误删、勒索）会同时损失生产数据和全部备份；备份失败也不会有人知道。文档说「复制到独立异地存储」（`docs/ops/production-deploy.md:30`），实际未实现。

**建议**：至少 nightly `rclone/scp` 一份到另一台机器或对象存储；加 `OnFailure=` 告警（邮件/webhook）；每季度做一次恢复到空卷的演练并登记。

### D3（高）没有可复用的发布/回滚脚本；唯一脚本硬编码 10-22 版本

**事实**
- 仓库 `deploy/` 只有只读闸门 `Assert-ReleaseSource.ps1` 和构建/备份/恢复脚本，**没有发布或回滚脚本**（`deploy/` 文件清单）。
- 服务器上的 `deploy-release-20261022.sh` 写死：`release=7a913c8…`、`stage=…-patch`、`backup=weiban-20261022T074359Z-nIQOBQ`、`previous=src.before-final-20261022`，并断言线上镜像等于 `release-b16ffdd…`、健康接口契约版本 `3.34`（当前 3.37）。回滚逻辑（重打 `before-final-20261022` 镜像、恢复 `runtime.env`、切回 `previous`）只存在于这个一次性脚本里。

**影响**：今天的发布只能靠人记步骤或临时改脚本；回滚没有演练过的命令，且旧脚本的契约版本断言一定失败。新接手的人无法按仓库复现发布/回滚。

**建议**：把发布/回滚做成仓库内参数化脚本（输入：完整 SHA、备份路径、上一版本路径），发布清单由脚本生成；删掉硬编码断言或改成从版本文件读取；清理 `deployment-version.txt\r` 并在脚本里统一 LF。

### D4（中）健康检查只覆盖数据库和主密钥，且 unhealthy 不会自动重启

**事实**：`/health` 只查数据库 ping 和 crypto 是否配置（`apps/server/src/platform/http/health.controller.ts:38-59`）；Docker healthcheck 15s/5 次（`deploy/prod/Dockerfile:36`、`compose.yml:56-69`），但 `restart: unless-stopped` 不会因 unhealthy 重启；没有外部探活/告警（`systemctl list-units` 无 prometheus/node_exporter/uptime 类单元）。

**影响**：进程卡死、队列积压、上游全挂、磁盘写满、备份失败都不会主动通知；只有人打开后台或看日志才发现。

**建议**：加外部 uptime 检查（80/health）+ 磁盘/备份失败告警；health 增加「迁移版本、队列延迟、磁盘余量」等只读指标（注意不要泄露内部信息）。

### D5（中）磁盘与镜像/版本目录无清理策略

**事实**：`/srv/weiban` 47% 已用；containerd 13G、`/var/lib/docker` 3.7G、镜像 8.9G（可回收 4.4G）、build cache 4.5G；`/srv/weiban/releases` 14 个目录 1.0G；`incoming-voice-20261024` 213M、`import-staging` 255M、`src.old*` / `src.before-20261022` 等历史目录仍在；Docker 日志已配置 20m×5（`/etc/docker/daemon.json`）。

**影响**：目前还有 20G 余量，不会立刻出事；但按当前发布频率（一天多次）+ 每个 release 目录/镜像都保留，磁盘会持续下降，且备份需要空间。没有清理策略意味着最终靠人发现。

**建议**：发布脚本保留最近 N（如 3）个 release 目录与对应镜像，其余 `docker image prune`；一次性清理 `incoming-*`、`src.old*`；把磁盘阈值（如 80%）纳入告警。

### D6（中）系统有 68 个待升级包且需要重启，长期未重启

**事实**：`/var/run/reboot-required` 存在；`apt-get -s upgrade` 显示 68 个 Inst；`uptime` 11 天（`journalctl --list-boots` 只有 1 次启动）。

**影响**：内核/库的安全更新未生效；重启窗口没人安排。属于运维欠账，不一定是当前漏洞。

**建议**：安排一次维护窗口重启（先确认备份、迁移无需回滚），并建立月度补丁/重启节奏。

### D7（中）发布不跑任何自动检查；CI 与部署脱节

**事实**：`deploy/prod/Dockerfile:19` 只 build，不跑 `pnpm check`/测试；CI 只在 push/PR 时跑（`.github/workflows/ci.yml:10-17`），而部署提交未推送（D1），所以本次部署没有任何 CI 结果可查。交接文档自述「165 项相关测试一次通过」，属于开发自测，不是独立验收，也无法从服务器复核。

**影响**：部署产物没有可追溯的自动检查证据；出问题时无法判断是「本来就没测」还是「测了但没跑」。

**建议**：发布流程要求「同一 SHA 的 CI 运行成功」并把 run id 写进 `deployment-version.txt`；或者在服务器构建前跑一次 `pnpm check`（注意时间成本）。

### D8（低）备份保留数量与手工备份混在一起

**事实**：脚本保留最近 7 份（`KEEP=7`），但每份 147M；每次发布也会手工生成一份（当前 9 份、1.4G），脚本的清理只在下一次定时任务时发生。

**影响**：发布频繁时备份目录会阶段性超出 7 份；不影响正确性，只影响磁盘。

### D9（低）后台入口依赖个人隧道，重定向写死 localhost

**事实**：`ADMIN_PUBLIC_ORIGIN=http://localhost:9081`（`runtime.env`，不打印完整值）；Caddy 把 `/admin/alerts` 302 到该地址（`deploy/prod/Caddyfile:11-14`）。

**影响**：只有开着 SSH 隧道的人能访问后台；`/admin/alerts` 对其他人是死链。公网无 HTTPS 时这是有意的折中，但应记录为已知限制。

### D10（信息）备份内容与加密方式符合文档

**事实**：bundle 含 `database.dump.age`、`media.tar.age`、`SHA256SUMS`、`manifest.txt`（`weiban-backup-v1`、`kek_backup=separate-required`）；age 公钥在 `/srv/weiban/keys/backup-recipient.txt`（目录 700）。解密私钥不在服务器（文档记载在总经理电脑，未验证）。

---

## 四、安全

> 本节只描述事实与风险，不包含任何密钥、密文或完整凭据。

### S1（高）SSH 允许 root 密码登录，且公网持续被暴力尝试

**事实**：`sshd -T`：`permitrootlogin yes`、`passwordauthentication yes`、`port 22`；fail2ban 累计失败 17,219 次、当前封 6 个 IP。`docs/ops/hk-server.md:99-103` 已记录「禁用密码登录、改端口、改 root 密码」尚未做（需总经理同意）。

**影响**：root 密码一旦被猜中/复用，服务器完全失守；fail2ban 只能降低速度，不能消除风险。

**建议**：改为仅密钥登录、`PermitRootLogin prohibit-password`；如必须保留密码，至少加 MFA/限制来源 IP。这项工作需要总经理批准并先确认密钥登录可用（本次只用密钥登录成功，说明可行）。

### S2（高）全站 HTTP、无 TLS，管理 API 在公网可达

**事实**
- 用户端 `WEB_DOMAIN=:80`、后台 `ADMIN_DOMAIN=:8081`，对外只有 80 与 22，后台只绑 127.0.0.1:8081（`runtime.env`、`ss -tlnp`、Caddy 启动日志「listening only on the HTTP port」）。
- Caddy 用户域把 `/api/*` 和 `/health` 反代到 app（`deploy/prod/Caddyfile:19-22`），只拦 `/admin`、`/admin/*` 的 HTML（`:15-18`）；**`/api/v1/admin/*` 没有被拦**，公网可直接访问（需 Bearer 令牌）。
- 服务端没有按 Host/来源再拦管理接口：`grep ADMIN_PUBLIC_ORIGIN apps/server/src` 无匹配；全仓 `hostname` 相关校验只有实时同步与通话的 WebSocket Origin（`apps/server/src/modules/realtime/infra/socket-server.ts:118-125`、`apps/server/src/modules/calls/infra/stream-server.ts:105-119`），HTTP 的 admin 路由没有来源限制。
- 认证令牌走 `Authorization: Bearer`（`apps/server/src/platform/auth/auth.ts:6`），不是 Cookie；媒体/通话凭证放在 URL query（`apps/server/src/modules/media/application/media.ts:485-487`、`apps/server/src/modules/calls/application/calls.ts:524-534`）。

**影响**：登录密码、Bearer 令牌、媒体链接、通话 ticket 在公网明文传输，可被同链路嗅探；管理 API 暴露面比「后台只在 127.0.0.1」的预期大。当前是试运行、无真实用户，但一旦对外就必须先解决。

**建议**：上域名 + TLS（Caddy 自动证书）后再开放；在 Caddy 层对 `/api/v1/admin/*` 加来源限制（只允许隧道/内网）；不要把「后台 HTML 绑定 127.0.0.1」当成管理面已隔离。

### S3（中）密钥与秘密文件权限正确，但根目录/来源仍需注意

**事实**：`/srv/weiban` 755、`secrets` 700、`backups` 700；`runtime.env`、`deployment-version.txt` 600；容器内 `/run/secrets/{database_url,kek}` 0600，属主 `node`；app 以 uid 1000(node) 运行，只读根文件系统、`cap_drop: ALL`、`no-new-privileges`（`deploy/prod/compose.yml:56-69`、`docker exec id`）。`/srv/weiban/keys/backup-recipient.txt` 644（age 公钥，可接受）。

**影响**：秘密文件本身没有明显越权；但 `/srv/weiban` 根目录 755，且历史上留下 `runtime.before-final-20261022.env` 等副本（是否含秘密未验证，按命名应为环境文件）。这些历史副本应清理或确认权限。

**建议**：清理历史 env 副本；确认 `runtime.env` 备份不落在可读目录；密钥轮换流程见 `docs/ops/kek-rotation.md`（本轮未执行）。

### S4（中）管理接口的认证与限流可用，但没有二次校验

**事实**：登录失败按 IP + 用户名限流，5 次锁 15 分钟（`apps/server/src/modules/identity/application/accounts.ts:154-171`）；admin 接口统一 `@RequireAuth('admin')`（例如 `apps/server/src/modules/client-logs/http/client-logs.controller.ts:45-47`）。没有 IP 白名单、没有管理操作二次确认（除个别删除）。

**影响**：令牌泄露后可直接调用全部管理接口；结合 S2 的明文传输，风险叠加。

**建议**：管理面加来源限制/短会话；高风险操作（改价、停用模型、删除）加二次确认和审计告警；审计日志已有（`audit.record`），但无人看。

### S5（中）媒体与通话凭证设计合理，但依赖「链接即权限」

**事实**：媒体链接 = 密封令牌（mediaId + userId + 过期），TTL 5 分钟（`apps/server/src/modules/media/application/media.ts:70,477-488,526-552`）；下载时校验过期和 owner。通话 ticket 同样密封（callId + userId + 过期），WS 校验 Origin、`maxPayload=64KB`、同时最多 512 路（`apps/server/src/modules/calls/infra/stream-server.ts:31-32,55-58,84-119`）。

**影响**：拿到链接的人在 5 分钟内可访问（设计如此）；在 HTTP 下链接会明文出现在代理/网络链路中；本机应用日志只记录 `req.path`，不含 query（`apps/server/src/platform/http/request-context.middleware.ts:27`），这一点是正确的。

**建议**：TLS 后风险可接受；如需更严，可把媒体令牌绑定到会话或缩短 TTL。

### S6（中）客户端日志匿名入口可被滥用，但不是用户面入口

**事实**：`POST /api/v1/client-logs` 无需登录（`apps/server/src/modules/client-logs/http/client-logs.controller.ts:22-31`）；内存限流 100 请求/小时/IP、每 IP 1 万条上限（`apps/server/src/modules/client-logs/application/client-logs.service.ts:141-152`），全局 6000 单位/分钟（`:203-225`），入库前按路由白名单化、不存 message/URL/用户输入（`:68-93`）。每次入库持有全局 `pg_advisory_xact_lock('client_logs:ingest')`（`:163`）并逐事件查询（`:182-190`）。

**影响**：匿名者可写入错误事件（有配额），单实例下不会打垮聊天；但全局锁把并发摄入串行化，量大时会拖慢请求。属于新模块的容量风险，不是当前故障。

**建议**：把全局锁缩小到按 owner/指纹；或将摄入改为队列异步写；匿名入口加 Turnstile/签名（可选）。

### S7（低）应用日志包含用户 ID，无内容；无集中化

**事实**：HTTP 日志含 `userId`、`path`、`status`、`durationMs`（生产日志样本）；不含消息内容；Docker json-file 20m×5（`/etc/docker/daemon.json`），journald 默认；无日志采集。

**影响**：日志量有上限，不会撑爆磁盘；但排障只能 `docker logs`，跨重启/多容器检索困难；日志里的用户 ID 属于可识别信息，保留策略未定义。

**建议**：明确日志保留期与访问权限；需要时接 Loki/类似方案。

### S8（低）Caddy 安全头基本齐全，但 HSTS 在 HTTP 下无意义

**事实**：用户域有 CSP、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、HSTS（`deploy/prod/Caddyfile:3-9`）；后台域 CSP 允许 `style-src 'unsafe-inline'`（`:39`）。当前只有 HTTP，HSTS 不会生效。

**影响**：上 TLS 后这些头才有意义；`unsafe-inline` 只影响后台样式，风险低。

### S9（信息）SSH 只读审查没有读取任何密钥

**事实**：本轮 SSH 只执行 `sshd -T`、`ufw`、`systemctl`、`docker ps/logs/inspect`、`ls/stat/du/df`、`psql SELECT`；`/srv/weiban/secrets` 只看了权限和文件名，没有 `cat`。SQL 没有查询 `secret_ciphertext` 或用户消息内容。

---

## 五、计费与账务

### B1（高）用户已改为「先用后扣」，但架构文档仍写「冻结/透支」

**事实**
- 代码：用户付费调用 `postpaid`，不再冻结积分（`apps/server/src/modules/billing/application/reservations.ts:10-13,241-242`），hold 金额为 0（`:307-337`），结算按实际全额扣、允许余额变负（`:486`）。
- 文档：`docs/architecture/billing.md:13`「先冻结一笔估算的钱 → 调用 → 按实际用量结算」、`:21-22` 冻结定义、`:237-253` 余额不足与透支规则；ADR-0025:28「按 asr_minute 每分钟冻结、结算」。
- 生产数据：`billing.holds` 有 29 条 `postpaid=true`、`amount_micros=0` 的结算记录。

**影响**：文档与实现相反。按文档排障会得出错误结论（例如以为有冻结上限、以为余额不会为负、以为透支需要配置）。财务/客服解释也会不一致。

**建议**：更新 `billing.md` 与 ADR-0025 到 3.27 口径；在 `holds` 表注释和后台页面写清「postpaid 行 amount=0 是正常现象」。

### B2（高）未知成本会变成「用户 0 元 + 平台吸收」，且无人跟踪

**事实**
- 结算时 `costKnown=false` → 用户扣费 0（`apps/server/src/modules/billing/application/reservations.ts:446-453`），差额记平台吸收（`:488-507`）。
- 生产：156 条用量记录中 43 条 `cost_known=false`（41 条是余额不足失败、2 条 `interrupted`）；2 个 hold 仍带 `uncertainMicros`（12,860 + 12,824 = 25,684 µ）；平台 2026-10-20 的 `uncertain_cost_micros` 为 3,069,584 µ（约 3.07 元），至今未清零（只读 SQL）。
- 人工核对入口存在但只有文档：`docs/ops/unknown-cost-resolution.md:9-14`，接口 `POST /api/v1/admin/billing/holds/{holdId}/cost-resolution`（`apps/server/src/modules/billing/http/billing.controller.ts:151`）。

**影响**：金额目前很小（0.26 元 + 3.07 元），但路径是「系统吸收、没有待办、没有告警」，长期会累积成看不见的亏损；对账页的「成本待核」没人看就等于没有。

**建议**：后台加「待核成本」待办 + 每日提醒；超过 N 元或 N 天自动升级；把 10-20 的 3.07 元查明并登记（可能是进程中断/重试预留未结算）。

### B3（中）搜索价格已存在但内部「联网搜索」未选，功能静默关闭

**事实**
- `deepseek/deepseek-search` 在目录中启用，`search_call` 售价/成本均为 5,000 µ（0.5 积分/次，只读 SQL）。
- `model_uses.internal` 只有 `safety/planner/small_v/platform_content` 四个键且全为 null，**没有 `web_search`**（只读 SQL）。
- `isServiceEnabled('web_search')` 和 `resolve` 都要求 `internalModel('web_search')`（`apps/server/src/modules/model-access/application/media-gateway.ts:160-192,730`），否则返回未开通。
- 生产 `IMAGE_PUBLIC_SEARCH_ENABLED=1`（`runtime.env`），但该功能依赖 `webSearch`，实际会走「未配置」回退。

**影响**：开关开着、价格配了，但用户实际用不到联网搜索；也不会报错，只是静默不搜。计划里的「0.65 积分/次」也没落地（当前 0.5，且售价=成本、没有 1.3 倍加价）。

**建议**：在后台把 `internal.web_search` 选为 `deepseek/deepseek-search`；确认价格口径（0.5 还是 0.65，是否加价）；把「图片公开检索」依赖的开关与模型配置做成启动自检。

### B4（中）JEV 未接线，且输出/缓存价格为 0

**事实**
- `jev/jev-1.13.0` 已删除（`#deleted:`），`jev/jev-latest` 启用；价格为输入 280,000 µ/百万（成本同价）、**输出 0、缓存 0**（只读 SQL）。
- `model_uses.internal.planner` 为 null，`ai_runtime.planner_config` 0 行（只读 SQL）。
- 历史 `behavior_planning` 记录里 JEV 两次 `bad_request`、0 扣费；deepseek 规划调用为用户付费（`apps/server/src/modules/ai-runtime/application/planner.ts:604-665` 显式 `billingOwner: 'user'`）。
- `evaluate-decisions` CLI 直接解密密钥、调用供应商最多 28 次，声明「databaseWrites: false」（`apps/server/src/modules/model-access/application/decision-evaluation.ts:95-126`、`apps/server/src/cli/evaluate-decisions.ts:1-35`），**不写用量、不计费、不记录成本**。

**影响**：JEV 现在没有被使用，不会产生费用；一旦按计划接到 planner，输出 token 免费、售价=成本、且评估 CLI 的真实调用永远不在账上。属于潜在的计费漏洞，不是当前损失。

**建议**：接线前补齐 JEV 输出/缓存价格；评估 CLI 至少写一条平台审计（调用次数/模型/时间）；把 `planner_config` 与 `internal.planner` 的关系写进文档，避免两处配置互相覆盖。

### B5（中）语音成本价是「参考成本」，不是供应商账单

**事实**：`docs/handoffs/2026-10-24-voice-release-and-enablement.md:17-19` 明确写 TTS 1.82 元/万字符、ASR 0.0108 元/分钟是「可比付费供应商参考成本 × 1.3」，而当前 MiMo 是限时免费、SiliconFlow 也是免费；生产价目的 `cost_micros` 就是这些参考值（只读 SQL）。交接也写了 MiMo 报 token、百炼报 characters=10 与 6 个码点不一致（`docs/handoffs/2026-10-24-voice-v02-v06.md:47-55`）。

**影响**：成本账 ≠ 供应商账单；「毛利/平台吸收」统计会失真；促销结束后如果忘记改价，成本价会突然接近真实值。真实账单尚未对账（文档自述）。

**建议**：把「参考成本」和「已核对账单成本」分开字段/备注；促销结束前提醒改价；每月用供应商账单核对一次（至少 MiMo/SiliconFlow）。

### B6（中）全站售价/成本倍率差异 1.0×–120×，无统一规则可查

**事实（只读 SQL，active 价目）**：`xiaomi/mimo-v2.6-flash`、`deepseek-search`、`jev-latest` 为 1.00；语音为 1.30；gemini-4-argon 3.0；deepseek-v4.1-flash 输入 7.2 / 输出 17.28；gpt-6.1-sol 45–60；gpt-5.6-terra 90–120。没有任何文档定义这些倍率的来源。

**影响**：无法判断哪些是「真实成本 + 目标毛利」、哪些是占位/误填；定价与财务分析缺少基准。`xiaomi/mimo-v2.6-flash`（实际最常用）是 0 毛利，与语音 30% 毛利并存。

**建议**：明确统一规则（例如「所有对外模型售价 = 成本 × 1.3」或「按模型分别定价并在后台备注」），把规则写进 `docs/architecture/billing.md`；没有真实成本的模型标注「参考」。

### B7（中）展示倍率的人工值全部挂在已删除行上

**事实**：11 条非空 `display_multiplier` 全部属于 `#deleted:01a159b9` 的旧行；所有启用的 live 模型 `display_multiplier` 为 NULL（只读 SQL）。删除模型时键名会被改写（`apps/server/src/modules/model-access/application/catalog.ts:149-172` 的 `originalModelKey`/`modelKey`）。

**影响**：曾经手工调过的倍率在删除/重建后丢失，线上又回到自动计算；用户看到的价格倍数会变。交接文档说「展示倍率全部为空（自动计算）」，实际是「人工值被孤立在删除行」。

**建议**：删除模型时把人工倍率迁移/提示；或提供「批量恢复人工倍率」；在后台显示「人工/自动」来源。

### B8（中）TTS 中断仍按全文计费，与 ADR「只结算已合成字数」相反

**事实**：`streamSpeech` 的 `actualChars = started.reportedUsage?.ttsChars ?? chars`（全文码点数），`abort()` 只触发 `finish()`，仍按 `actualChars` 结算（`apps/server/src/modules/model-access/application/media-gateway.ts:626-641`）；ADR-0025:26 写「服务器停止合成（只结算已合成的字数）」。

**影响**：用户打断后仍付整段文字的钱；对 MiMo 这类「先整段合成再返回」的供应商，成本确实已经发生，但对用户计费口径与文档不一致，容易引发投诉。属于「文档/产品口径」问题，不是程序错误。

**建议**：明确「按请求字数计费」并改 ADR；若要对用户按已播放计费，需要在网关层记录已发送字节并换算，成本由平台吸收差额。

### B9（低）计费拒绝原因映射会掩盖真实原因

**事实**：`price_missing → model_unavailable`、`concurrency_limited → provider_unavailable`、`request_too_large → budget_exceeded`（`apps/server/src/modules/model-access/application/billing-bounds.ts:239-251`）。

**影响**：用户看到「模型不可用/供应商不可用/超预算」，实际可能是缺价、并发满、单次过大；排障需要看审计。

**建议**：至少在后端日志/审计里保留原始原因（已有审计），前端文案区分「稍后重试」与「价格未配置」。

### B10（信息）积分换算与「售价 = 成本 × 1.3」在语音上成立

**事实**：1 积分 = 10,000 µ = 0.01 元（`packages/contracts/src/http/billing.ts:34-39`）；TTS 1,820,000/1,400,000 = 1.30、ASR 10,833/8,333 = 1.30（只读 SQL + 手算）。

### B11（信息）平台每日上限 20 元只约束平台付费任务

**事实**：`BILLING_PLATFORM_DAILY_CAP_MICROS=20000000`（20 元）；用户付费调用不占平台预算（`apps/server/src/modules/billing/application/reservations.ts:296-305`，只有 `kind=platform`、`reservePlatformRisk` 或「售价 0 成本 > 0」才预留）。实际 10-23 平台已结算成本仅 4,088 µ。

---

## 六、技术债与优先级

### A. 会造成真实损失（建议本周处理）

| # | 问题 | 证据 | 建议动作 |
|---|---|---|---|
| A1 | 生产源码未推送到远端，46 个提交只存在本地；CI 从未运行 | 只读 `git ls-remote origin`：40 个 ref 均不含 `1db77af`；`git rev-list origin/main..HEAD`=46；`deploy/hk/Assert-ReleaseSource.ps1:25-41` 允许 local-first | 推独立远端分支并开 CI；发布清单记录远端 ref；再合 main |
| A2 | 备份与生产同盘、无异地、失败无告警 | 只读 `df -h`；`deploy/hk/backup.sh`；`systemctl show weiban-backup.service -p OnFailure` 为空 | 异地副本 + 失败告警 + 恢复演练 |
| A3 | SSH root 密码登录 + 公网无 TLS + 管理 API 公网可达 | 只读 `sshd -T`；`ss -tlnp`；`deploy/prod/Caddyfile:19-22`；`apps/server/src/platform/auth/auth.ts:6` | 禁密码/禁 root；上 TLS；管理 API 限来源 |
| A4 | 组合通话 TTS 与音色模型不匹配时静默无声但继续计费 | `apps/server/src/modules/ai-runtime/application/call-agent.ts:539-544`、`:419-432`；`apps/server/src/modules/model-access/application/media-gateway.ts:751-752`；ADR `:32-34` | 开话前校验；失败结束通话并提示；或按音色选组件 |
| A5 | 待核成本无人跟踪（2 个 hold 25,684 µ；平台 10-20 的 3.07 元） | 只读 SQL `billing.holds` / `billing.platform_daily_budget`；`docs/ops/unknown-cost-resolution.md`；`apps/server/src/modules/billing/http/billing.controller.ts:151` | 后台待办 + 告警 + 定期清零 |

### B. 影响体验（排入下一批）

| # | 问题 | 证据 | 建议动作 |
|---|---|---|---|
| B1 | 组合模型未设为 voice_call 推荐，旧条目仍可选；两套路径并存 | 只读 SQL `model_access.settings` / `model_catalog`（两条 voice_call） | 推荐改组合模型；旧条目停用/改名 |
| B2 | 公网 HTTP 下浏览器禁用麦克风，通话实际不可用；线上 0 通 | `docs/ops/hk-server.md:32`；只读 `runtime.env` `WEB_DOMAIN=:80`；只读 SQL `calls.call_sessions`=0 | 上域名 HTTPS 后再验通话；当前不要对外宣称可用 |
| B3 | 倍率口径「分钟 vs 6 条回复」与其他模型「单条」不可比；组合模型「约每次」为空 | `apps/server/src/modules/model-access/application/voice-call-composite.ts:206-213`；`apps/server/src/modules/model-access/application/display-pricing.ts:200-222` | 单独显示积分/分钟；或统一口径 |
| B4 | ADR 与实现三处不一致：`ttsVoiceMode`、3 积分 vs 6.05、中断只结算已合成 | `docs/decisions/ADR-20261024-voice-cascade-composite-model.md:15-21`；`apps/server/src/modules/model-access/domain/voice-call-pipeline.ts:14-27`；`apps/server/src/modules/model-access/application/media-gateway.ts:626-641`；`docs/decisions/ADR-0025-voice-call-transport.md:26` | 更新 ADR 与 billing 文案；明确中断计费 |
| B5 | 组件故障/音色不匹配只给通用错误；管理端组合模型保存后可用性可能错 | `apps/server/src/modules/model-access/application/models.ts:256-270`；`apps/server/src/modules/model-access/application/voice-call-composite.ts:155-171` | 专属错误码/文案；保存后重算可用性 |
| B6 | MiMo ASR/百炼 TTS 无生产配置，协议按模型名分流 | 只读 SQL 目录；`apps/server/src/modules/model-access/infra/media-adapter.ts:434-435`、`:745-748` | 加显式 protocol 字段；新厂商启用前做协议自检 |
| B7 | 语音成本价为参考值，未与供应商账单对账 | `docs/handoffs/2026-10-24-voice-release-and-enablement.md:17-19`；`docs/handoffs/2026-10-24-voice-v02-v06.md:55` | 建对账节奏；促销结束前改价 |

### C. 可延后（登记，不阻塞）

| # | 问题 | 证据 | 建议动作 |
|---|---|---|---|
| C1 | 无仓库版发布/回滚脚本；旧脚本硬编码 10-22、契约 3.34；`deployment-version.txt\r` 残留 | 只读服务器 `/srv/weiban/deploy-release-20261022.sh` 内容；`find -printf` 结果 | 参数化脚本入库；清理残留；回滚演练 |
| C2 | 磁盘/镜像/release 目录无清理策略（containerd 13G、镜像 8.9G、14 个 release 目录） | 只读 `du -sh`、`docker system df` | 保留最近 N 版 + prune；80% 告警 |
| C3 | 无监控/告警；health 只查 DB+crypto；68 个待升级、需重启 | `apps/server/src/platform/http/health.controller.ts:38-59`；只读 `systemctl list-units`；`reboot-required` | 外部探活 + 磁盘/备份告警；安排重启 |
| C4 | 售价/成本倍率 1.0×–120× 无统一规则；JEV 输出价 0；搜索 0.5 积分且售价=成本 | 只读 SQL `billing.price_items`（active 版本 66 条） | 定规则并写文档；补 JEV 输出价；确认搜索价 |
| C5 | 人工倍率全部孤立在已删除行 | 只读 SQL `model_access.model_catalog`（11 条 `#deleted:` 行有值，live 全 NULL） | 删除时迁移/提示；批量恢复 |
| C6 | `billing.md`/ADR-0025 仍是冻结/透支口径 | `docs/architecture/billing.md:13,21-22,237-253`；`docs/decisions/ADR-0025-voice-call-transport.md:28` | 同步到 3.27 先用后扣 |
| C7 | client_logs 匿名入口 + 全局 advisory lock 串行化 | `apps/server/src/modules/client-logs/application/client-logs.service.ts:141-163`、`:201-225` | 锁按 owner 缩小；或队列异步 |
| C8 | 无日志聚合，保留策略未定义 | 只读 `/etc/docker/daemon.json`（20m×5）；生产日志样本 | 明确保留期/访问权限；按需集中化 |
| C9 | 后台重定向写死 `http://localhost:9081` | 只读 `runtime.env`；`deploy/prod/Caddyfile:11-14` | 有域名后改成正式源 |
| C10 | `voiceCallCompositeFact()` 未被调用（死代码） | `apps/server/src/modules/model-access/application/catalog.ts:356-360` 仅定义 | 删除或接线 |

---

## 七、未验证项目（本轮没有证据，不得当作通过）

1. **未运行任何测试/类型检查/lint**。本轮是只读审查，未在仓库或副本执行 `pnpm test`/`typecheck`；交接文档中的 165 项等结果属于开发自测，我没有复核。
2. **未登录后台或用户端**。因此没有看到用户端真实返回的倍率、`pointsPerUse`、模型列表；V4/V5 的数字是按代码公式 + 线上价目手算。
3. **未调用任何真实供应商**。MiMo/SiliconFlow/百炼的真实计价单位、账单、音色听感、延迟均未验证；MiMo 按 token 计费只是交接文档记载。
4. **未做浏览器真实录音/通话**。当前公网 HTTP 下浏览器禁用麦克风；没有 Chrome 端到端证据。
5. **未验证通话链路**。生产 `calls.call_sessions` 为 0，没有真实通话、打断、道别、静音、断线重连记录。
6. **未做备份恢复演练**。只校验了最新备份的 SHA256 与 age 头；没有恢复到空卷，也没有验证 KEK/age 私钥可用（文档记载私钥在总经理电脑，未读取）。
7. **未验证远端 CI**。部署提交未推送，GitHub 上没有对应 run；`ci.yml` 的触发条件已读，但不能据此推断检查通过。
8. **未验证 SSH 私钥口令、fail2ban 规则细节、ufw 规则来源**；只读了生效配置和计数。
9. **未验证旧服 753 条音色绑定、旧库数据**；只引用交接文档的数字，没有读旧库。
10. **未验证安卓端通话/推送**；本轮没有 APK 或真机。
11. **未验证 2026-10-23 的 `behavior_planning` 调用来源**：当时 `planner_config` 可能非空，当前已为空；不能据历史记录推断现在的 planner 行为。
12. **未验证 `/srv/weiban` 下历史 `runtime.before-final-20261022.env` 等副本是否含密钥**（未读取内容，只看到文件名/权限）。

---

## 八、给开发与运维的交接

- **开发（语音）**：先修 A4（音色-组件不匹配的开话前校验与失败可见），再决定 V2（单 TTS 还是多组件）；同步 ADR 的 `ttsVoiceMode`、3 积分、中断计费三处。V6 只需改一条配置（推荐模型），但会影响用户看到的通话入口，建议与产品确认后再改。
- **运维**：A1/A2/A3 都属于「不修就可能真丢东西」的项；A1 最快（推分支），A2 需要选一个异地存储，A3 需要总经理批准并先确认密钥登录可用。C1/C2/C3 可以在同一批做（发布脚本入库 + 清理 + 监控）。
- **计费/财务**：B2 的 3.07 元平台不确定成本先查明；B5/B6 需要总经理确认「参考成本」是否可接受、售价倍率规则是否统一；B7 的人工倍率是否要恢复。
- **不要**把本报告当作任何功能的「已验收」；本轮没有运行测试，也没有真实供应商/真机证据。

---

## 附录：本轮只读查询方法（不含密钥）

- 仓库：`git ls-remote origin`、`git rev-list`、`git status`、`git log`；文件用 `read`/`grep`/`rg` 读取。
- 服务器：`ssh -i <deploy key> root@<host>` 执行 `sshd -T`、`ufw status numbered`、`fail2ban-client status sshd`、`ss -tlnp`、`systemctl cat/show/list-*`、`docker compose ps/logs/inspect`、`docker system df`、`du/df/ls/stat/find`、`sha256sum -c`、`od -c`、`journalctl`。
- 数据库：`docker exec -i <postgres> psql -U weiban -d weiban -X -A -f -`，只执行 `SELECT`；未查询 `secret_ciphertext`、用户消息或任何密钥字段。
- 所有命令都在 2026-10-24 06:44–06:57 +08 之间执行；本报告写入时未改变任何服务器状态。
