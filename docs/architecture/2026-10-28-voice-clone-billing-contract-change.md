# 实时通话音色复刻费：契约变更申请（待批准）

日期：2026-10-28。提出：后端负责人（任务卡 `docs/tasks/2026-10-28-realtime-voice-on-demand.md` 第 2 项）。
状态：**申请中，未改契约**。批准前复刻费由平台承担，并逐次写审计留账。

## 背景

V2 起实时通话（Omni 实时 / Qwen Audio Realtime Plus）在角色第一次被打电话时按需复刻音色。百炼对复刻按「个」收费：
Omni 声音复刻 0.01 元 / 个，失败不收费（https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning）。

项目规则：后台消耗由用户承担，售价 = 成本 × 1.3。但现行契约 4.5 里没有能表达「复刻一次」的计价单位：

- `PriceUnit`（`packages/contracts/src/price-unit.ts`）只有 token、图片、万字符、分钟、搜索次数、音频 token；
- `UsageQuantities`（`packages/contracts/src/ports/billing.ts`）同样没有对应字段。

硬套现有单位（比如把复刻记成若干秒实时通话）会让对账口径失真，所以按规则先提申请，不擅自改契约。

## 申请内容（契约 4.6，只新增可选项，向后兼容）

1. `PriceUnit` 新增 `voice_clone`（元 / 个）；同时加入 `ServicePriceUnit`，后台模型表单的服务单价可登记它。
2. `UsageQuantities` 新增可选 `voiceClones?: number`（一次成功复刻 = 1）。
3. 计费口径：只对**成功**复刻扣费（与百炼一致，失败不收费）；冻结估算 1 个，成功后按 1 个结算，失败取消冻结。
4. 扣谁的钱：触发复刻的那通电话的用户（复刻发生在冻结第一段通话费之前，与通话费分开记一笔 `purpose = voice_call`）。
5. 默认售价：后台未登记 `voice_clone` 单价时**不收费**（平台承担，保持现状），不让用户因为缺价被拦在电话外。

## 批准前的临时做法（本次已实现）

- 复刻成本记为平台成本：`model_access` 审计 `realtime_voice.cloned`，`details` 含 `costYuan: 0.01`、`billedTo: "platform"`、模型与角色；
  `voice-catalog --show` 的 `realtime[].clonePlatformCostYuan` 汇总每个模型已复刻个数 × 0.01。
- 代码常量 `REALTIME_VOICE_CLONE_COST_YUAN`（`apps/server/src/modules/model-access/application/realtime-call.ts`）。
- 规模估算：每个「有声音样本的角色 × 实时模型」最多复刻一次（之后复用），上限约 488 × 3 ≈ 1464 个 ≈ 14.6 元，一次性。

## 批准后要做的事

- contracts：上述两处新增 + README 变更记录 + 版本 4.6。
- server：媒体网关复刻前 `reserve({ estimate: { voiceClones: 1 } })`、成功 `settle`、失败 `cancel`；`ServicePriceUnit` 校验接受 `voice_clone`。
- web 后台：服务单价表单出现「音色复刻（元 / 个）」。
- 审计里的 `billedTo` 改为 `user`。

## 需要决定

是否批准契约 4.6 新增 `voice_clone`；不批准则维持平台承担（金额很小，见上面估算）。
