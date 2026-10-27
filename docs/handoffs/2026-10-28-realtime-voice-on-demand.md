# 交接说明：V2 实时通话按需复刻音色（全部走公共百炼账号）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-28 |
| 任务卡 | `docs/tasks/2026-10-28-realtime-voice-on-demand.md` |
| 分支 | `voice-ondemand`（worktree `C:/wb-dev/wb-voice2`，基于 `905f78bf`） |

## 结论

六项都做完了，开发自测通过（不是 Codex 验收）：

- 角色第一次用某个实时模型打电话时，会用它自己的声音样本当场复刻一个音色，存下来以后复用。
- 旧站 174 条 Omni 音色可以迁进来。
- Omni 的显示名带上了版本号。
- Realtime Plus 可以挂在公共百炼账号上。
- 3.5 Omni Plus 的默认音色核实为 `Tina`。

复刻费（0.01 元 / 个）现在没有对应的计价单位，要改契约。所以先写了变更申请，没改契约；批准前由平台承担，每次复刻都记审计。

## 做了什么

### 1. 按需复刻（照旧版 `ensureRealtimeVoice`）

接通前按这个顺序选音色（同一角色 + 同一实时模型）：

1. 已有专属音色（旧站迁入 / 管理员登记 / 之前复刻的）→ 直接用。
2. 没有专属音色，但角色有声音样本 → 当场复刻：
   - 写入 `model_access.realtime_voice_bindings`（来源记为 `clone`），以后复用。
   - 同一角色 + 模型同时只发一次复刻请求，并发的几通电话等同一个结果。
3. 复刻失败，或 20 秒内没完成 → 用这个模型的默认音色接通。复刻在后台继续，成功后下一通就用上。
4. 连默认音色也没有 → 不接通。**拨打前**就提示用户（不会先响铃再断）：
   - 没样本：「这个角色还没有能用于实时通话的声音，可以在「模型」设置的「语音通话」里换一个通话模型再打」
   - 复刻失败：「这个角色的实时通话声音还没准备好，请稍后再试，或在「模型」设置的「语音通话」里换一个通话模型」

   角色主动来电也会先做同样的检查，没声音就不发起来电。

其他要点：

- **不残留冻结**：复刻发生在冻结第一段通话费之前，所以等待、失败、超时都不会留下冻结。
- **失败冷却**：复刻失败后 10 分钟内不重试同一角色 + 模型，免得每通电话都多等 20 秒。本机转码忙不算失败。
- **两种复刻协议**（字段逐一对照旧版 `prepareRealtimeVoice` 和官方文档，有单测）：

  | 模型 | 复刻协议 | 参数 | 返回 |
  |---|---|---|---|
  | Realtime Plus（`qwen-audio-*-realtime*`） | `voice-enrollment` + `create_voice` | `prefix` = `wb` + 8 位；`audio` 为 Data URI | `voice_id` |
  | Omni 实时（`qwen*-omni-*-realtime`） | `qwen-voice-enrollment` + `create` | `preferred_name` = `wb_` + 10 位；`audio.data`；`language: zh` | `voice` |

  - Realtime Plus 的音色要审核，会轮询 `query_voice`，状态为 OK 才用（最多约 30 秒）。
  - Omni 3.8 按官方要求多带 `parameters.voice_clone_mode: normal`。
  - 和旧版的一处不同：旧版用的 `url` 字段官方说要下线，新站也没有公网样本地址，所以改用官方推荐的 `audio` 字段，样本以 Data URI 传。
- **样本转码**：
  - 生产镜像里有 ffmpeg（`deploy/prod/Dockerfile` 第 27 行，语音合成已经在用）。
  - 处理方式：截前 15 秒，转成单声道、24 kHz、MP3 64k。官方要求 ≥ 24 kHz，旧版用的是 16 kHz。
  - Realtime Plus 另外照旧版做去静音 + 响度归一。
  - 只走管道：不经 shell、不落临时文件。
  - **本机开发环境没有 ffmpeg**，复刻会失败并退回默认音色，属于预期行为。
- **样本来源**：角色默认音色（`media.voices`）登记的 `sample_media_id`。音色必须仍是启用状态。旧卡存的是供应商音色键的，会先换算成媒体音色。
- **哪些角色会复刻**：
  - 用户自建角色没有默认音色，所以永远不会触发复刻；有模型默认音色就用默认。
  - 只有带样本的官方 / 导入角色会复刻。

### 2. 复刻费用

- 现行契约 4.5 没有「复刻一次」的计价单位。变更申请：`docs/architecture/2026-10-28-voice-clone-billing-contract-change.md`（新增 `voice_clone` 单位与 `voiceClones` 用量）。
- 批准前由平台承担。每次成功复刻写一条审计：`realtime_voice.cloned`，`details` 里有 `costYuan: 0.01` 和 `billedTo: "platform"`。
- `voice-catalog --show` 新增 `realtime[]` 段，列出每个实时模型的专属音色条数（按 legacy / admin / clone 分）和平台已承担的复刻费。

### 3. 旧 Omni 174 条迁入

`scripts/ops/export-realtime-workspace.mjs` 重写：

- 删掉了「8d1b5e3b 是端点前缀」的错误前提，也删掉了导出账号（`account`）这一步，因为新站已有同一个公共百炼账号。
- `discover`：列出旧库全部实时端点和所属供应商，不读密钥。只把「公共供应商 8eed4824 下的 `qwen3.5-omni-plus-realtime` 端点」标成 `allowed: true`。
- `bindings`：必须用 `--endpoint-id` 给完整端点 ID。下面这些前缀一律拒绝，端点 ID 里也不许出现引号等字符：

  | 前缀 | 是什么 |
  |---|---|
  | `cb9de005` / `eb3630dd` | 私有供应商 / 它的端点 |
  | `8d1b5e3b` / `6b29cca6` | 私有供应商 / 它的端点 |
  | `156` | 早先约定不迁的 workspace |

  查询本身也限定为指定端点 + 公共供应商 + Omni 3.5 Plus。拿回的每一行再逐条核对，有一行越界就整体不写文件。

`import-legacy-realtime-voices`：

- `--endpoint-prefix` 改为 `--endpoint-id`。
- 默认把 `qwen3.5-omni-plus-realtime` 映射到 `qwen/qwen3.5-omni-plus-realtime`，不用再加 `--map`。
- 带了 `provider_id` 的行必须属于公共供应商，私有账号的行计入 `private_account` 跳过。
- 单测用 174 条正常行加各类越界行验证，结果正好映射 174 条。

### 4. 显示名带版本

- 目录 CLI 登记 Omni 时，显示名自动生成，例如「千问 Omni 3.5 Plus 实时通话」「千问 Omni 3.8 Flash 实时通话」。
- 新增 `voice-catalog --fix-omni`，用来改生产现有的两行，默认只预演：
  - 把不带版本的 Omni 显示名改成带版本的。
  - 没有默认音色的 Omni 补上已核实的默认音色。
  - 价格、服务单价、路由、启用状态、上游都不动。
  - 走后台同一套服务，自动写审计（改名 → `catalog.updated`，补音色 → `realtime_voice.default_set`）。

### 5. Realtime Plus 挂公共上游

- 登记 `qwen-realtime` 时不给 `--realtime-upstream`，就沿用千问 TTS Plus 所在的公共百炼账号（生产 `2fed2a60…`）。也可以显式指定，类型仍必须是百炼。
- **公共账号能不能调用 `qwen-audio-3.0-realtime-plus` 还没核实，要靠真实冒烟确认。** 登记仍是停用状态，这条说明也会出现在 CLI 预演的 notes 里。
- 默认音色仍是 `Cherry`（沿用批 V），它对 Realtime Plus 是否可用也未核实，冒烟时一起确认，不行就用 `--realtime-voice` 换。

### 6. 3.5 Omni Plus 默认音色

官方 Omni 音色列表（https://help.aliyun.com/zh/model-studio/omni-voice-list）显示：

- Qwen3.5-Omni-Realtime 系列默认音色是 `Tina`，Qwen3.8-Omni 系列也是 `Tina`。
- `Cherry` 不在 Qwen3.5-Omni 的列表里。

所以 `--fix-omni` 会给 `qwen/qwen3.5-omni-plus-realtime` 补上 `Tina`。生产上 3.8 Flash 已经是 Tina，不会改。

## 改了哪些文件

新增：

- `apps/server/src/modules/model-access/infra/dashscope-voice-clone.ts`（两种复刻协议）及 `.test.ts`
- `apps/server/src/modules/model-access/infra/realtime-clone-sample.ts`（ffmpeg 转码裁剪）
- `apps/server/src/modules/model-access/application/realtime-voice-clone.ts`（选音色、去重、超时、冷却）及 `.test.ts`
- `apps/server/drizzle/0146_realtime_voice_clone_source.sql` / `.down.sql`（来源检查放宽到 `clone`，可回滚；回滚会删掉 clone 来源的绑定）
- `docs/architecture/2026-10-28-voice-clone-billing-contract-change.md`（契约变更申请）

修改：

- `apps/server/drizzle/meta/_journal.json`、`model-access/infra/db/schema.ts`（注释）
- `model-access/infra/media-adapter.ts`：适配器新增可选 `cloneRealtimeVoice`；假供应商返回 `fake-rt-…`
- `model-access/application/media-gateway.ts`：接通前选音色，新增拨打前检查 `realtimeCallVoiceCheck`
- `model-access/application/realtime-voices.ts`：`binding` / `saveClone` / `countBySource`；去掉了不再使用的 `voiceFor`
- `model-access/application/realtime-call.ts`（`REALTIME_VOICE_CLONE_COST_YUAN`）、`model-access/tokens.ts`、`model-access/index.ts`
- `calls/tokens.ts`、`calls/application/calls.ts`（拨打 / 来电前检查）、`calls/application/calls.test.ts`
- `apps/server/src/app.module.ts`：
  - 把 characters 的「角色默认音色」读口接给 model-access。用的是组合层延迟绑定，不新增模块依赖，`depcruise` 无违规。
  - 把拨打前检查接给 calls，并给出提示文案。
- `apps/server/src/cli/voice-catalog.ts`、`voice-catalog-options.ts`、`voice-catalog-options.test.ts`、`import-legacy-realtime-voices.ts`
- `scripts/ops/export-realtime-workspace.mjs` 及 `.test.mjs`

没改：契约（`packages/contracts`）、其他模块的表、通话客户端协议、web / 安卓。

## 总负责人要在生产上跑的命令（按顺序）

「本机」指总经理这台电脑（有旧服 SSH 私钥）；「新服」指生产服务器。新服 CLI 的运行方式同批 V：

```
docker compose -p weiban-prod run --rm --no-deps -v /srv/weiban/migration:/migration app node dist/<命令>.js …
```

下面简写为 `app node dist/<命令>.js`。所有写库命令默认都只预演，要加 `--apply --operator-id <管理员UUID>` 才会写，并记审计。

0. **发布本分支**。发布时自动跑迁移 0146（只放宽一个检查约束，不动数据）。

1. **本机：查出公共 Omni 端点的完整 ID**（只读旧库，不读密钥）。
   ```bash
   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <本机空目录>        # 只打印计划
   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <本机空目录> --run  # 执行
   ```
   预期只有一条 `allowed: true`：`0975357a…`，型号 `qwen3.5-omni-plus-realtime`，供应商 `8eed4824…`，`bindings` 为 174。

2. **本机：导出这个端点的绑定**（只读）。
   ```bash
   node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <同一目录> --endpoint-id <第 1 步的完整 ID>        # 计划
   node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <同一目录> --endpoint-id <第 1 步的完整 ID> --run  # 执行
   ```
   产出 `realtime-bindings.json`，预期 `rows: 174`，并按状态打印条数。音色代号不是密钥。

3. **上传**：把 `realtime-bindings.json` 传到新服 `/srv/weiban/migration/<批次>/`。

4. **新服：改 Omni 显示名、补 3.5 默认音色**。
   ```bash
   app node dist/voice-catalog.js --show                                              # 看现状（新增 realtime 段）
   app node dist/voice-catalog.js --fix-omni                                          # 预演：列出要改的 fixes
   app node dist/voice-catalog.js --fix-omni --apply --operator-id <管理员UUID>         # 正式
   ```
   预演预期有两条：两行改名为「千问 Omni 3.5 Plus 实时通话」「千问 Omni 3.8 Flash 实时通话」，3.5 补 `defaultVoice: "Tina"`，3.8 的 `defaultVoice` 为 null（已有 Tina）。

5. **新服：迁入 174 条旧 Omni 音色**（目标模型 `qwen/qwen3.5-omni-plus-realtime` 已在目录里）。
   ```bash
   app node dist/import-legacy-realtime-voices.js --input /migration/<批次>/realtime-bindings.json --endpoint-id <第 1 步的完整 ID>                                     # 预演
   app node dist/import-legacy-realtime-voices.js --input /migration/<批次>/realtime-bindings.json --endpoint-id <第 1 步的完整 ID> --apply --operator-id <管理员UUID>    # 正式
   ```
   - 预演看这几项：`offered` 应为 ready 的条数，`importable` 是新库里也有这个角色的条数，`characterMissing` 是新库没有的角色，`missingModels` 应为空，`skipped.private_account` 应为 0。
   - 正式执行只插入还没有的绑定，不覆盖已有的；重复执行无副作用。

6. **（可选）新服：登记 Realtime Plus 到公共账号**。
   ```bash
   app node dist/voice-catalog.js --only qwen-realtime                                                     # 预演（不给上游 = 沿用公共百炼账号）
   app node dist/voice-catalog.js --only qwen-realtime --apply --operator-id <管理员UUID>                    # 正式（登记为停用）
   # 或显式指定：--realtime-upstream 2fed2a60-eaaf-5571-9a59-7253830e76bf
   ```

7. **新服：核对**。
   ```bash
   app node dist/voice-catalog.js --show
   ```
   - `realtime[]` 里 `qwen/qwen3.5-omni-plus-realtime` 的 `characterVoices.legacy` 应等于第 5 步的 `inserted`，`defaultVoice` 应为 `Tina`。
   - 想看审计可以只读查：
     ```bash
     docker exec -i weiban-prod-postgres-1 psql -U weiban -d weiban -c "SELECT occurred_at, action, target_id, details FROM platform.audit_log WHERE action LIKE 'realtime_voice.%' OR action = 'catalog.updated' ORDER BY occurred_at DESC LIMIT 20;"
     ```

8. **真实冒烟后再启用**：在后台把要开放的实时模型打开（目前都是停用）。

## 冒烟清单

都用管理员账号，在「模型」设置的「语音通话」里选对应的实时模型：

1. **改名**：后台和用户端模型列表里两个 Omni 分别显示「千问 Omni 3.5 Plus 实时通话」「千问 Omni 3.8 Flash 实时通话」。价格、启用状态没变。
2. **迁入的音色**（3.5 Omni Plus）：打给一个旧站迁入了绑定的角色。声音应是角色自己的音色，不是 Tina；接通不需要等待。
3. **按需复刻**（建议用 3.8 Omni Flash，它没有迁入的绑定）：打给一个有声音样本的官方角色。
   - 第一通：几秒到 20 秒内接通。声音是复刻出的角色音色；如果复刻慢，这一通是 Tina。
   - 审计出现 `realtime_voice.cloned`（`costYuan: 0.01`，`saved: true`）。
   - `--show` 里该模型 `characterVoices.clone` 加 1。
   - 第二通：立即接通，用复刻出的音色。
   - 百炼控制台的音色数加 1。
4. **不残留冻结**：上面每通挂断后，钱包里没有残留冻结；用量记录里有分模态 token。复刻本身不扣用户费。
5. **Realtime Plus**（登记后）：打一通。
   - 如果接通失败、上游报无权限或模型不存在，就说明公共账号用不了这个模型，保持停用并告诉我。
   - 如果 `Cherry` 报音色不存在，用 `--realtime-voice` 换掉。
   - 能接通再看复刻：Realtime Plus 的音色要审核，第一通很可能是默认音色，过一会儿再打才是角色音色。
6. **（可选）没声音时的提示**：自建角色（没有样本）配一个没有默认音色的实时模型去拨打，应在拨打时就弹出上面那句提示，不会响铃。

## 自测结果（开发自测，非独立验收）

以下各跑一次，全部通过：

| 检查 | 结果 |
|---|---|
| `pnpm --filter @weiban/server typecheck` | 通过 |
| ESLint `--max-warnings 0`（全部改动文件） | 通过 |
| `pnpm lint:deps`（depcruise 模块依赖规则） | 无违规 |
| vitest 相关 7 个文件（复刻适配器、复刻流程、calls、目录 CLI、实时会话、实时通话代理、语音通话路由） | 67 项通过 |
| `apps/server/test/migrations.test.ts`（不需要数据库的部分） | 3 项通过，3 项需数据库跳过 |
| `node --test scripts/ops/export-realtime-workspace.test.mjs` | 6 项通过 |
| 仓库根 `pnpm format:check` | 通过 |

说明：

- 测试全用假供应商（替换 fetch / 假适配器），没有发任何真实付费调用，没连任何服务器。
- 本机没起数据库，`saveClone` 的真实入库与迁移 0146 的执行 / 回滚没在本机跑过。迁移测试里不需要数据库的「每个迁移都有回滚脚本」检查已覆盖。以 CI 为准。

## 遗留问题与风险

1. **百炼每个账号最多 1000 个复刻音色**，Realtime Plus 的上限未单独核实。
   - 最坏情况：约 488 个带样本的角色 × 3 个实时模型 ≈ 1464 个，超过上限。
   - 实际只有被打过电话的「角色 × 模型」才会复刻；迁入的 174 条已经在这个账号里，本来就算在 1000 个之内，迁入不会再多占。
   - 满了以后复刻会失败并退回默认音色，不会打不通。
   - 建议：上线后看 `--show` 的 clone 条数，接近 800 时再考虑清理策略。
2. **复刻音色一年不用会被百炼自动删除**。删除后绑定还在，但那条音色会失效：接通时上游报错，这一通失败。
   - 目前没有自动重新复刻（不知道上游具体返回什么错误码，不敢猜）。
   - 遇到时可以在库里删掉对应绑定，下一通会重新复刻。
   - 建议冒烟后观察真实错误码，再加自动处理。
3. **Realtime Plus 两件事未核实**：公共账号能否调用 `qwen-audio-3.0-realtime-plus`；复刻单价（官方 0.01 元 / 个只针对 Omni 声音复刻）。审计里统一按 0.01 元记，可能偏低。
4. **20 秒等待**：第一次给某个角色打 Realtime Plus 时，复刻要过审核，接通可能多等最多 20 秒。拨打前检查已经提前开始复刻，响铃那 2～5 秒也算在里面。超过就先用默认音色。
5. **单进程去重**：同一角色 + 模型的并发复刻只在单个服务进程里去重。生产现在是单实例；以后多实例时，最多重复花一次 0.01 元，绑定以先写入的为准。
6. **复刻费由平台承担**，要等契约变更批准后才能向用户收（见「需要总经理决定的事」）。
7. **旧库导出的条数**是任务卡里的实查数（174）。新库里缺的角色会在第 5 步报告的 `characterMissing` 里体现，不会报错。

## qwen-audio-3.1-realtime-plus 评估（只评估，未接入目录）

- **现状**：据公开报道，3.1 系列 2026-09 发布，比 3.0 Realtime Plus 便宜很多（报道称降幅约 85%），支持声音复刻；官方复刻 HTTP 文档里 `target_model` 示例也出现了 `qwen-audio-3.1-realtime-plus`。**北京地域单价、默认音色名、公共账号可用性都没有在官方价格页核实。**
- **代码层面**已经兼容：
  - 复刻协议按 `qwen-audio-*-realtime*` 识别，3.1 走同一套 `voice-enrollment`（有单测）。
  - 实时会话适配器只认百炼原生协议。
  - 缺的只是目录登记：现在 `--only qwen-realtime` 固定登记 3.0。
- **建议**：值得支持，成本明显更低。等运维在百炼控制台核实 3.1 的北京价格和默认音色后，加一个 `--realtime-model qwen-audio-3.1-realtime-plus --realtime-cost …` 选项，约半天工作量，作为新任务卡。届时 3.0 可保留或停用。

## 需要总经理决定的事

1. **复刻费要不要向用户收**：批准契约变更（新增 `voice_clone` 计价单位）后，按成本 × 1.3 向打电话的用户收；或者维持平台承担。金额很小，一次性，最多约 14 元。我的建议是维持平台承担，等以后要做账单明细时再一起改。
2. **是否另开任务支持 3.1 Realtime Plus**（见上面评估）。我的建议是支持，等运维核实价格后开卡。

## 给其他负责人的交接

- **给总负责人**：
  - 按上面 0～8 步执行。本分支没 push、没合入。
  - 第 4、5 步都先预演，看输出再正式执行。
  - 第 6 步可以等 Realtime Plus 冒烟需要时再做。
- **给 web-lead**：不需要改。拨打被拒时，后端返回 `service_disabled`（422）加中文提示，前端已经会把未知错误码的 `message` 原样提示出来。
- **给 devops-lead**：生产镜像必须保留 ffmpeg（含 libmp3lame，Debian 自带）。去掉的话复刻会全部失败，并退回默认音色。
- **给 Codex（整体验收时）**：重点看三处：
  - `realtime-voice-clone.ts` 的去重 / 超时 / 冷却；
  - `media-gateway.ts` 里复刻在冻结之前；
  - 导出脚本的私有账号拦截。

## 官方依据

- Omni 声音复刻（协议、0.01 元 / 个、失败不计费、1000 个上限、一年未用删除、3.8 需 `voice_clone_mode`）：https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning
- 声音复刻 / 设计 HTTP 接口（`voice-enrollment`、`create_voice`、`query_voice`、`audio` 字段、审核状态）：https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api
- Omni 音色列表（Qwen3.5-Omni-Realtime 与 Qwen3.8-Omni 默认 Tina）：https://help.aliyun.com/zh/model-studio/omni-voice-list
- 样本录制要求：https://help.aliyun.com/zh/model-studio/recording-guide
- 模型价格：https://help.aliyun.com/zh/model-studio/model-pricing
