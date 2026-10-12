# 交接说明：T-070 L5 后端——语音通话服务端与按分钟计费

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-070-calls`，`2fb5e09`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 自检 | 服务器 typecheck、build、根目录 lint 通过；按要求未写测试、未跑测试 |

## 做了什么

1. 新模块 `calls`（中层，表 `calls.call_sessions`，迁移 0044）：拨打（幂等，2～5 秒后角色接听）、来电（`CallSessionPort.startIncomingCall`，30 秒未接记未接）、接听、拒接、挂断、查询、当前通话、音频流凭证续期、通话可用状态，全部按 `CallEndpoints`。
2. 音频流 WebSocket（ADR-0025 方案 B）：`/api/v1/calls/{callId}/stream?token=`，PCM 双向转发，`hello / barge_in / mute / ping` 与 `call.ready / call.state / call.agent_speaking / call.ending / pong` 控制帧；断线 10 秒内可重连。
3. 收尾规则：60 分钟强制 time_limit；余额用完后 30 秒内角色未道别则强制 insufficient_balance；断线未重连 failed；每分钟巡检兜底。
4. 私聊通话记录（`call_record`，拨出由用户发出、来电由角色发出，未接 / 拒接也写）；`calls.call_started / call_answered / call_ended` 事件；`call.updated` 多设备同步；来电推送 kind = call（push 模块订阅事件）。
5. 删除清单：`purgeUser` 删本人全部通话会话。
6. 实现说明 `docs/backend/calls.md`。
7. 顺带修复 T-069 的 lint 错误（`media/application/link-preview.ts` 控制字符正则，格式化后 eslint-disable 失效；该错误已在主干上，本次合并后消除）。

## 改了哪些文件

- 新增：`apps/server/src/modules/calls/**`（`calls.module.ts`、`tokens.ts`、`index.ts`、`application/calls.ts`、`infra/stream-server.ts`、`infra/db/schema.ts`、`http/calls.controller.ts`）、`apps/server/drizzle/0044_calls(.down).sql`、`docs/backend/calls.md`
- 修改：`apps/server/drizzle/meta/_journal.json`、`apps/server/src/app.module.ts`（装配 CallsModule）、`apps/server/src/modules/realtime/infra/socket-server.ts`（放过 `/api/v1/calls/` 的 upgrade，否则会被 403）、`apps/server/src/modules/push/application/lifecycle.ts`（来电推送）、`apps/server/src/modules/media/application/link-preview.ts`（lint 修复）
- 契约未改；0045 未使用。

## 遗留问题

- **计费不在 calls**：按 ADR-0025，通话的语音识别（asr_minute 分段冻结）、回复、合成都由 ai-runtime 经模型网关结算；billing 模块未改。模型网关的 `ModelGatewayMediaPort`（`openRealtimeAsr`、`streamSpeech`、`isServiceEnabled`）目前在 model-access 里还没有实现，需要 T-071 / T-072 或 model-access 补上，否则通话打不通。
- **55 分钟提醒**：契约 `CallAgentSession` 没有提醒回调，calls 只在 60 分钟强制结束；提醒需由 ai-runtime 的会话自己按接通时间计时说出。如果要 calls 主动通知，需要契约变更（给 CallAgentSession 加 `onReminder`）。
- `CALL_AGENT_PORT`、`CALL_SERVICE_STATUS` 目前没有绑定，所以在 T-072 合并前 `availability` 一律返回 service_disabled（入口不显示），符合「未开通时安静消失」。
- 改了 realtime 与 push 两个模块各一处（任务卡范围外，但不改就无法接音频流 / 发来电推送）。
- 音频流挂在接受连接的那台服务器上；多实例部署时依赖数据库状态同步，重连到另一台实例会重新打开角色会话（上下文由 ai-runtime 负责）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-072）：
  - 实现契约 `CallAgentPort`，在 `app.module.ts` 绑定：`{ provide: CALL_AGENT_PORT, useExisting: 你的令牌 }`（从 `./modules/calls/index.js` 导入）；可选绑定 `CALL_SERVICE_STATUS`（`isVoiceCallEnabled()`，建议 = 语音识别与语音合成都开通）。
  - 发起来电：注入 `CALL_SESSION_PORT`（`../../calls/index.js`）调 `startIncomingCall`，频率、熟悉度、免打扰、专注、P-45 由你先判断；返回 busy / contact_inactive / service_disabled。
  - `openSession` 在用户接听（拨出时为角色自动接听）且客户端发出 hello 后调用；`signals()` 发 `{kind:'end', outcome}` 即结束通话（道别后用 time_limit / insufficient_balance）；`close({durationSec, outcome})` 在任何原因结束时调用一次。
  - 订阅 `calls.call_ended`：outcome = missed / declined 时按 MED-07 第 5 条发消息、当天不再来电。
- 给 Web（T-073）/ 安卓（T-075）：
  - 拨打 `POST /calls`（201）返回 ringing 与 `stream`；立刻用 `stream.path` + `?token=` 连 WebSocket，先发 `hello`（inputSampleRate 16000），收到 `call.ready` 后开始上行音频、按 `outputSampleRate` 播放下行。
  - answer / decline / hangup / stream-ticket 返回 200；断线后 10 秒内 `POST /calls/{id}/stream-ticket` 再连。
  - 收到 `call.ending` 或 `call.updated` 中 state = ended 即退出通话页；私聊记录按 `call_record` 渲染（outcome = insufficient_balance 显示「余额不足，通话已结束」）。
  - 来电推送 kind = call，`deepLink` = `/calls/{callId}`，打开前用 `GET /calls/{callId}` 核对仍在 ringing。
  - `GET /calls/availability?characterId=` 的 reason：service_disabled 时入口不显示。
- 给 T-076（成就）：订阅 `calls.call_ended`（含 durationSec、outcome）。
- 给 T-080（注销）：calls 已登记删除清单。
- 给总负责人：请把「55 分钟提醒是否要契约回调」和「ModelGatewayMediaPort 由谁实现」两点转架构 / AI 确认；迁移 0045 未使用，可回收。
