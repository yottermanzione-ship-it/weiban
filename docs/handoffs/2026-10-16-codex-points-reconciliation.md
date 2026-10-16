# 上限冻结、成本分摊与冲正：对账配套

主会话独立 C:\wb-dev\wb-points-reconcile / codex/points-reconciliation，基线562e6d6，任务fe24973，业务WIP df81253、d6119d4。只供原积分分支安全合入，不先合主线、不部署。不写/跑测试套件，不登记独立验收。

## 改动

- UsageCharge兼容旧amountMicros，新增signedAmountMicros（原流水余额变动，扣负/冲正正）及holdId；实际对账采用符号，单流水cost允许负数。BillingChargeQueryPort新增可选getBillingStatesByHoldIds（最多1000，生产提供方已实现），读规范settlement/release、账户类型和关联用量。缺该方法时新对账明确不可用，不假装运行通过。
- model-access按本日结束记录ID取齐所有日期的流水，不再只补完全无当日流水的记录。比较全部成本分量代数和、用户主扣款/平台含旧吸收后的规范售价、主ledger关联、已核状态与待核上界；成功的absorbed分摊是正常情况，失败不得主扣款。缺主扣款只算缺扣费，不再重复算金额不一致。
- 缺快照优先从billing关闭快照修复；失败零成本/未知释放没有ledger也可修复，保留costKnown=false/风险上界。历史无规范快照重建时一律不冒称已核成本。只修副本，不改余额或原账本；对已存在的金额不一致仍报警、不自动改钱。
- 上游账单遇未知hold（包括上界0）仍标待核，风险不计入实际成本。ReconciliationRun增加可选待核笔数/风险上界与netComputedCostMicros、netAbsorbedMicros有符号净额，旧非负字段保留兼容。AdminLedgerEntry.costMicros放宽至整数nullable，允许合法负成本冲正。后台展示待核解释及净额，未知不能写“全部正常”。没有新表/迁移。

源码推导口径例（不是数据库运行证据）：理论售价100/实收60/成本80，用户成本48+平台32=80；平台曾吸收50、迟到实际售价40/成本30，新主流水余额+10/成本-20，合旧流水净售价40、成本30。不能对+10取abs后再相加，也不能把少收的售价当成本。

## 开发自查与限制

server/admin/contracts typecheck、相关6文件eslint、depcruise（387模块/1679依赖）、server/admin build、contracts3.16生成通过（本副本406接口，未包含稍后独立生态notice端点，原代理最终合并后统一生成/Android检查）。构建有既有chunk提示，无构建失败。

真实浏览器操作BillingPage，API为本地模拟：查询首次失败保留原范围、重试显示；未知账单偏差0仍明确1笔待核/风险上界未计实际成本；负冲正显示¥-0.2000；无新字段旧响应可显示；原生日期控件修改后请求from=2026-10-13。Playwright date fill初次未生效，改用原生setValue后核对实际请求，未把初次当成功。3张PNG、查询JSON、空错误/警告console在docs/web/points-reconcile-2026-10-16。

没有PG/迁移/真实HTTP/真实供应商账单运行证据；跨午夜、并发关闭、部分流水、快照缺失修复仅源码推导和编译，后续需真实环境手工验证。每日多条只读查询不是全库同一快照，正有迟到冲正时可被下一次重跑纠正，不声称强一致在线总账。真实unknown清风险/人工凭据流程仍属积分分支，不能从本次页面模拟推断完成。

恢复：复制同目录两个.fixture.txt到apps/admin/recon-preview.html/tsx，运行admin Vite5204；临时浏览器已关闭。两个恢复源文件留未跟踪，不进入产品入口；原5190样例不动。原代理合入后统一检查全部网关/媒体/平台调用/契约资源。
