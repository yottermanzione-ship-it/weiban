# ADR-0017 计费模块落地后的三项架构决策：缺价检查归属、第 ② 层对账的分工、统一的管理员提醒

| 项 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-10-06 |
| 提出人 | 架构负责人（T-026，评审后端 T-023 的 6 条申请） |
| 批准人 | 架构负责人 |
| 关联 | ADR-0004（模块边界与事件）、ADR-0012（计费）；`docs/architecture/billing.md` v1.4 第 4.1、5.2、8.2、8.4 节；契约 1.3 |

## 背景

billing 模块（T-023）实现后，后端提出 6 条申请。其中 3 条只是「补一个只读方法 / 可选字段」，直接批准（批量取用户名、按用量记录或日期查扣费、结算与解冻带上游 ID）。另外 3 件事牵涉模块边界，需要定方案：

1. 设计要求「发布价目表时，模型目录里启用的模型缺少价格 → 422」，但 billing 看不到模型目录：依赖方向只允许 model-access → billing（ADR-0012），billing 不能反过来调用 model-access。
2. 对账第 ② 层（用量记录 ↔ 扣费）要同时看两个模块的数据，而对账结果页面在 billing。
3. 平台预算到 80%、对账异常、上游余额用完 / 密钥失效都需要「通知管理员」，契约里没有这个东西，各模块不该各造一套。

另有两处实现偏差请架构确认：流水只增不改用触发器而不是撤销权限；价目表不支持预约生效。

## 方案对比

**1. 缺价检查放在哪**

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. model-access 提供「列出启用模型」端口，billing 发布时调用 | 规则留在原处 | 同层双向调用 → 循环依赖（R11 直接拦下） |
| B. 装配层 / 管理后台接口层先查目录再调 billing | 不改依赖方向 | 业务规则放进了不该有逻辑的地方；绕过管理后台直接调接口就失效 |
| **C. 改由 model-access 在「启用模型」时查价（调 billing 只读端口），管理后台发布前对照提示，冻结时 `price_missing` 兜底** | 依赖方向不变；真正危险的「免费调用」已被冻结步骤挡住 | 发布价目表时漏了某个启用模型，服务器不会拒绝，只靠管理后台提示和调用时报「模型不可用」 |

**2. 第 ② 层对账谁做、结果放哪**

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. billing 跨 schema 读用量记录 | 简单 | 违反「只有拥有者能读写自己的表」（ADR-0004） |
| B. model-access 比对，结果存在 model-access，管理后台分别读两处 | 不违规 | 对账页要拼两处数据；同一天的对账结论分散 |
| **C. model-access 用 billing 只读端口取扣费并比对，结果用事件 `model_access.usage_reconciled` 交回 billing，写进当天的对账记录** | 不违规；对账页只读 billing 一处；事件至少一次投递，不丢 | billing 订阅了同层 model-access 的事件（允许，事件不构成代码依赖）；两个定时任务有先后（3:30 / 3:45），需处理「先到后到」 |

**3. 通知管理员**

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 各模块自己存、自己推 | 各管各的 | 重复造推送与合并规则；管理后台要拼多处 |
| B. 平台内核建「管理员提醒」表和服务 | 任何模块都能直接用 | 内核只放基础设施，不是业务模块（`overview.md` 模块表），不放业务规则 |
| **C. 统一事件 `platform.admin_alert_raised`（任何模块可发），push 订阅、存列表、推送** | 符合「所有通知经过 push」（overview）；合并、频率规则只写一处；发出方不依赖 push 是否上线 | push 在 L1 才实现，之前的提醒只留在审计和日志里 |

## 结论

1. 缺价检查选 **C**。契约 1.3 新增 `BillingChargeQueryPort.listActivePricedModelKeys`；`activatePriceVersion` 说明中去掉该 422。
2. 第 ② 层对账选 **C**。契约 1.3 新增 `BillingChargeQueryPort.getChargesByUsageRecordIds` / `listChargesByDay`、事件 `model_access.usage_reconciled`、`ReconciliationRun.usageReconciledAt` / `usageAmountMismatch`。
3. 管理员提醒选 **C**。契约 1.3 新增事件 `platform.admin_alert_raised`、`AdminAlert*`、`PushAdminEndpoints`、通知种类 `admin_alert`，以及 identity 的 `IdentityDirectoryPort.listAdminUserIds`。
4. 两处偏差**都认可**：流水只增不改用触发器（对表所有者同样生效，比撤销权限更可靠；拆分数据库账号后再加权限锁，TD-027）；价目表首版不支持预约生效（TD-026）。
5. 新增的端口方法都放在**新接口**里（`IdentityDirectoryPort`、`BillingChargeQueryPort`），不往已有接口里加方法：已有实现类 `implements` 旧接口，往里加方法会让它们编译失败，与 1.2 的做法一致。

## 代价

- 缺价只在「启用模型」时被服务器拒绝；发布新价目表漏掉启用模型时只有管理后台提示，漏网的调用表现为「模型暂时不可用」（不产生费用）。若这种情况实际发生过，再评估让 billing 维护一份「启用模型」的只读投影（订阅 model-access 的目录变化事件，ADR-0004 允许）。
- 对账结论依赖两个定时任务和一次事件投递；第 ② 层没有结果时 `usageReconciledAt = null`，管理后台必须显示「第 ② 层未完成」而不是「无异常」。
- push 上线（D-L1-05）之前，管理员提醒只能从审计日志和错误日志看到，运维告警要覆盖这些日志。
