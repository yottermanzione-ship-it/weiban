# ADR-0024 L4～L7 模块归属与契约 3.0

| 项 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-10-09 |
| 提出人 | 架构负责人（T-062） |
| 批准人 | 架构负责人 |

## 背景

总经理要求 L4～L7 一次性并行开发（39 张卡 T-063～T-101）。各卡把「玩法数据放哪」「通话归谁」「关系网在哪」写成「以契约为准」，需要一次定死；同时契约要一次覆盖 L4～L7 全部接口，避免边开发边改。

## 方案对比

| 问题 | 方案 A | 方案 B | 选择 |
|---|---|---|---|
| 5 个玩法（每日一问、心愿清单、慢信、专注、提醒）的数据 | 放进 ai-runtime（AI 建议：它们驱动角色主动行为） | 新建上层模块 `play`，ai-runtime 订阅 `play.*` 事件、经 `PlayAgentPort` 回写角色的话 | B：ai-runtime 已经很大；玩法本身是表单、清单、计时，不需要 AI；按钮、计时、到点提醒都不调用模型，放 play 更清楚，也便于注销删除清单 |
| 语音通话会话 | 放进 ai-runtime | 新建中层模块 `calls` 管会话、信令、音频 WebSocket、通话记录；「角色怎么听怎么说」由 ai-runtime 实现契约里的 `CallAgentPort`，组合根注入 | B：保持「聊天 / 会话模块不知道 AI」；见 ADR-0025 |
| 关系网 | 新模块 | 留在 characters（overview.md 已规划 `relations` 表） | B |
| 宠物、卡片、成就 | 新模块 | 归 growth（overview.md 已规划） | B |
| 群聊、搜索、卡片按钮 | 新模块 | 归 chat（群聊本来就是 chat 的会话类型；搜索见 ADR-0027） | B |
| 表情包、音色、卡面模板 | 各业务模块 | 归 media 素材库（dev-plan D-L5-01）；宠物图鉴归 growth，题库归 play | B |
| 契约版本 | 2.6 次版本 | 3.0 主版本 | 3.0：给 `MediaObject.purpose`、`AdminCatalogEntry.defaultFor`、`UpstreamKind` 等响应枚举新增取值，按版本规则属于主版本；同时把 `MediaObject.purpose` 改为接收端容错 |

## 结论

- 新模块：`calls`（中层）、`play`（上层）；以及早已规划的 `moments`、`library`、`importer`、`plaza`（上层）。`ModuleName` 新增 `health`、`calls`、`plaza`、`play`。
- 上层模块之间只允许单向依赖：plaza → ai-runtime（检测端口）、importer → ai-runtime（分析端口）、ai-runtime → moments / growth / play（读写端口）。反方向一律用事件。
- 契约版本升为 3.0；只新增，不删除或改变已有字段含义，旧客户端照常工作。
- 每张卡对应的契约文件、端口、迁移号段以 `docs/architecture/contracts-3.0-map.md` 为准。

## 代价

- 模块数量增加，运维 lint 规则要登记新模块（T-101）。
- `CallAgentPort` 是依赖反转，接口在契约、实现在 ai-runtime，组合根要注意绑定顺序。
- 3.0 只是版本号的主版本，服务器的 `minClientVersion` 仍为 2.0，不强制旧安卓升级。
