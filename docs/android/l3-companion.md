# 安卓 L3：你不在时、时间线、熟悉度、主动消息、经期日记

负责人：android-lead · 2026-10-10 · 状态：**未编译、未测试**（本机不编译，按总经理要求）

## 位置

| 功能 | 代码 | 入口 |
|---|---|---|
| 「你不在时」卡片 | `feature/chat/.../WhileAway.kt` | 进入私聊时自动出现（在标题栏下方） |
| TA 的近况（时间线） | `feature/chat/.../CharacterTimeline.kt` | 聊天信息 ›「TA 的近况」 |
| 认识天数、熟悉度、纪念日 | `feature/chat/.../Familiarity.kt` | 角色资料页头部（按设计与总负责人裁定，不放聊天信息页） |
| 单角色主动消息、TA 的日常 | `feature/chat/.../ChatInformation.kt`（`InformationProactive`） | 聊天信息 ›「和 TA 的相处」 |
| 全局主动消息开关与默认频率 | `feature/me/.../ProactiveDefaultsPage.kt` | 我 › 服务 › 主动消息与免打扰 |
| 经期日记 | `feature/me/.../PeriodState.kt`、`PeriodDiary.kt`、`PeriodPages.kt` | 我 › 服务 › 互动玩法 › 经期日记 |
| 本机小标记 | `core/data/.../LocalFlagStore.kt`（`SessionRepository.flags`） | — |

## 规则

- **本机标记**存在 Room 的 `cache` 表（键前缀 `flag:`），换账号时随缓存一起清空。用到三个：`lastActive:<会话>`（上次在该私聊的时刻）、`whileAway:<会话>:<时刻>`（这段缺席的卡片已展开过）、`health:noticeAcknowledged`（经期说明已确认）。
- 「你不在时」：只认服务器 `summary`；为空、失败或 2 秒超时都不显示；同一段缺席只自动展开一次，之后只留「TA 的近况」胶囊；系统返回键先收起卡片；心情不显示；「问问 TA」只预填不发送。
- 时间线用 `DailyEventEndpoints.listByCharacter`（契约 3.0 的 `listTimeline` 服务器未实现，网页同样退回此接口）。
- 熟悉度只显示服务器给的数；进度 = `pointsInLevel / pointsToNextLevel`（后端里 `pointsToNextLevel` 是本级跨度）。
- 主动消息：乐观更新，失败退回；全局总开关关闭时单角色开关禁用并提示。
- 经期日记：所有健康接口都用 `networkOnly`，**不写入本机响应缓存**；预测处始终显示服务器 `disclaimer`；409 显示「这段日期与已有的经期记录重叠」；删除 204 正常处理；一键清空按契约连授权、周期设置一起删除，并恢复首次说明页。
- 标为经期的日子不在已有经期里时：紧接上一次经期的结束日则延长；否则新建一次（过去日期把结束日设为当天）。取消「在经期中」：是开始日则确认删除整次经期，否则把结束日改为前一天。
