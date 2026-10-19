# 质量问题登记

> 维护：Codex 质量负责人。以下是本会话前两轮审查的初始登记，不是某一开发任务的正式验收报告。
> 最新复核（2026-10-05）：主线 `7cb830e5df596f6ce919b65b5d62548da8eb9d08`，未合并 T-028 `f86e23f0f2811b46964970758decb058fc504a6a`。本表状态依据下文复核记录；原问题描述保留为历史证据。

| 编号  | 类别 / 优先级     | 问题与位置                                                                                                                 | 证据与建议                                                                                                                                                        | 状态                                 |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Q-001 | 实现缺陷 / 高     | `http/characters.ts` 的 `AdminCharacterWrite.partial()`、`http/identity.ts` 的 `UpdateProfileRequest` 在修改请求中补默认值 | 只传角色 name，解析后补 aliases/works/tags/fallbackGreetings 四个空数组；只传 nickname，补 gender=unspecified。建议修改请求不复用含默认值的创建 schema            | 已复核关闭（2026-10-05，范围见下文） |
| Q-002 | 协议设计风险 / 高 | `http/sync.ts` 的 getState 约定全量重建后取最新游标                                                                        | 拉完数据、取游标前的新更新可能被跳过；建议固定重建起点并补拉期间更新。尚无客户端实现可做端到端验证                                                                | 设计已修订，待同步实现端到端复核     |
| Q-003 | 实现缺陷 / 高     | `http/chat.ts` 的 MessageContent、`http/sync.ts` 的 UserUpdatePayload 不接受未知类型                                       | 未知更新使整页补拉响应及 WS 帧校验失败；不符合 README 的旧客户端降级约定。建议接收端增加兜底、发送端保持严格                                                      | 已复核关闭（2026-10-05，范围见下文） |
| Q-004 | 构建问题 / 中     | contracts 包未声明 Node 类型依赖，生成脚本使用 node:fs/path/url                                                            | 主线独立安装声明依赖后 typecheck 报 TS2307；T-011 根依赖已加入 @types/node，分支工作区 typecheck 通过。尚未合入主线，独立包依赖是否补齐交架构决定                 | 已复核关闭（2026-10-05，范围见下文） |
| Q-005 | 实现缺陷 / 中     | `scripts/generate-json-schema.ts` 不收集 EndpointDef 内部 schema                                                           | 导出只遍历顶层及 Events，遗漏接口内联 params/query/body/response；建议逐接口导出及保留路由信息                                                                    | 已复核关闭（2026-10-05，范围见下文） |
| Q-006 | 实现缺陷 / 中     | `http/characters.ts` 的 CharacterClassificationInput 缺少关联校验                                                          | real_person + realPersonKind=null、original + celebrity 都能通过；建议校验分类组合。未声称已证明系统权限绕过                                                      | 已复核关闭（2026-10-05，范围见下文） |
| Q-007 | 计费设计风险 / 高 | `docs/architecture/billing.md` 第 7 节的平台每日上限只统计已结算成本                                                       | 并发请求的在途成本未计入，可能一起通过上限检查；建议原子预留平台成本预算。尚无实现可运行验证                                                                      | 已复核关闭（2026-10-05，范围见下文） |
| Q-008 | 计费设计缺口 / 中 | billing 第 6.3/6.4 节、`events.ts` 的 BalanceRestored 只看可用余额跨零                                                     | 余额仍为正但小于冻结额时调用被拒；加余额后不跨零就无恢复事件，约定的待回复任务可能不触发。建议加余额后重新检查待回复任务                                          | 已复核关闭（2026-10-05，范围见下文） |
| Q-009 | 检查规则缺陷 / 中 | T-011 的 `packages/eslint-config/rules/billing-port-exit.js` 依赖变量名称并忽略计算属性                                    | ai-runtime/contacts 中声明 BillingPort 类型的 port 并调用 port.settle，ESLint 无任何错误；billingPort['estimateAndReserve'] 也漏检。建议类型/受控出口检查并补测试 | 已复核关闭（2026-10-05，范围见下文） |
| Q-010 | 实现缺陷 / 高     | identity 的 LoginThrottle.recordFailure 首次并发失败计数丢失                                                               | main 真实数据库：10 组分别并发 5 次，实际计数 1～3，无一锁定；需先建立计数行再加锁或原子更新                                                                      | 已复现，待 Claude 修复               |
| Q-011 | 实现缺陷 / 中     | billing.purge_user_account 删除 active holds 却不归还平台预算                                                              | main 经真实计费服务冻结后删除：holds=0，预算预留仍5000微元；expireHolds 无法回收；需同事务归还预算并协调在途调用                                                  | 已复现，待 Claude 修复               |

## 2026-10-05 复核记录

目标/关闭依据：`7cb830e5df596f6ce919b65b5d62548da8eb9d08`。完整审查及限制见 [L0 进度审查](2026-10-05-l0-progress-review.md)。原有自动测试264条全部通过，0跳过，服务器集成测试119条实际执行；另加两条缺陷复现失败，不与原有通过数混计。

- Q-001：角色更新与资料更新使用不补默认值的 schema；原始只传 name/nickname 的解析用例及 identity PATCH 集成测试通过，关闭原问题。
- Q-003：接收端对未知消息/更新类型的降级测试通过，发送端仍严格；关闭原 schema 拒绝问题，不代表尚未实现的客户端降级流程已验收。
- Q-004：contracts 已声明 @types/node，根及包内两套 tsconfig 检查通过，关闭原 Node 类型依赖问题。
- Q-005：生成器测试9条通过，检查接口内联 params/query/body/response 与路由信息，关闭原遗漏。
- Q-006：原错误分类组合解析拒绝、正确组合通过；关闭 schema 组合问题，不代表实际 policy 模块已验收。
- Q-007：PlatformBudget 用原子条件更新预留；billing 的多用户并发冻结预算测试通过，关闭原「只看已结算、不计在途」问题。Q-011 是独立的注销回收缺陷，不混为此项回归。
- Q-008：可用余额正数但低于冻结额时记录 insufficient_since，加余额发 topped_up_after_rejection；对应真实数据库测试通过，关闭原恢复事件设计缺口。待回复聊天任务尚未实现，未验证消费端。
- Q-009：边界检查已按受控引用限制，测试包含原类型化 port.settle 及计算属性绕过，均正确拒绝；关闭这两种已知绕过，保留项目登记的静态检查局限，不声称能证明所有动态调用安全。
- Q-002：getState 约定已改为先取起点 S，重建后从 S 补拉。关闭设计修改事项，但保留待同步实现端到端复核状态：main 尚无 sync 或客户端实现。
- Q-010/Q-011：源码与重跑命令见 [专项复现](reproductions/2026-10-05-l0-probes.md)；尚无修复 SHA，不能关闭。

## 现有验证记录

- 主线 v0.2 临时副本：按包声明依赖安装，typecheck 失败（Node 类型缺失）；generate 成功但接口内联定义遗漏；Q-001/Q-003/Q-006 已用实际 schema 解析复现。
- T-011 临时副本：冻结 lockfile 安装完成；format:check、lint、typecheck、19 个测试通过；另用独立输入复现 Q-009。已有测试通过不表示 Q-009 已覆盖。
- T-011 数据库：PostgreSQL 18.6、pgvector 0.8.7，开发库和 weiban_test 均可访问；专用测试容器停止重建后，测试记录仍在。临时目录的访问权限问题经调整临时副本权限消除，不记为仓库缺陷；测试容器和测试卷已清理。
- 上述检查未改动被审代码。Q-002/Q-007/Q-008 是设计检查发现，不是生产故障复现。

以上为初始审查历史记录；当前关闭状态以上表和2026-10-05复核记录为准。后续修复必须记录目标 SHA、复现结果和关闭依据；Q-010/Q-011 尚无修复 SHA，暂未关闭。

## 接续开发自测发现（非独立验收）

- Q-012（低，接收降级幂等）：2.0的unknownTypeFallback对已归一化的unsupported再次降级，缓存/嵌套schema第二次解析会把originalType覆盖为unsupported。T-034保留终态对象并由下游schema继续验证，新增消息/更新JSON缓存往返回归；修复自测后登记目标SHA，独立复核待交付。发送端仍只接受严格已知类型。

## 2026-10-20 多代理只读审查登记

目标 `main` 快照 `65bb669821909ac62239c5b140410d569a078411`，比较基线 `9b647d6228553cf8d1cec13557e310dc896179c5`。总报告见 [产品审查](product-acceptance.md)。以下均未修复，旧记录不覆盖、不自动关闭。

| 编号 / 板块编号 | 类型 / 优先级 | 问题、证据及归属 | 状态 / 详情 |
| --- | --- | --- | --- |
| Q-013 / CLI-001 | 实现缺陷 / P1 | 会员后台查询对象由 A 改 B 后，仍可向旧 loaded A 开通并发积分；真实目标 ID 展示缺失。静态调用链确认，未操作真实账户。旧状态设计已存在，v5 新增资金操作且削弱目标展示。 | 待开发处理；[客户端报告](product-clients-acceptance.md) |
| Q-014 / CLI-002 | 实现缺陷 / P2 | 新增情景模式 POST 缺必填 id；真实 schema safeParse 拒绝，基线既存，非 v5 新回归。 | 待开发处理；[客户端报告](product-clients-acceptance.md) |
| Q-015 / MEM-001 | 实现缺陷 / P2 | 后台默认模型缺失时仍回退聊天默认模型。原方法 AST 探针确认；基线既存，批 A 要求清理而未完成。 | 待开发处理；[会员报告](product-membership-acceptance.md) |
| Q-016 / MEM-002 | 实现缺陷 / P2 | 编辑当前聊天默认模型可去除 vision 且无默认识图兜底，仍进入保存事务。原方法探针及对照确认；错误行为基线已有，新保护覆盖不足。 | 待开发处理；[会员报告](product-membership-acceptance.md) |
| Q-017 / MG-01 | 实现缺陷 / P2 | 免费 7 天摘要过滤按月份放行，本月超期旧事仍带入；实际渲染函数探针确认，新档位功能缺陷。 | 待开发处理；[记忆报告](product-memory-growth-acceptance.md) |
| Q-018 / MG-02 | 实现缺陷 / P2 | 用户语音的转写保存在 media，新增加分订阅者只读消息 transcript=null，永不补分；实际 handler 与端口桩验证。 | 待开发处理；[记忆报告](product-memory-growth-acceptance.md) |
| Q-019 / MG-03 | 实现缺陷 / P2 | 按 0→10→1 秒乱序处理全部计分，突破 3 秒间隔，积分依赖投递顺序；实际函数验证，新加分规则缺陷。 | 待开发处理；[记忆报告](product-memory-growth-acceptance.md) |
| Q-020 / CHAT-001 | 实现缺陷 / P2 | message.updated 不更新持久消息却消费游标，卡片选择结果重开丢失；实际引擎与 JSON 往返复现，基线既存。 | 待开发处理；[聊天同步报告](product-chat-sync-acceptance.md) |
| Q-021 | 工程门禁 / P2 | 固定 SHA 的 format:check 退出 1，41 文件不合规。未运行格式修复，不推断全部为 v5 新增。 | 未通过；[公共检查](product-acceptance.md) |
| Q-022 | 工程门禁 / P2 | 固定 SHA 的 lint 退出 1，docs/web/ui-ledger-2026-10-18/build.mjs 的 relative 未使用；交接已披露，不冒称本轮新回归。 | 未通过；[公共检查](product-acceptance.md) |
| Q-023 | 测试门禁 / P2 | pnpm test 退出 1：321 通过 / 4 失败 / 368 跳过。失败为两项旧安全透支预期、密码强度预期及卡片服务替身缺方法；对应源码相对基线无差异，未独立跑基线，不判定为 v5 新回归。跳过不算通过。 | 未通过；[失败分析与原始日志](product-acceptance.md) |

风险与限制分开登记：会员开通 / 制作申请锁逆序（MEM-R01）尚无数据库复现；累计日摘要日期、最近 20 会话缺口检查及慢存储草稿等详见板块报告。真实数据库、浏览器、设备及供应商验收未执行，不计通过。现有 Q-010/Q-011 的开发修复声明没有替代本轮独立复核，不据此关闭。
