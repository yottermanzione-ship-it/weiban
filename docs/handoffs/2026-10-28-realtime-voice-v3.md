# 交接：V3 实时通话收尾（北京 workspace 迁入、复刻向用户收费、Realtime 3.1、后台上架报错）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 任务卡 | `docs/tasks/2026-10-28-realtime-voice-v3.md` |
| 分支 | `voice-v3`（worktree `C:/wb-dev/wb-voice3`，基于 `local/trunk`，已确认含 origin/main） |
| 日期 | 2026-10-28 |
| 状态 | 开发与自测完成，未 push、未合入，没有连接任何服务器，没有发真实付费调用 |

## 一句话结论

四件事都做完了：
- 北京 workspace 的账号和 213 条音色有了完整的迁入命令，「156语音」在每一步都会被拒绝；
- Omni 复刻音色改为向用户收 0.013 元/个（1.3 积分），只在成功时扣一次，余额不足就用默认音色，不复刻；
- 新增 Realtime 3.1 Plus 登记项，价格有官方出处；
- 后台「上架」报错的原因找到了，测试先红后绿。

上线时有两处需要留意：**发布后后台页面要强制刷新**；**3.1 走公共账号能不能通要冒烟确认**（见「需要总经理决定的事」）。

## 做了什么

### 1. 北京 workspace（任务卡第 1 项）

**导出脚本 `scripts/ops/export-realtime-workspace.mjs`（重写）**
- 能迁的只有两个端点：
  - 公共 Omni 端点：供应商 `8eed4824…`，型号 `qwen3.5-omni-plus-realtime`，V2 已迁。
  - 北京 workspace：供应商 `cb9de005…`，端点必须写完整的 `eb3630dd-bfbd-49ea-a460-b542a98eb354`，型号 `qwen-audio-3.0-realtime-plus`。
- 「156语音」一律拒绝：只要 ID 以 `8d1b5e3b` / `6b29cca6` / `156` 开头，供应商或端点都算。北京供应商下的其他端点也不迁。
- `discover`：
  - 每个端点会标出 `allowed`、`account`（`existing` = 新站已有这个账号；`import` = 要迁账号）、`targetModelKey` 和 `scopeEntry`。
  - 直接生成 `scope.json`，里面只有北京 workspace 一条，新服 `import-legacy-upstreams --prepare --scope-file` 可以直接用。
- `bindings`：
  - 查询时同时限定端点、供应商、型号。
  - 拿回的每一行再逐条核对一遍，有一行不对就不写文件。
  - 输出文件记 `targetModelKey`。
- `account`：
  - 只接受北京 workspace 这个完整端点 ID。
  - 加密流程与 2026-10-24 的语音账号导出相同：证书放在旧服内存文件里，导出器经 stdin 运行，旧服不落文件，本机只拿到密文。
  - 旧服的诊断输出只保留白名单字段。

**导入音色 `import-legacy-realtime-voices`**
- 默认映射 `qwen-audio-3.0-realtime-plus → qwen/qwen-audio-3.0-realtime-plus`，不用再加 `--map`。
- 新增「账号必须一致」检查：
  - 北京 workspace 的绑定只能迁到**已改挂北京 workspace 上游**的条目；
  - 公共端点的绑定也不能迁到挂北京 workspace 的条目。
- 原因：复刻音色只在创建它的那个账号里有效。
- 不一致时，预演显示 `ok: false` 并在 `wrongAccount` 里列出模型，正式执行直接报 `UPSTREAM_ACCOUNT_MISMATCH`。

**把 3.0 路由改挂北京 workspace：新增 `voice-catalog --attach-workspace <上游ID>`**
- 默认只预演。正式执行要加 `--apply --operator-id`，全程走服务层并写审计。
- 正式执行做这几件事：
  - 上游账号类型改成百炼 `dashscope`（如果不是）；基址从 `…/api` 改成 `…/api/v1`。审计：`upstream.updated`。
  - 条目路由整体换成这个上游一条，计费上限、启用状态沿用原主路由。审计：`catalog.updated` / `catalog.routes_replaced`。
  - 默认音色不对就换成官方的 `longanqian`。生产现在的 `Cherry` 不在 3.0 允许的 5 个音色里。
  - 如果条目以前在旧账号上复刻过音色（换账号后就失效了），必须加 `--drop-stale-clones` 才能执行，删除时写审计 `realtime_voice.clones_dropped`。
- 上游的主机名必须是 `ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com`，否则拒绝。
- 默认只改 3.0。也可以加 `--workspace-models qwen/qwen-audio-3.1-realtime-plus` 改 3.1。

**确认：按需复刻用的是路由所在的上游。** 复刻走 `withTarget(model)`，用条目的主上游；改挂以后主上游就是北京 workspace。

**适配器**
- 复刻地址：基址以 `/api`、`/api/v1`、`/compatible-mode/v1` 结尾都能换算出正确的 `/api/v1/services/audio/tts/customization`。
- 实时地址：`/api` 基址能换算成 `wss://…/api-ws/v1/realtime`。
- 两处都有单测。

### 2. 复刻费由用户承担（任务卡第 2 项，契约 4.6）

- **价格**：Omni 复刻成本 0.01 元/个，售价 0.013 元/个（1.3 积分）。
  - 目录 CLI 给两个 Omni 登记服务单价 `voice_clone`。
  - Qwen Audio Realtime（3.0 / 3.1）官方「创建音色免费」，所以不登记，也不向用户收费。
- **扣费流程**（媒体网关，`media-gateway.ts` 的 `authorizeClone`）：
  - 条目登记了 `voice_clone` 单价才收费。
  - 复刻前先冻结 1 个复刻费：用户付费、用途 `voice`、记角色与会话。
  - 成功：按 1 个结算，扣一次。
  - 失败或拿到的音色代号无效：
    - 请求还没发出就取消冻结；
    - 已经发出就按失败结算，用量 0、不上报上游，最后不扣钱。
  - 几通电话同时触发同一个角色的复刻时只复刻一次，只向发起复刻的那位用户扣一次。
- **余额不足**（冻结失败）：
  - 不复刻，也不进 10 分钟失败冷却，充值后马上就能复刻。
  - 模型有默认音色：照常用默认音色接通，不阻断。
  - 模型没有默认音色：拨打时提示「积分不足，暂时不能为这个角色准备实时通话声音，充值后再打」。
- **审计**：沿用 `realtime_voice.cloned`，`details` 新增 `billedTo`（`user` / `platform`）和 `chargedMicros`。
- **账单展示**：
  - 用户端：复刻费在「积分明细」里是一笔普通消耗，归在「角色 · 语音与图片」类，和同一天这个角色的通话费合在一组显示。
  - 后台用量记录：能看到 `voiceClones: 1`。
  - 没有单独的「复刻」字样，要显示的话需要另做网页改动，可选。

### 3. Realtime 3.1 Plus（任务卡第 3 项）

已按官方资料核实：

| 项 | 结论 | 出处 |
|---|---|---|
| 北京价 | 文字输入 5 / 音频输入 40 / 文字输出 40 / 音频输出 150 元/百万 token，与 3.0 Plus 相同 | https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-realtime-plus 、https://help.aliyun.com/zh/model-studio/model-pricing |
| 缓存命中价 | 官方页没写，按文字输入价计（不打折，偏保守） | 同上 |
| 协议 | 与 3.0 相同（WebSocket `/api-ws/v1/realtime`），只换 `model` 和音色 | https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-user-guides |
| 默认音色 | 3.1 是 `longanqian_v3.1`；3.0 是 `longanqian`，且 3.0 只接受 5 个系统音色 | 同上 |
| 复刻 | 支持，接口是 `voice-enrollment`（`target_model` 写 3.1），**创建音色免费** | https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide |
| Omni 复刻 | `qwen-voice-enrollment`，0.01 元/个，失败不收费 | https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning |

- 目录 CLI 新增 `--only qwen-realtime-3.1`：
  - 显示名「千问 Audio 3.1 Plus 实时通话」；
  - 挂公共百炼账号，默认停用，加 `--enable-realtime` 启用；
  - 可用 `--realtime31-voice` 换默认音色。
- Omni 仍然只有 3.5 Plus 和 3.8 Flash 两个。
- 3.0 的显示名统一为「千问 Audio 3.0 Plus 实时通话」。注意：只有重跑 `--only qwen-realtime --apply` 才会改名。

### 4. 后台「上架」报错（任务卡第 4 项）

**原因**
- 后台模型列表会逐行按契约 `AdminModel` 校验，不通过的行被藏起来，只显示「N 行数据不符合契约」，这些行也就没有上架按钮，所以没有任何 PUT 请求到达服务器。
- 契约里响应的服务单价单位是严格枚举。服务器一旦有页面不认识的计价单位，整行就判为不符合契约：
  - 后台前端镜像没有重建、或标签页一直没刷新时，旧页面不认识 4.5 的音频单位；
  - 4.5 的页面也不会认识这次新增的 `voice_clone`。
- 4.5 的 README 说过「新单位会被容忍」，但代码没有做到。

**修复**
- 契约：响应里的 `ModelServiceRate.unit` 改成容错枚举（不认识的值显示为 `unsupported`，写入时仍严格校验）；列表上限从 5 项放宽到 32 项。
- 后台：
  - 不认识的单位在列表里显示「新计价单位（刷新页面后显示）」；
  - 编辑抽屉只放认识的单价，不认识的不回写，服务器上原样保留；
  - 「上架 / 下架 / 删除」按钮补了阻止冒泡。之前点上架还会同时打开编辑抽屉，这是另一个顺手修的问题。
- 后台顶部新增版本提示条：打开页面时和之后每 5 分钟各查一次 `/health` 的契约版本，与页面版本不同就提示「请刷新页面」；查不到不提示。`vite` 开发代理也加了 `/health`。

**测试**
- `apps/admin/src/features/model/realtime-fixture.ts`：四个实时模型的服务端真实返回形状，按 `toAdminModel` 的输出逐字段照抄。
- `list-parse.test.ts`：复现测试。
  - **红**：把契约两处改动先撤掉时，2 项失败，报错 `serviceRates.2.unit: Invalid option`。
  - **绿**：恢复改动后全部通过。
- `realtime-models.test.ts`：四个模型按编辑抽屉的两种保存方式（token 计费 / 服务单价）都能通过 `AdminModelWrite`；上架 / 下架的请求体也能通过；附带版本提示条的判断逻辑。

## 契约变更说明（4.5 → 4.6，次版本号）

变更申请 `docs/architecture/2026-10-28-voice-clone-billing-contract-change.md` 已标为「已批准并实现」（总负责人代架构确认）。

| 位置 | 变更 | 兼容性 |
|---|---|---|
| `price-unit.ts` | `PriceUnit` 和 `ServicePriceUnit` 新增 `voice_clone`（元 / 个） | 只新增 |
| `ports/billing.ts` | `UsageQuantities` 新增可选 `voiceClones` | 只新增 |
| `http/model-access.ts` | 响应 `ModelServiceRate.unit` 改为容错枚举；`AdminModel.serviceRates` 上限 5 → 32 | 放宽 |
| `version.ts` | `CONTRACT_VERSION = '4.6'` | — |
| `README.md` | 4.6 变更记录 | — |

- 和申请的差异：申请第 4 条写的用途是 `voice_call`，但契约里没有这个用途，通话本身记的也是 `voice`，所以实现按 `voice` 记。
- 生成产物已同步：
  - `packages/contracts/generated/` 不进库，已本地重新生成；
  - 安卓 `Contracts.kt` / `contracts.json` 已改到 4.6。生成器把容错枚举输出为 `String`，安卓代码没有引用 `ModelServiceRate`，所以没有影响。
- 服务端：
  - 计费规则表新增 `voiceClones → voice_clone`（×1）；
  - 冻结幂等字段、服务单价发布 / 读取的单位白名单都加上了 `voice_clone`；
  - 能力映射：`voice_clone` 对应 `voice_output`。
- 价格表的单位列本来就是文本，所以**没有数据库迁移**。

## 改了哪些文件

**契约**
- `packages/contracts/src/{price-unit.ts, version.ts, ports/billing.ts, http/model-access.ts}`
- `packages/contracts/README.md`
- `packages/contracts/test/service-unit-pricing.test.ts`

**安卓生成产物**
- `apps/android/core/contracts-generated/src/main/kotlin/app/weiban/contracts/Contracts.kt`
- `apps/android/core/contracts-generated/src/main/resources/contracts.json`

**服务端：计费**
- `apps/server/src/modules/billing/domain/rules.ts`
- `apps/server/src/modules/billing/application/{reservations.ts, model-rates.ts}`

**服务端：模型接入**
- `apps/server/src/modules/model-access/application/{media-gateway.ts, realtime-voice-clone.ts, realtime-voices.ts, realtime-call.ts, models.ts}`
- `apps/server/src/modules/model-access/infra/dashscope-voice-clone.ts`
- `apps/server/src/modules/model-access/index.ts`
- `apps/server/src/app.module.ts`（余额不足的提示语）

**服务端：命令行工具**
- `apps/server/src/cli/{voice-catalog.ts, voice-catalog-options.ts, import-legacy-realtime-voices.ts}`

**服务端：测试**
- `apps/server/src/modules/model-access/application/realtime-voice-clone.test.ts`
- 新增 `apps/server/src/modules/model-access/application/realtime-voice-billing.test.ts`
- `apps/server/src/modules/model-access/infra/{dashscope-voice-clone.test.ts, dashscope-realtime.test.ts}`
- `apps/server/src/cli/voice-catalog-options.test.ts`

**导出脚本**
- `scripts/ops/export-realtime-workspace.mjs`
- `scripts/ops/export-realtime-workspace.test.mjs`

**后台**
- `apps/admin/src/features/model/{models.tsx, shared.ts, service-pricing.tsx}`
- `apps/admin/src/features/prices.tsx`
- `apps/admin/src/app/app.tsx`
- `apps/admin/vite.config.ts`
- 新增 `apps/admin/src/app/{contract-version.ts, version-banner.tsx}`
- 新增 `apps/admin/src/features/model/{realtime-fixture.ts, list-parse.test.ts, realtime-models.test.ts}`

**文档**
- `docs/architecture/2026-10-28-voice-clone-billing-contract-change.md`（状态改为已批准）
- 本交接

**没改**：其他模块的表、通话客户端协议、数据库迁移、web 用户端。

## 总负责人要跑的命令（按顺序）

「本机」指总经理这台电脑（有旧服 SSH 私钥），「新服」指生产服务器。新服 CLI 的运行方式与 V2 相同：

```
docker compose -p weiban-prod run --rm --no-deps -v /srv/weiban/migration:/migration app node dist/<命令>.js …
```

下面简写为 `app node dist/<命令>.js`。所有写库命令默认只预演，加 `--apply --operator-id <管理员UUID>` 才会写库并记审计。本机脚本默认只打印计划，加 `--run` 才连接旧服（只读）。

**第 0 步：发布本分支。**
- 没有数据库迁移。
- **确认后台前端（edge 镜像）也一起重建**。
- 发布后在后台按 **Ctrl + F5** 强制刷新。顶部不应出现「请刷新页面」的黄条，模型列表里不应再有「不符合契约」的提示。

**第 1 步：本机，查端点并生成 scope.json**（只读旧库，不读密钥）。用一个**新的空目录**，因为 V2 的目录里已经有同名文件，脚本只新建不覆盖。

```bash
node scripts/ops/export-realtime-workspace.mjs discover --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <本机新空目录>        # 只打印计划
node scripts/ops/export-realtime-workspace.mjs discover --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <本机新空目录> --run  # 执行
```

预期：
- `eb3630dd-bfbd-49ea-a460-b542a98eb354`：`allowed: true`，`account: "import"`，供应商 `cb9de005…`，绑定 213 条。
- `0975357a…`：`allowed: true`，`account: "existing"`，174 条，V2 已迁。
- `6b29cca6…`（156语音）：`allowed: false`。
- 目录里生成 `realtime-endpoints.json` 和 `scope.json`，`scope.json` 里只有北京一条。

**第 2 步：本机，导出北京 workspace 的绑定**（只读；音色代号不是密钥）。

```bash
node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <同一目录> --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354        # 计划
node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <同一目录> --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354 --run  # 执行
```

预期产出 `realtime-bindings.json`，按状态打印条数，总数 213，`targetModelKey` 为 `qwen/qwen-audio-3.0-realtime-plus`。

**第 3 步：上传。** 把 `scope.json` 和 `realtime-bindings.json` 传到新服 `/srv/weiban/migration/<批次>/`。

**第 4 步：新服，准备接收方**（ADR-20261023 通道）。

```bash
app node dist/import-legacy-upstreams.js --prepare --operator-id <管理员UUID> \
  --secret-root /migration/<批次>/receiver --scope-file /migration/<批次>/scope.json --backup-reference <备份回执>
```

把 `receiver.crt` 拷回本机，记下 `receiver.json` 里的 `recipientSha256`。**有效期 1 小时**，第 5、6 步要在这之内做完。

**第 5 步：本机，加密导出账号**（本机只拿到密文）。

```bash
node scripts/ops/export-realtime-workspace.mjs account --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <同一目录> \
  --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354 --receiver-cert <receiver.crt 路径> --receiver-sha256 <指纹>        # 计划
node scripts/ops/export-realtime-workspace.mjs account --ssh-key C:/Users/lomjy3/.ssh/weiban_old.pem --out-dir <同一目录> \
  --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354 --receiver-cert <receiver.crt 路径> --receiver-sha256 <指纹> --run  # 执行
```

产出 `realtime-account.cms` 和 `export-receipt.json`。下一步要用回执里的 `ciphertextSha256`。

**第 6 步：新服，导入账号。** 先把 `.cms` 上传到 `/migration/<批次>/`。

```bash
app node dist/import-legacy-upstreams.js --plan  --operator-id <管理员UUID> --batch-directory /migration/<批次>/receiver/<batchId> --packet /migration/<批次>/realtime-account.cms --expected-sha256 <ciphertextSha256>
app node dist/import-legacy-upstreams.js --apply --operator-id <管理员UUID> --batch-directory /migration/<批次>/receiver/<batchId> --packet /migration/<批次>/realtime-account.cms --expected-sha256 <ciphertextSha256> --backup-reference <备份回执>
```

记下新上游 ID。导入的账号默认是**停用**的，先不要启用，第 7 步会先改它的类型和基址。

**第 7 步：新服，把 3.0 改挂北京 workspace。**

```bash
app node dist/voice-catalog.js --attach-workspace <第 6 步上游ID>                                         # 预演
app node dist/voice-catalog.js --attach-workspace <第 6 步上游ID> --apply --operator-id <管理员UUID>      # 正式
```

预演要看的项：

| 项 | 预期 |
|---|---|
| `plan.upstream.kind` | 若导入时不是百炼，这里会出现 `{ from: …, to: "dashscope" }` |
| `plan.upstream.baseUrl` | `…/api` → `…/api/v1` |
| `models[0].fromUpstreamId` | 原来的公共上游 `2fed2a60…` |
| `models[0].defaultVoice` | `{ from: "Cherry", to: "longanqian" }` |
| `models[0].staleClones` | 应为 0（3.0 一直是停用的）。不是 0 时，正式命令要加 `--drop-stale-clones` |
| `problems` | 必须为空 |

**第 8 步：后台，测试并启用上游。** 在后台「上游账号」页找到这个账号，点测试，再点启用。测试不通过时见「遗留与风险」第 2 条。

**第 9 步：新服，迁入 213 条音色。**

```bash
app node dist/import-legacy-realtime-voices.js --input /migration/<批次>/realtime-bindings.json --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354                                       # 预演
app node dist/import-legacy-realtime-voices.js --input /migration/<批次>/realtime-bindings.json --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354 --apply --operator-id <管理员UUID>    # 正式
```

预演要看的项：

| 项 | 预期 |
|---|---|
| `ok` | `true` |
| `wrongAccount` | 空（不空说明第 7 步没做） |
| `missingModels` | 空 |
| `offered` | ready 的条数 |
| `importable` | 新库里也有这个角色的条数 |

正式执行只插入还没有的绑定，重复执行没有副作用。

**第 10 步：新服，登记 3.1 Plus**（停用，挂公共账号）。

```bash
app node dist/voice-catalog.js --only qwen-realtime-3.1                                         # 预演
app node dist/voice-catalog.js --only qwen-realtime-3.1 --apply --operator-id <管理员UUID>      # 正式（停用）
```

**第 11 步：新服，Omni 开始收复刻费。** 必须在第 0 步发布并刷新后台之后做。

```bash
app node dist/voice-catalog.js --omni-clone-price                                              # 预演：两个 Omni 补 voice_clone 0.013 / 成本 0.01
app node dist/voice-catalog.js --omni-clone-price --apply --operator-id <管理员UUID>           # 正式
```

**第 12 步：核对。**

```bash
app node dist/voice-catalog.js --show
```

- `realtime[]` 里 3.0 的 `upstream.name` 是迁入的北京 workspace 账号，`status` 为可用，`characterVoices.legacy` 等于第 9 步的 `inserted`，`defaultVoice` 是 `longanqian`。
- 两个 Omni 的 `clonePriceYuan` 是 0.013。`cloneSupplierCostYuan` 是累计供应商成本，等于已复刻个数 × 0.01。
- 3.1 已登记，停用。
- 审计只读查询：
  ```bash
  docker exec -i weiban-prod-postgres-1 psql -U weiban -d weiban -c "SELECT occurred_at, action, target_id, details FROM platform.audit_log WHERE action LIKE 'realtime_voice.%' OR action IN ('catalog.updated','catalog.routes_replaced','upstream.updated') ORDER BY occurred_at DESC LIMIT 30;"
  ```

**第 13 步：冒烟通过后在后台上架。** 3.0 / 3.1 现在可以直接在后台点「上架」。

## 冒烟清单

都用管理员账号，在「模型」设置的「语音通话」里选对应模型：

1. **后台**：「模型」页能看到四个实时模型，没有「不符合契约」提示；对每个模型点「上架 / 下架」都成功，并且不会弹出编辑抽屉；打开编辑抽屉直接保存也成功。
2. **3.0 迁入音色**（北京 workspace）：先上架 3.0，打给一个迁入了绑定的角色。声音应是角色自己的音色，接通不需要等待。
3. **3.0 按需复刻**：打给一个有声音样本、但没有迁入绑定的官方角色。
   - 第一通多半是默认音色 `longanqian`，因为 Realtime 的复刻音色要审核。
   - 审计出现 `realtime_voice.cloned`，`billedTo: "platform"`，`chargedMicros: 0`（官方免费，不收用户钱）。
   - 百炼控制台里，北京 workspace 的音色数加 1。
4. **Omni 复刻收费**（3.8 Flash）：用一个余额充足的账号打给一个没有复刻过的角色。
   - 审计出现 `realtime_voice.cloned`，`billedTo: "user"`，`chargedMicros: 13000`。
   - 积分明细里这个角色的「语音与图片」多了 1.3 积分。
   - 第二通不再扣复刻费。
5. **余额不足**：用一个余额为 0 的测试账号打给一个没复刻过的角色（Omni 有默认音色 Tina）。
   - 不复刻，也不扣复刻费。
   - 积分本来就不足，通话本身也会按原有规则提示积分不足。重点看的是没有产生复刻、审计里没有 `cloned`。
6. **3.1 Plus**：在后台上架 3.1，打一通。
   - 如果接通失败，或报无权限、模型不存在，说明公共账号用不了 3.1，见「需要总经理决定的事」。
   - 能接通的话，再看默认音色 `longanqian_v3.1` 是否正常。
7. **不残留冻结**：上面每通挂断后，钱包里没有残留冻结。

## 自测结果（开发自测，不是独立验收）

| 检查 | 结果 |
|---|---|
| `pnpm --filter @weiban/contracts typecheck` | 通过 |
| server typecheck | 通过（第一次发现 1 处类型收窄问题，已改） |
| admin typecheck | 通过 |
| ESLint `--max-warnings 0`（全部改动的 ts/tsx/mjs） | 第一次 2 处，已改，这两个文件复查通过：一处无用赋值；另一处是测试里写了 `dashscope.aliyuncs.com` 字面量，触发 R4 规则，已换成示例域名 |
| `pnpm lint:deps`（模块边界） | 通过 |
| server 相关单测（cli、billing、calls、ai-runtime 通话、model-access 全部 application / domain / infra） | 34 个文件、449 项通过 |
| contracts 单测（整包） | 85 项通过 |
| admin 单测（整包，含复现测试） | 5 个文件、21 项通过；复现测试先红（2 项失败）后绿 |
| `node --test scripts/ops/export-realtime-workspace.test.mjs` | 8 项通过 |
| 仓库根 `pnpm format:check` | 通过 |

- 需要 PostgreSQL 的集成测试（`apps/server/test/*.test.ts`）本机没有测试库，跳过了，以 CI 为准。
- 浏览器 e2e 也以 CI 为准。后台版本提示条在 e2e 里查到的 `/health` 版本与页面相同，所以不会显示，不影响现有用例。

## 遗留与风险

1. **公共账号能否用 Qwen Audio Realtime。** 官方文档给的 Realtime 地址示例都是 workspace 主机。3.1 挂公共账号可能不通，所以要冒烟确认。不通就有两个选择：保持停用，或者改挂北京 workspace，一条命令：`voice-catalog --attach-workspace <ID> --workspace-models qwen/qwen-audio-3.1-realtime-plus --apply --operator-id …`。
2. **北京 workspace 上游的「测试」可能不通。**
   - 原因：百炼类型的连通测试请求的是 `GET {基址}/models`，workspace 主机上 `/api/v1/models` 不一定有。测试不通时上游状态会一直是「不可用」，实时通话会被拒绝。
   - 备用办法：在后台把这个上游的基址改成 `https://ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，再测试。实时地址和复刻地址都只看主机名，换算结果不受影响，单测已覆盖。
3. **后台旧页面。** 发布前已经打开的后台标签页仍是 4.5，看到 `voice_clone` 时会把 Omni 行判为不符合契约，正是这次的原始问题。所以第 11 步必须放在发布并强制刷新之后。之后再新增计价单位，后台列表不会再整行隐藏，顶部也会提示刷新。
4. **价格版本页。** 价格条目（`PublicPriceItem` / `AdminPriceItem`）的单位仍是严格枚举，因为它同时用于请求，这次没改。同样需要刷新页面才认识 `voice_clone`。
5. **收费上的边界情况。**
   - 超过 20 秒的复刻：这一通先用默认音色，复刻在后台完成后仍然扣费，下一通开始用新音色。
   - 几位用户同时触发同一个角色的复刻时，只有发起复刻的那一位付费。
   - V2 期间已复刻的 Omni 音色不补收。
6. **重跑目录命令的影响。** 重跑 `voice-catalog --apply --only qwen-realtime` 会把 3.0 显示名改成「千问 Audio 3.0 Plus 实时通话」。上游账号会沿用已改挂的北京 workspace，不会被挂回公共账号。
7. **缓存命中价。** 3.1 的缓存命中价官方没写，按文字输入价计。对平台来说偏保守：缓存命中价通常更低，所以只会多收、不会少收成本。
8. **账单展示。** 积分明细里复刻费和通话费合在同一组显示，没有单独的「复刻」字样。如果要单独显示，需要派给 web 负责人。

## 需要总经理决定的事

- **3.1 Plus 如果公共账号用不了，要不要改挂北京 workspace？**
  - 改挂后，3.1 的通话费和复刻（免费）都走那个 workspace 所属的阿里云账号。
  - 建议：冒烟不通就改挂。3.0 本来就在那个账号上，管理更集中。
  - 公共账号能用的话，不需要决定。

## 给其他负责人的交接

- **总负责人**：按上面第 0～13 步执行。第 4～6 步要在 1 小时内做完。第 11 步必须在发布并刷新后台之后。
- **Codex（验收）**：
  - 复现测试在 `apps/admin/src/features/model/list-parse.test.ts`；
  - 计费逻辑测试在 `realtime-voice-clone.test.ts`（「V3：复刻费由用户承担」）和 `realtime-voice-billing.test.ts`。
- **web 负责人（可选）**：积分明细要单独显示「音色复刻」的话，可以按用量记录里的 `voiceClones` 区分。
- **运维**：每次发布都要重建后台 edge 镜像，否则会再次出现页面与服务器契约不一致。
