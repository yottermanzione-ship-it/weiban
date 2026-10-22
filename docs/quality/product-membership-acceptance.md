# 产品板块验收：会员 v5、积分分账与模型计价

> **总经理指令（2026-10-20）：仅留档，全部问题暂存冻结。任何人或代理（包括 Codex、Claude、开发负责人及子代理）均不得依据本报告启动、安排或执行修复，也不得自动派发修复任务。须等总经理后续明确授权，才能启动对应修复。文中的修复建议、给开发方的交接及复核说明仅供未来参考，不构成当前行动指令；本条优先于文中相关表述。**

## 范围与结论

- 日期：2026-10-20（北京时间）；审查人：Codex 并行审查子代理 membership_review。
- 目标：主代理固定的独立只读副本 `C:/wb-qa/review-20261020`，detached HEAD，完整 SHA `65bb669821909ac62239c5b140410d569a078411`。未切换共享目录分支。
- 比较基线：`9b647d6228553cf8d1cec13557e310dc896179c5`。本报告为目标 SHA 的产品规则验收，不以开发自测作为通过依据。MEM-001 的平台聊天回退原已存在；MEM-002 的错误配置原也可保存，新加保护未覆盖编辑当前默认模型。两项均登记为本批要求未完整落实，**不是新引入的行为回归**。
- 依据：`docs/README.md`、`quality/README.md`、`quality/issues.md`、`tasks/2026-10-19-v5-batches.md` 批 A、`handoffs/2026-10-19-v5-membership.md`、`refactor/16-membership-v5.md`、`backend/membership-v5.md`、`backend/model-routing-ecology-plan.md` 块 A、ADR-0032、`handoffs/2026-10-16-points-prehold.md`。
- **结论：不通过。** 已用原方法体的内存探针确认 2 个 P2 实现偏差；真实数据库、HTTP 权限、并发开通和迁移执行未完成验收。没有修复业务代码、契约或数据库。

## 逐项验收

“静态符合”只说明源码有相应实现，不等同运行时验收通过。

| 批 A 要求                                                         | 结果                   | 证据与限制                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 后台模型不借聊天模型；规划与报价统一                           | 不通过                 | MEM-001；规划 `resolve` 按 defaultFor=planner、报价复用 resolve，静态符合；识图配置保护另见 MEM-002。换模型界面提示在开发交接已明确未实现，不重复算新发现。                                                           |
| A2 售价/成本/缓存价；展示倍率不参与扣费                           | 未验证（静态符合）     | `model-access/application/models.ts` 经 BillingModelRatePort 存售价成本；display-pricing 按加权价算倍率；实际结算沿 billing 价目表。未对真实供应商用量/账单做核对。                                                   |
| A3 模型选择显示倍率与近 7 日每条积分                              | 未验证（静态符合）     | `display-pricing.ts` 查询成功、user、chat_reply 的近 7 日平均实扣，少于 20 样本用默认 token 假设，缓存 10 分钟。未做真实样本查询与浏览器点按。                                                                        |
| A4 月/季/年价格、任一档首次价一次、开通发积分、叠加到期、先扣赠送 | 未完成运行时验收       | `membership-orders.ts` 默认价格与赠送符合规则；钱包锁后判断首次价、唯一索引兜底，同一事务续期/赠送/订单/审计。168 个赠送余额纯函数样例及 3 个月末样例通过；幂等、并发、事务回滚和真实到账未验证。锁序风险见 MEM-R01。 |
| A5 注册赠送后台可调、默认 0                                       | 未验证（静态符合）     | 注册事件消费经 grantSignupBonus，signup_bonus:userId 幂等，bonusCredit=true；未实际注册或重放事件。                                                                                                                   |
| A6 删除旧档位无限量、其他用量功能无会员门槛                       | 未验证                 | 在本次会员入口未见旧无限量规则；未穷尽其他业务模块全部入口，不能据此宣称整产品无错误门槛。                                                                                                                            |
| A7 统一 PRO+ 判断                                                 | 静态符合，运行时未验证 | identity MembershipService.isProPlus 检查 active 与未来到期；growth 使用该端口。记忆/生态/外部渠道由其他板块验收，不由本报告代签。                                                                                    |
| A8 制作申请终身 3 次、PRO+ 每周 2 次、200 积分、拒绝/撤回归还     | 未验证（静态符合）     | quotaWithKind 优先 weekly，按北京时间周一起止，仅计 pending/in_progress/completed；create 用户级 advisory lock；付费经服务费冻结，结束后同步结算/释放，失败清扫补做。未运行数据库状态机与周界测试。                   |
| A9 权益对照、如实写积分与好感度                                   | 未验证（静态符合）     | membership.tsx 显示 Free/PRO+、需积分、联系管理员与赠送永久有效；当前源码读取记忆与制作配置；好感度实现已按 16 号 §11 更新为 2 倍，旧交接的 1.2 不作为当前错误。没有实际浏览器验收。                                  |
| A10 后台价格/赠送/倍率/制作配置                                   | 未验证                 | 存在对应契约、控制器与 Ant Design 表单；管理员鉴权装饰器引用 auth=admin，用户报价 auth=user，未实际发起 HTTP 验证 401/403 与服务可启动。MEM-002 为配置入口缺口。                                                      |
| 迁移 0103/0104/0105 与回滚                                        | 未验证（已静态审阅）   | 含 display_multiplier、赠送账户/流水与订单、免费次数类别；journal 有对应记录。0104 首次价部分唯一索引、订单全局幂等唯一约束存在；生命周期删除清单包含会员订单。未执行 up/down/恢复。                                  |

## 确认的实现问题

### MEM-001 / P2：未配置后台默认模型时仍回退聊天默认模型

- 基线区分：比较基线相同 fallback 表达式已存在。对基线在 userChat=null 时运行原 pick 方法，仍返回 platform-chat；本批删除用户聊天模型回退，但遗漏平台聊天模型回退。本项是遗留行为未按已接受要求消除。
- 位置：`apps/server/src/modules/model-access/application/resolver.ts:111-113`。
- 要求：`docs/backend/model-routing-ecology-plan.md` 块 A 第 1 条明确：未选后台模型则只用平台 defaultFor=background；平台也没有则任务失败、不换模型、不扣费。批 A 要求完成该块。
- 触发：用户 background=null，平台 defaultFor=background 不存在，但 defaultFor=chat 存在并可用；后台 memory/simulation 等调用使用 modelRole=background。
- 实际：pick 的空值合并仍求值 `catalog.defaultModel('chat')`，返回平台聊天模型；resolve 后续可正常执行并按该模型收费。删除用户聊天回退只完成了一部分，配置缺失时仍静默换模型。
- 独立证据：用 TypeScript AST 从原始文件提取 **原 pick 方法体**、transpileModule 后在 vm 运行，selection/catalog 均为内存替身，不连接数据库。输入上述场景输出：`defaultsRequested=["background","chat"]`，`result.facts.modelKey="platform-chat"`，`source="platform_default"`。Node 命令 exit 0。
- 影响：运营未配置后台模型时，后台任务仍可使用聊天默认模型消耗用户积分，违背配置缺失应停止的约定。
- 修复方向（未实施）：background 分支在无后台默认时返回空，由调用方按 not_configured 停止；复核同时覆盖 memory、simulation 与计费前拒绝。

### MEM-002 / P2：编辑当前聊天默认模型可绕过识图保护

- 基线区分：比较基线没有新增的聊天默认识图保护，原 upsert 对同一场景也进入事务；目标 SHA 新增保护可拦更换默认模型，却豁免当前默认模型。因此错误配置行为原已存在，本项属于新增保护覆盖不全，不称为新引入的识图回归。
- 位置：`apps/server/src/modules/model-access/application/catalog.ts:202-205`。
- 要求：批 A 交接与模型解析计划要求聊天默认模型没有 vision 时须有默认识图模型兜底。
- 触发：当前聊天默认模型 M 具备 vision；平台没有独立 defaultFor=vision。管理员编辑 M，保留 defaultFor=[chat] 并删掉 capabilities 中 vision（例如供应商改能力或改主路由）。
- 实际：校验末项要求“当前 chat 默认的 modelKey != body.modelKey”，当前默认恰好就是 M，因此错误配置被豁免，进入保存事务。随后带图调用无 vision、又无 vision 默认，resolve 返回 capability_missing。
- 独立证据：同样提取原 CatalogService.upsert 方法体；替身只屏蔽价格/数据库副作用。对照组 currentChat=other-model、待写 same-model 返回既定中文识图错误；实验组 currentChat=same-model 则到达 database.transaction 的探针哨兵 `REACHED_TRANSACTION_WITHOUT_VISION_GUARD`。Node 命令 exit 0。该证据只证明前置校验被绕过，未冒称真实数据库写入。
- 影响：管理端可以保存会让默认聊天识图失效的配置，保护只对更换默认模型生效，对原模型能力降级不生效。
- 修复方向（未实施）：按保存后的默认模型/能力整体校验，覆盖原模型能力修改以及默认识图模型撤销；复核保存后带图解析行为。

## 单独登记的并发设计风险

### MEM-R01 / P2 风险：收费申请制作与开通会员的用户/钱包锁顺序相反

- 开通：`billing/application/membership-orders.ts:195` 先锁钱包，`:215` 调 extendProPlus，后者在 `identity/application/membership.ts:92` 对 identity.users 加 UPDATE 锁。
- 收费制作申请：`plaza/application/role-requests.service.ts:252` → quotaWithKind `:175` → getMembership `identity/application/membership.ts:55` 对同一 identity.users 加 SHARE 锁；随后 `role-requests.service.ts:281` → `billing/application/service-fees.ts:60` 等待钱包锁。
- 可形成环：申请事务持用户 SHARE；开通事务持钱包 UPDATE、等待用户 UPDATE；申请事务再等钱包。`platform/db/database.ts:94-96` 回滚后直接向上抛错，没有事务重试。
- 影响：同一用户同时被后台开通/续期且提交收费制作申请时，一方可能死锁回滚。没有证据说明会重复记账或形成半笔事务，不作此推断。
- 状态：锁序已由源码确认，**未运行 PostgreSQL 并发探针**，因此与两个内存探针确认的实现问题分列，不登记为已复现数据库事故。建议开发后续统一跨模块锁顺序，并由独立审查者实际安排双事务复现。

## 检查证据、限制与历史区分

- 可复跑证据：[探针脚本](reproductions/2026-10-20-membership-probes.mjs)、[实际输出](reproductions/2026-10-20-membership-probes.txt)。在固定 SHA 的仓库根目录执行 `node docs/quality/reproductions/2026-10-20-membership-probes.mjs`，需安装仓库依赖且本地保留完整比较基线对象。脚本从自身位置定位仓库，无独立副本绝对路径依赖；包含两项方法探针的实验/对照与比较基线验证、168 个积分样例、3 个月末样例。完整脚本重跑 exit 0，输出 `all assertions passed`。这些是质量文档证据，不是业务测试新增。
- `git rev-parse HEAD` 输出完整目标 SHA；所有读取与探针均在独立副本执行。
- Node v24.21.0，TypeScript 使用该副本已安装依赖。通过 PowerShell here-string 管道给 Node，不创建测试源码、不启动服务器、不读取 .env、不连接远端。
- 探针方法：`ts.createSourceFile` 定位命名 class/function → 取原 AST 节点文本 → `ts.transpileModule(target=ES2022)` 去类型 → `vm.runInContext` → 内存依赖替身。原业务方法体未经改写；依赖均明确替身，因此不等同端到端测试。
- 原 `bonusDeltaOf`：遍历 balance=[0,50,100,200]，bonusBefore=[0,10,50,100] 中不大于 balance 的值，amount=[-200,-50,-1,0,1,50,200]，bonusCredit=[true,false]，168 个样例验证赠送非负、不超过非负总余额、正常扣款先扣赠送，exit 0。
- 原 `addBeijingMonths`：2026-01-31 加 1 月到 2026-02-28、2028 闰年到 02-29、2026-12-31 加 3 月到 2027-03-31，保留北京时间时分，3 例通过，exit 0。
- 纯函数探针首轮用 Node strictEqual 比较 0/-0 时触发断言；这是探针对数值相等的判断错误，修正断言为数值 `===` 后通过，未改业务函数。不得把该首轮探针错误登记为资金缺陷。
- 本代理未运行数据库/HTTP/迁移/完整测试套件；统一依赖、构建及测试结果由主代理整体报告登记。本报告不依赖交接中开发方通过声明。
- `quality/issues.md` Q-010 登录失败并发与 Q-011 注销平台预算已有历史登记，不当作本批新问题；本范围没有独立复核关闭。赠送余额未纳入对账、退款转充值分布、识图换模型界面提示缺失、身份类权益缺失为会员交接已有遗留，未重复编号为新增。
- 后续交接：开发方处理 MEM-001/MEM-002，补充真实迁移、开通幂等/并发、赠送积分扣减/对账、注册赠送与申请制作周界及取消拒绝的运行证据；独立审查者按修复完整 SHA 追加复核。本次没有执行修复。
