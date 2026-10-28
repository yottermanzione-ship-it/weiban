# V3 实时通话收尾：北京 workspace 迁入、复刻向用户收费、Realtime 3.1、后台上架报错

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人（Claude） |
| 日期 | 2026-10-28 |
| 状态 | 已上线（待总经理冒烟后上架 3.0 / 3.1） |

## 目标

总经理 10-28 下午拍板后的四件事一次做完，让四个实时通话模型都能在后台正常上架、计费正确。

## 背景

- V2（`docs/tasks/2026-10-28-realtime-voice-on-demand.md`、`docs/handoffs/2026-10-28-realtime-voice-on-demand.md`）已上线 `40b0e14`：按需复刻、全部走公共百炼上游 `2fed2a60-eaaf-5571-9a59-7253830e76bf`、旧 Omni 174 条已迁入。
- 生产现状（10-28 15:10）：Omni 3.5 Plus、Omni 3.8 Flash 已由总负责人用 `voice-catalog --enable-realtime` 启用（默认音色 Tina）；`qwen/qwen-audio-3.0-realtime-plus` 挂公共上游、停用、默认 Cherry。
- **总经理拍板**：
  1. 旧服两个私有 workspace 里，「156语音」（供应商 `8d1b5e3b…`、端点 `6b29cca6…`，15 条）**不要**；要另一个「DashScope Beijing Workspace」（供应商 `cb9de005…`、端点 `eb3630dd-bfbd-49ea-a460-b542a98eb354`、型号 `qwen-audio-3.0-realtime-plus`、基址 `https://ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com/api`，213 条绑定）。按 ADR-20261023 加密通道只读迁入账号，再迁这 213 条。
  2. 复刻费**由用户承担**：0.01 元/个成本，按项目规则售价 = 成本 × 1.3（1 积分 = 0.01 元）。V2 的变更申请 `docs/architecture/2026-10-28-voice-clone-billing-contract-change.md` 视为已批准（总负责人代架构确认），按它改契约并升次版本号。
  3. 增加最新版 Realtime：`qwen-audio-3.1-realtime-plus`（官方模型列表「语音转语音」类）。Omni 保持 3.5 Plus 与 3.8 Flash 两个版本。
  4. 总经理在后台点「上架」实时模型时提示与契约有关的错误；生产日志里**没有任何 PUT 请求到达**，说明是后台前端在发请求前被拦下（`apps/admin/src/features/model/models.tsx` 的 `setEnabled` → `toWrite(m)` → client-core 按 `AdminModelWrite` 校验；或列表按 `AdminModel` 逐行校验失败把行藏起来，见 `list-parse.ts`）。总负责人用库里数据手拼请求体能通过 `AdminModelWrite`，所以要用服务端真实的 `GET /api/v1/admin/model/models` 返回形状复现。

## 输入文档

- 上面两份 V2 文档、`docs/handoffs/2026-10-26-voice-complete.md`（批 V 账号迁移步骤 3–5：`import-legacy-upstreams --prepare/--plan/--apply`）
- `docs/decisions/` 里 ADR-20261023（加密迁移通道）
- `scripts/ops/export-realtime-workspace.mjs`（account / bindings 步骤）、`apps/server/src/cli/import-legacy-realtime-voices.ts`、`voice-catalog*.ts`
- `packages/contracts/src/http/model-access.ts`（AdminModel / AdminModelWrite / 计价单位）
- 官方：[模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[实时多模态](https://help.aliyun.com/zh/model-studio/realtime)、[Omni 声音复刻](https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning)

## 范围

1. **北京 workspace**：导出脚本 account / bindings 步骤只允许 `cb9de005` 供应商下的 `eb3630dd…` 端点（以及已有的公共 Omni 端点），`8d1b5e3b`（156语音）一律拒绝；discover 输出能直接填 scope.json。导入后 Realtime 3.0 Plus 的路由改挂这个迁入的上游（给出 CLI 做法，带审计），213 条绑定迁进 `qwen/qwen-audio-3.0-realtime-plus`。按需复刻按路由所在上游复刻（确认如此）。
2. **复刻收费**：按变更申请改契约（新计价单位或等价做法）、价目、扣费与账单展示；余额不足时不复刻、退默认音色，不阻断通话；失败不扣费；审计照旧。Android 生成产物同步。
3. **Realtime 3.1 Plus**：核实官方北京价（分模态四项）、协议是否与 3.0 相同、是否支持复刻（哪个复刻接口），在目录 CLI 加登记项（默认停用，可 `--enable-realtime`），挂公共上游；查不到价格就停下写进交接，不要猜。
4. **后台上架报错**：用真实 `AdminModel` 返回形状写测试复现并修好，四个实时模型都能在后台上架 / 下架 / 编辑保存。

不可以改：其他模块的表、通话客户端协议；不 push、不合入、不碰任何服务器、不发真实付费调用。

## 验收标准

- [ ] 导出脚本：156语音被拒、北京 workspace 端点放行；`node --test` 更新通过
- [ ] 导入能把北京 workspace 的绑定映射到 `qwen/qwen-audio-3.0-realtime-plus`
- [ ] 复刻成功按售价扣用户一次、失败不扣、余额不足退默认音色；契约版本号升级并有测试
- [ ] 3.1 Realtime Plus 登记项（价格有官方出处）
- [ ] 复现后台上架失败的测试先红后绿
- [ ] server / contracts / admin typecheck、改动文件 eslint、相关测试各一次通过；`pnpm format:check` 通过

## 交付物

- worktree `C:/wb-dev/wb-voice3`、分支 `voice-v3`，基于最新 `local/trunk`（先 `git fetch origin` 确认含 origin/main）
- 交接：`docs/handoffs/2026-10-28-realtime-voice-v3.md`（含总负责人在本机与生产上要跑的确切命令和顺序、冒烟清单）
