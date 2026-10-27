# 批 V 语音补齐与实时通话交接（2026-10-28）

任务卡：[2026-10-26-voice-completion](../tasks/2026-10-26-voice-completion.md)。分支 `voice-complete`（工作区 `C:/wb-dev/wb-voice`），基于 `local/trunk` b233942，已合入最新主线，未 push、未合主线。契约 4.4 → **4.5**，新迁移 **0145**。

## 一句话结论

- **代码都写完了，测试都过了，但生产上还没有一条新链路真正打通**：三个新模型都还没登记进目录，旧账号也还没迁。要靠总负责人在服务器上按下面的顺序跑脚本，跑完后总经理在后台点几下。
- 我没有连过任何生产服务器或旧服务器，也没有发起过真实的付费调用。实时通话只和本机的「假供应商」对过协议。所以第一次真实通话必须当成冒烟测试来做，通过后再给用户开放。

## 各链路现在能不能用

| 链路 | 代码 | 生产现状 | 还差什么 |
|---|---|---|---|
| 语音识别 · TeleSpeech（硅基） | 适配器原本就有 | 未登记 | 跑 `voice-catalog --apply`（用 SenseVoice 同一个账号，登记后直接启用） |
| 语音识别 · MiMo ASR | 适配器原本就有 | 未登记 | 同上，但**登记为停用**：型号名 `mimo-v2.5-asr` 没有用真实账号核实过，总经理在后台点「测试」通过后再启用 |
| 语音合成 · 千问 3.1 TTS Flash | 适配器原本就有（原生协议，24 kHz） | 未登记 | 跑 `voice-catalog --apply`（用百炼公共账号 2fed2a60，登记后启用） |
| 旧角色音色 753 条绑定 / 56 条音色偏好 | — | 千问 TTS 351 条和偏好已在 5c9ffb7 恢复（见下） | 另外 402 条是实时/Omni 专用绑定，用新命令迁（只迁 8d1b5e3b 账号下的） |
| 实时通话 · 千问 Audio 3.0 Realtime Plus | **新写**：服务端中转、打断、静音不计费、按每次回应的实际用量计费、挂断不留冻结 | 账号没迁、模型没登记 | 迁账号 → 登记（停用）→ 迁音色 → 真实冒烟 → 启用 |
| 实时通话 · Omni | 协议已支持 Omni 的会话格式 | 不登记 | **价格没有核实**，需要总经理给出核实过的四项成本价后再登记 |
| 用户端「语音通话」选择 | 显示「级联 / 实时 / Omni · 约每分钟 X 积分」 | 跟着上面的登记生效 | — |
| 私密模式 | 仍然不能通话（calls 模块原本就拒绝，实时通话入口又加了一道） | 不变 | — |

### 旧音色核对（第 2 项）

[迁移执行记录](./2026-10-24-migration-execution.md)：

- 旧库 `character_voice_bindings` 共 753 条，其中千问 TTS 351 条、实时 Plus 228 条、Omni 174 条。
- 新站 351/351 个千问音色已登记并绑定，失败 0。另有 137 个角色走 MiMo 克隆，189 个角色绑默认音色，677 个角色都有声音。
- 音色偏好源数据 56 条，其中 1 条的原用户已不可用（没有错配给别人）。另外为选了「生动（vivid）」的 12 个用户补建了 MiMo 音色。

由此可知，TTS 侧已经齐了；剩下的 402 条当时按「只能实时通话」跳过，这次用 `import-legacy-realtime-voices` 迁入。我无法登录生产库复核具体条数，请总负责人跑 [verify-legacy-voices.sql](../../scripts/ops/verify-legacy-voices.sql)（只读）确认。

## 总负责人要在服务器上做的事（按顺序）

下面的「本机」指总经理这台电脑（有旧服 SSH 私钥），「新服」指生产服务器。生产 CLI 的运行方式沿用迁移方案：`docker compose -p weiban-prod run --rm --no-deps -v /srv/weiban/migration:/migration app node dist/<命令>.js …`，下面简写为 `app node dist/<命令>.js`。

0. **发布本分支**。发布时自动跑迁移 0145（新表 `model_access.realtime_voice_bindings`，可回滚）。

1. **本机：查出 8d1b5e3b 账号的完整端点 ID**（只读，不读密钥）。
   ```bash
   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <空目录>          # 先看计划
   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <空目录> --run
   ```
   输出里每个端点带一个 `scopeEntry`，原样放进第 3 步的 scope.json。脚本只认 8d1b5e3b 开头，**156 开头的 workspace 会直接拒绝**。

2. **本机：导出该账号下的实时音色绑定**（只读；音色代号不是密钥）。
   ```bash
   node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key … --out-dir <同一目录> --run
   ```
   产出 `realtime-bindings.json`，并按型号和状态打印条数。

3. **新服：准备接收方**。沿用 ADR-20261023 的通道和迁移方案 Phase 5 的命令。
   ```bash
   app node dist/import-legacy-upstreams.js --prepare --operator-id <管理员UUID> \
     --secret-root /migration/<批次>/receiver --scope-file /migration/<批次>/scope.json --backup-reference <备份回执>
   ```
   把公开证书 `receiver.crt` 拷回本机，记下 `receiver.json` 里的指纹（`recipientSha256`）。这一步有效期 1 小时。

4. **本机：加密导出账号**。证书放在旧服的内存文件里，导出器经 stdin 运行，旧服不落文件，本机只拿到密文。
   ```bash
   node scripts/ops/export-realtime-workspace.mjs account --ssh-key … --out-dir <目录> \
     --endpoint-id <第 1 步的完整 ID> --receiver-cert <receiver.crt> --receiver-sha256 <指纹> --run
   ```
   产出 `realtime-account.cms` 和 `export-receipt.json`。回执里的 `ciphertextSha256` 下一步要用。

5. **新服：导入账号**。把 .cms 上传到 `/migration/<批次>/`，然后：
   ```bash
   app node dist/import-legacy-upstreams.js --plan  --operator-id … --batch-directory /migration/<批次>/receiver/<batchId> --packet /migration/<批次>/realtime-account.cms --expected-sha256 <ciphertextSha256>
   app node dist/import-legacy-upstreams.js --apply --operator-id … --batch-directory … --packet … --expected-sha256 … --backup-reference <备份回执>
   ```
   导入的账号默认是**停用**的。记下新上游 ID，在后台「上游账号」里启用它（类型必须是百炼 dashscope）。

6. **新服：登记语音目录**。
   ```bash
   app node dist/voice-catalog.js --show                                     # 看现状
   app node dist/voice-catalog.js --realtime-upstream <第 5 步上游ID>       # 预演，不写库
   app node dist/voice-catalog.js --apply --operator-id <管理员UUID> --realtime-upstream <第 5 步上游ID>
   ```
   - 只想先登记 ASR/TTS：加 `--only telespeech,mimo-asr,qwen-tts-flash`，这时不需要 `--realtime-upstream`。
   - 实时模型登记为**停用**，默认音色是 `Cherry`（可用 `--realtime-voice` 改）。
   - Omni 拿到核实价格后再登记：`--only omni --omni-model <百炼型号，例 qwen3.5-omni-plus-realtime> --omni-cost 文字入,音频入,文字出,音频出 [--omni-voice <音色>]`。

7. **新服：迁入实时音色**。把 `realtime-bindings.json` 上传，然后：
   ```bash
   app node dist/import-legacy-realtime-voices.js --input /migration/<批次>/realtime-bindings.json --endpoint-prefix 8d1b5e3b                      # 预演
   app node dist/import-legacy-realtime-voices.js --input … --endpoint-prefix 8d1b5e3b --apply --operator-id <管理员UUID>
   ```
   - 只插入还没有的绑定，不覆盖已有的。
   - 角色不存在、模型没登记的会在报告里列出来。
   - 如果 Omni 已经登记，再加 `--map qwen3.5-omni-plus-realtime=qwen/qwen3.5-omni-plus-realtime`。

8. **新服：只读核对**。`docker exec -i weiban-prod-postgres-1 psql -U weiban -d weiban -v ON_ERROR_STOP=1 < verify-legacy-voices.sql`

9. **真实冒烟**。启用实时模型（在后台打开，或重跑第 6 步加 `--enable-realtime`），用管理员账号在「语音通话」里选「实时」打一通 1～2 分钟的电话。逐项核对：
   - 角色先开口；
   - 插话能打断；
   - 静音一段时间不扣费；
   - 挂断后没有残留冻结；
   - 用量记录里有分模态 token。

   有问题就在后台把它停用。

## 总经理要在后台做的事

1. 第 6 步之后，在「模型」里应该能看到三个新条目：TeleSpeech 语音识别、MiMo 语音识别（停用）、千问 3.1 TTS Flash。给 **MiMo 语音识别**点「测试」，通过后再启用。启用后，用户端「语音识别」里就能选全部三个识别模型。
2. 确认价格。都是内部参考价，按「成本 × 1.3」，1 积分 = 0.01 元。

   | 模型 | 参考成本 | 售价 |
   |---|---|---|
   | ASR（两个） | 0.008333 元/分钟 | 0.010833 元/分钟，与 SenseVoice 相同 |
   | 3.1 TTS Flash | 1.4 元/万字符 | 1.82 元/万字符 |
   | 实时 Plus · 文字输入（缓存命中同价） | 5 元/百万 token | 6.5 元/百万 token |
   | 实时 Plus · 音频输入 | 40 元/百万 token | 52 元/百万 token |
   | 实时 Plus · 文字输出 | 40 元/百万 token | 52 元/百万 token |
   | 实时 Plus · 音频输出 | 150 元/百万 token | 195 元/百万 token |

   - **3.1 TTS Flash**：官方其实按 token 计费（1.5 / 12 元/百万）。平台暂时按字符结算，参考成本先取与 3.0 Plus 相同的 1.4 元/万字符（偏保守）。请按第一个月账单校准，改价只需在后台改一下。
   - **实时 Plus**：缓存命中价没有核实，按普通文字输入价计。
3. 冒烟通过后，启用「千问实时语音通话」。用户在「语音通话」里会看到「实时 · 约每分钟 X 积分」。
   - 按目前的价格和每分钟用量假设，大约 **24.7 积分/分钟**。
   - 这个数字只用来展示，实际扣费只按供应商每次回应报的用量。
   - 第一批真实通话之后，要拿实际数字校准假设，主要是每轮回应的文字上下文 token。
4. Omni：请提供核实过的四项成本价（元/百万 token：文字入、音频入、文字出、音频出）和型号名，由总负责人按第 6 步登记。

## 实现说明

- **服务端中转**：用户手机 ↔ 我们的服务器 ↔ 百炼，客户端通话协议不变（上行 16 kHz、下行 24 kHz、`barge_in`），密钥不出服务器。
  - 握手用 Bearer，15 秒内要就绪；单帧最大 2 MiB；不跟随重定向。
  - 会话参数沿用旧站：Plus 用 server_vad，阈值 0.5、静音 800 ms 判定说完；Omni 用 700 ms。
- **打断**：用户一开口（供应商报 `speech_started`）或客户端发 `barge_in`，就取消当前回应，并丢掉之后到达的旧声音。被打断的回应按已经产生的用量照常结算。
- **静音不计费**：上行要先过本地「静音门」。只转发说话段，前面带 300 ms、后面带 1.2 秒尾音，让供应商能判断「说完了」。长时间静音和按了静音键时都不上传，供应商就不会按音频输入收费。
- **计费**：供应商每次回应都会报一份分模态用量，所以每次回应单独算一笔。
  - 这笔钱事先冻结好，回应真正开始时才标记「已发出」，结束时按供应商报的数结算，然后再冻结下一笔。
  - 下一笔冻结不到（余额不足 / 日上限）：角色不再说话，按「余额不足」结束。
  - 供应商没报分模态明细：按「成本待核」处理，不按估算扣用户的钱。
- **挂断不留冻结**：挂断时取消进行中的回应，最多等 3 秒拿用量。
  - 拿不到用量的按「成本待核」处理。
  - 预先冻结但没用上的那笔直接释放。
- **角色一侧**（`realtime-call-agent.ts`）：
  - 会话指令由同一份人设、记忆、最近 12 条聊天和通话规则拼成，上限 2 万字；
  - 接通后角色先开口，主动来电时会说出打电话的原因；
  - 55 分钟提醒，59 分半道别；每 20 秒查一次余额，用完就先道别再挂断；
  - 用户说出高风险内容时，给会话指令追加安全关怀；
  - 挂断后把通话摘要写入记忆（普通范围）。
- **音色**：实时复刻音色只在登记它的那个模型、那个 workspace 里有效，所以按「角色 + 模型」存在 0145 新表里，绝不跨模型复用。
  - 角色有专属音色就用专属的，没有就用这个模型的默认音色（设置项 `realtime_call_voices`）。
  - 两样都没有就不接通。

### 契约 4.5 与迁移 0145 的理由

- **契约 4.5**：实时 / Omni 按「文字入 / 音频入 / 文字出 / 音频出」四种 token 分别计价，原有单位表达不了；`realtime_minute` 也不是供应商的计费方式。改动内容：
  - 新增两个音频 token 计价单位和用量字段；
  - `RouteBillingBounds.realtime`；
  - 两个可选的端口方法；
  - 后台服务单价条数上限放宽为「单位总数」。

  全部是新增或可选，所以升次版本号。Android 生成产物已同步。
- **迁移 0145**：实时音色是按「角色 + 模型」生效的，原来的 `media.voices` + 默认音色是「一个角色一个默认音色」，表达不了。0145 带回滚脚本。

## 遗留问题与风险

1. **实时通话的文字检查和声音是同时进行的**：发现台词越界会立刻打断，并丢弃还没播放的声音，但已经播出去的半句话撤不回来。级联通话是先检查整句再合成。这是端到端模型的固有限制，开放前请总经理知悉。
2. **平台级的通话开关**（`CALL_SERVICE_STATUS`）仍然要求「语音识别 + 语音合成」都已开通才允许打电话，实时通话也一样。生产上两者都已开通，所以不影响；以后如果要「只开实时、不开级联」，需要改成按用户的选择判断。
3. 3.1 TTS Flash 暂时按字符等价计价，没有按 token 结算（供应商实际返回的 usage 样本还没核对）。
4. Omni 没有登记（价格未核实）；Omni 的会话格式只有本机协议测试。
5. 后台还没有界面可以查看或修改实时音色（每个模型的默认音色、角色专属音色），目前只能用命令行。如果需要，可以另开设计 + Web 任务。
6. 「约每分钟积分」是按假设估算的，第一批真实通话后需要校准。
7. 集成测试需要 Docker，本机没有，留给 CI。

## 自测（每个包只跑一次）

- typecheck：contracts、server、admin、web 全部通过。
- lint：改动目录的 eslint 无错误（期间修了 4 处 `Date.now()`，按规则改成计时器）；server 依赖规则检查 `depcruise` 无违规。
- 单元测试：
  - server 相关 33 个文件 426 条通过，包括：
    - 实时协议（本机假供应商）8 条；
    - 实时计费会话 8 条；
    - 角色侧实时会话与通话路由 13 条；
    - 目录 / 迁音色命令 7 条；
    - 每分钟价格 4 条。
  - contracts 81 条通过（改了 3.36 测试里的单位数量）。
  - 旧服导出脚本的安全边界测试 4 条通过（`node --test`）。
- 仓库根目录 `pnpm format:check` 通过。
- 没做的：集成测试（需要 Docker，留给 CI）、真实供应商调用、真机通话。

## 给其他负责人

- **运维 / 总负责人**：按上面的 0～9 步执行。新增两个生产命令 `dist/voice-catalog.js`、`dist/import-legacy-realtime-voices.js`，已加进 `apps/server/scripts/build.mjs`。
- **Android**：契约 4.5 只同步了版本号、枚举和 schema，客户端通话协议不变，不需要改代码。
- **Web**：「语音通话」行前面加了通话方式标签（按目录标签 `pipeline:call` / `pipeline:rt` 和型号名判断）。
- **设计**：如果要做后台的实时音色管理界面，见遗留第 5 条。
- **Codex 验收重点**：
  - 挂断 / 断线 / 余额不足时不留冻结；
  - 静音不上传；
  - 打断后不再播放旧声音；
  - 私密模式拒绝通话；
  - 156 workspace 被拒绝；
  - 脚本不打印密钥。
