# 缓存诊断、共用密钥与上下文对照

基线：`f9a22544f5156cbdec2d7d51956fb6ef2310751e`，2026-11-23重新获取远端main。独立分支：`codex/cache-diagnostics-and-context-20261123`。本轮是开发实现及自测，另有独立静态代码审查，不代表生产命中率验收。

## 问题与结论

用户观察爱语聊天缓存比例很高，并询问微伴多个用户、角色使用同一平台API key是否相互影响。共用key不是全局单个缓存槽；不同会话交错不能拿来做前缀稳定性比较。需要区分供应商分区/路由/过期，自己的前缀变化，以及包含后台任务的混合统计。

当前普通私聊已经按稳定头、原始历史、动态尾组装，日期和生态动态材料在尾部。共同经历已有按日冻结，新经历进入尾部。生态决策、碎碎念、日常模拟等通常独立调用，只有其产物通过记忆/自述等写回才能间接影响下一轮聊天头。每日一问也使用chat_reply，因此仅按purpose筛选不够。

## 这次修改

- 新增`TextUsage.cacheUsage`：reported / missing / invalid，显式0属于reported；历史未记录用notRecorded表示。两协议用量解析保留现有计费回退。
- OpenAI/Anthropic适配器在最终JSON序列化后、fetch之前把独立副本交给可选观察器；副本不含鉴权头，回调异常不阻断或改写发送。
- 网关按用户、角色、会话、用途、模型角色、会话类型、提示词模板隔离比较。比对范围是同一个进程中该工作负载上一次准备发送的请求，不跨用户比较。
- 指纹仅在内存中使用进程随机HMAC，限制512个工作负载、50000个消息指纹、每工作负载2048条；只比较20分钟内基线，过期基线在下次观察时清理。落库只有固定类别、计数、线路/模型/选项/缓存标识是否变化，不落正文、凭据、用户标识或指纹。
- 定位首处变化：头部章节（记忆、自述、关系、经历等）、历史移动、历史系统提示、旧消息变化、本轮/动态尾。no_system按可信原始系统头长度从实际合并user消息中识别头部，避免漏记memory变化。
- 复用`generation_attempts.reported_usage`和`bound_snapshot.promptCacheDiagnostic`，无迁移、无HTTP契约改动。
- 新增只读CLI，按purpose/model/upstream账号哈希/upstreamModel/conversationKind/promptTemplate分组；不读取或解密聊天表，不调用供应商。

## 使用

部署此分支后的自然流量才会产生新诊断字段。历史记录不会被回填成命中或未命中。

开发环境：

```bash
pnpm --filter @weiban/server exec node --import tsx src/cli/cache-usage-report.ts --hours 24 --limit 10000 --purpose chat_reply
```

已构建服务器目录：

```bash
node dist/cache-usage-report.js --hours 24 --limit 10000 --purpose chat_reply
node dist/cache-usage-report.js --hours 24 --limit 10000
```

时间范围1–168小时，最多50000条；达到上限输出truncated。第二条同时比较聊天、记忆、生态等用途。所有比率是0到1的小数。

| 字段 | 判断方式 |
| --- | --- |
| reportedCallCoverage / reportedInputCoverage | 先看供应商缓存字段覆盖了多少调用/输入量；覆盖低时不可把总体低值等同真正未命中 |
| reportedCacheHitRate | 只对有效上报的输入token加权，包括明确零命中 |
| allCallsCacheHitRate | 原有标准化用量口径，包含缺字段与估算样本，和上列同时看 |
| prefixObservations.firstChangedSection.memory | 同一工作负载的真实请求在记忆段首先变化；不等同已证明供应商缓存从这里失效 |
| prefixObservations.firstChangedSection.self_reports | 自述变化较早；例如每日一问写回 |
| prefixObservations.firstChange.history_window_advanced | 历史消息开头推进的候选，需与总结/容量事件核对 |
| prefixObservations.routeChanged / modelChanged | 配置账号、密钥、地址或模型发生变化；无法看穿中转内部账号和副本 |
| first_observation / unscoped / oversized / notRecorded | 没有可用的比较基线，不代表缓存未命中 |

每次重试有自己的usage记录；CLI每行用量只联接一次完成的文本attempt，不重复累计。比率仅限选定时间和数量的文本样本，并非整个账单。实际供应商tokenization、缓存块边界和KV状态无法由JSON指纹推算。

## 本轮没有改动的行为

本次只实施诊断。重要事实、明确承诺、手改/删除仍按现行规则立即生效；没有把所有记忆一律延迟，也未修改聊天提示词、模型参数、账号路由或账单算法。流式首段、沉浸式动作和生态原创私人动态属于后续独立工作。

生产部署后先用自然流量定位主要变化，再只处理证据充分的一处；不要为了99%冻结必须立即生效的更正、删除或关系状态。

## 验证

- 6个相关测试文件合计62项通过（供应商用量与适配器56项，最终请求比较6项）；合成数据，不调用付费供应商。
- 服务器TypeScript检查、改动代码ESLint、格式检查、生产构建和构建产物CLI帮助输出：结果见同批质量记录。
- 独立静态审查发现no_system章节定位P2，修复并针对复核通过；没有遗留已定位阻断项。
- 未运行真实数据库聚合查询，未读取生产私聊、供应商账单，未实测生产缓存比例。多进程、重启、内存淘汰会缺少前序基线；不把本地自测称作生产效果验证。
