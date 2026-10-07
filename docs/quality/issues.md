# 质量问题登记

> 维护：Codex 质量负责人。以下是本会话前两轮审查的初始登记，不是某一开发任务的正式验收报告。
> 最新复核主线：`f0ae228`；骨架分支：`T-011-repo-skeleton`，`555436e`。这些短 SHA 用于定位历史审查；后续正式验收记录完整 SHA。

| 编号 | 类别 / 优先级 | 问题与位置 | 证据与建议 | 状态 |
|---|---|---|---|---|
| Q-001 | 实现缺陷 / 高 | `http/characters.ts` 的 `AdminCharacterWrite.partial()`、`http/identity.ts` 的 `UpdateProfileRequest` 在修改请求中补默认值 | 只传角色 name，解析后补 aliases/works/tags/fallbackGreetings 四个空数组；只传 nickname，补 gender=unspecified。建议修改请求不复用含默认值的创建 schema | 待修复 |
| Q-002 | 协议设计风险 / 高 | `http/sync.ts` 的 getState 约定全量重建后取最新游标 | 拉完数据、取游标前的新更新可能被跳过；建议固定重建起点并补拉期间更新。尚无客户端实现可做端到端验证 | 待修复 |
| Q-003 | 实现缺陷 / 高 | `http/chat.ts` 的 MessageContent、`http/sync.ts` 的 UserUpdatePayload 不接受未知类型 | 未知更新使整页补拉响应及 WS 帧校验失败；不符合 README 的旧客户端降级约定。建议接收端增加兜底、发送端保持严格 | 待修复 |
| Q-004 | 构建问题 / 中 | contracts 包未声明 Node 类型依赖，生成脚本使用 node:fs/path/url | 主线独立安装声明依赖后 typecheck 报 TS2307；T-011 根依赖已加入 @types/node，分支工作区 typecheck 通过。尚未合入主线，独立包依赖是否补齐交架构决定 | 部分解决，待合入复核 |
| Q-005 | 实现缺陷 / 中 | `scripts/generate-json-schema.ts` 不收集 EndpointDef 内部 schema | 导出只遍历顶层及 Events，遗漏接口内联 params/query/body/response；建议逐接口导出及保留路由信息 | 待修复 |
| Q-006 | 实现缺陷 / 中 | `http/characters.ts` 的 CharacterClassificationInput 缺少关联校验 | real_person + realPersonKind=null、original + celebrity 都能通过；建议校验分类组合。未声称已证明系统权限绕过 | 待修复 |
| Q-007 | 计费设计风险 / 高 | `docs/architecture/billing.md` 第 7 节的平台每日上限只统计已结算成本 | 并发请求的在途成本未计入，可能一起通过上限检查；建议原子预留平台成本预算。尚无实现可运行验证 | 待修复 |
| Q-008 | 计费设计缺口 / 中 | billing 第 6.3/6.4 节、`events.ts` 的 BalanceRestored 只看可用余额跨零 | 余额仍为正但小于冻结额时调用被拒；加余额后不跨零就无恢复事件，约定的待回复任务可能不触发。建议加余额后重新检查待回复任务 | 待修复 |
| Q-009 | 检查规则缺陷 / 中 | T-011 的 `packages/eslint-config/rules/billing-port-exit.js` 依赖变量名称并忽略计算属性 | ai-runtime/contacts 中声明 BillingPort 类型的 port 并调用 port.settle，ESLint 无任何错误；billingPort['estimateAndReserve'] 也漏检。建议类型/受控出口检查并补测试 | 待修复 |

## 现有验证记录

- 主线 v0.2 临时副本：按包声明依赖安装，typecheck 失败（Node 类型缺失）；generate 成功但接口内联定义遗漏；Q-001/Q-003/Q-006 已用实际 schema 解析复现。
- T-011 临时副本：冻结 lockfile 安装完成；format:check、lint、typecheck、19 个测试通过；另用独立输入复现 Q-009。已有测试通过不表示 Q-009 已覆盖。
- T-011 数据库：PostgreSQL 18.6、pgvector 0.8.7，开发库和 weiban_test 均可访问；专用测试容器停止重建后，测试记录仍在。临时目录的访问权限问题经调整临时副本权限消除，不记为仓库缺陷；测试容器和测试卷已清理。
- 上述检查未改动被审代码。Q-002/Q-007/Q-008 是设计检查发现，不是生产故障复现。

后续修复必须记录目标 SHA、复现结果和关闭依据；暂未关闭以上问题。

## 接续开发自测发现（非独立验收）

- Q-012（低，接收降级幂等）：2.0的unknownTypeFallback对已归一化的unsupported再次降级，缓存/嵌套schema第二次解析会把originalType覆盖为unsupported。T-034保留终态对象并由下游schema继续验证，新增消息/更新JSON缓存往返回归；修复自测后登记目标SHA，独立复核待交付。发送端仍只接受严格已知类型。
