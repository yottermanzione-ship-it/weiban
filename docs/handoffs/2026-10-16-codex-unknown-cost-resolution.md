# 未知费用人工核实闭环

主会话独立副本C:\wb-dev\wb-unknown-resolution，codex/unknown-cost-resolution，基线5061acf，任务79a0683、代码WIP8d5605c。供原积分分支合入后统一生成/检查，不单独部署，不冒称独立验收。

新增管理员鉴权POST成本核实；非负安全整数微元、HTTPS凭证与原因必填。同hold一次核实，相同内容幂等重试，不同内容拒绝；账户→平台→hold→具体路由→预算串行、账不一致拒绝、事务原子保存差额/权威快照/风险释放/审计/outbox。用户既有金额不能追扣。成本超过原上界仍可按真实凭证记账，不把原风险当实际费用。

平台成功任务售价与成本独立：用现有adjustment/amount0追加成本修正，保留charge唯一索引；UsageCharge.costCorrection只读标记防止对账算第二笔主扣费。用户/失败平台成本差走absorbed charge，可负差额。供应商成本查询纳入精确前缀修正；账单按关联hold原创建日归期，避免事后核实全掉进核实日。原流水不改，无新迁移。用量事件仅同步正确hold和结束状态，pending则重试，注销不重建；旧costKnown=false快照不能覆盖已核true。

源码推导（非PG运行）：用户原0→核实成本80，用户不动、平台成本/余额分别+80/-80；平台成功原售价0/部分成本100→核实成本30，追加余额0/成本-70，规范售价仍0、总成本30，不能产生负售价；同成本0差额不写无意义流水但仍写审计与风险状态。

开发自查：contracts/server typecheck通过（最终server94468）；12文件eslint、追加改动相关lint；depcruise389模块1688依赖通过；server build通过。整批契约/Android资源由原代理最后生成（本任务新增1管理端点/1事件）。无新产品UI，本任务没有GUI验证要求；原积分UI由主会话在原副本实际点按，证据由原任务登记。

没有PG/迁移/真实HTTP/真实账单、并发/跨日/事件重放运行证据；操作与上线前手工核验要求见docs/ops/unknown-cost-resolution.md。仅保存凭证链接不验证其真实性，必须管理员先核实；旧无快照/调用关联拒绝，仍需另行审查。目录不自动重启。

补充来源审查：released核实后极迟成功settle沿用人工凭证成本，不能重新被用量/价目表推算覆盖；resolved事件读当前权威关闭快照，处理released→settled变化，状态竞态则重试。金额事件中的原快照仅作事件记录，不作为后来状态的覆盖来源。

该补充的server typecheck25469、2文件eslint、server build通过；depcruise389模块1689依赖通过。仍无真实PG竞态证据。
