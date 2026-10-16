# 上限冻结后的对账一致性

主会话独立 C:\wb-dev\wb-points-reconcile / codex/points-reconciliation，基线562e6d6。原积分代理保留网关/媒体/报价/用途任务，此块只负责billing/charge-query、billing/reconciliation、model-access/reconciliation与BillingChargeQueryPort。

实查旧对账用Math.abs吞掉冲正符号，只比单条非absorbed成本，成功附带平台分摊被误报；仅补查当天完全没流水的调用，跨日期部分流水会漏。快照修复不能将部分成本/待核风险伪装成完整已知成本。

工程方案：兼容保留旧amountMicros但新增原流水有符号金额；端口按holdId提供权威settlement/release快照与账户类型。对账先按记录ID取齐全生命周期流水，以所有成本分量的代数和对比规范快照，平台旧吸收后结算使用规范售价，用户仅主扣费售价。失败已知零成本/未知释放即使无流水也可从权威快照修复，不把unknown变known。旧流水无规范快照只可保守标记待核，不造数。对账不改钱；真实成本与风险分别保留。

不新增迁移，不写跑测试套件；相关type/lint/build/静态依赖/契约生成完成后交原代理合入，再整体检查。无PG证据不能登记数据库对账通过，不先合主线或部署。
