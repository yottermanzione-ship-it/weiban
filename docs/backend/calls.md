# calls 模块：语音通话会话（T-070，L5）

依据：ADR-0025、契约 `http/calls.ts`、`ports/social.ts`（CallSessionPort / CallAgentPort）、PRD MED-06、MED-07、MDL-10 第 5 条、P-31。

**数据**：迁移 0044，表 `calls.call_sessions`。每个用户同时最多一通未结束的通话（部分唯一索引）；拨打按 `clientRequestId` 幂等，来电按 ai-runtime 的 `idempotencyKey` 幂等。

**状态**：ringing → active → ended。拨出后 2～5 秒（延迟任务 `calls.auto_answer`）角色接听；来电响铃 30 秒未接（`calls.ring_timeout`）记为 missed。结束统一走 `CallService.end`：只生效一次，同一事务写私聊通话记录（`call_record`；拨出由用户参与者发出，来电由角色发出）、发 `calls.call_ended`、写 `call.updated`。结果：用户挂断 completed / 响铃中取消 cancelled / 拒接 declined / 未接 missed / 断线未重连 failed / 60 分钟 time_limit / 余额用完 insufficient_balance。

**音频流**：`CallStreamServer` 在 HTTP 服务器的 upgrade 上接管 `/api/v1/calls/{callId}/stream?token=`（实时同步 WebSocket 已改为放过这个前缀）。凭证为 2 分钟有效的平台加密令牌，绑定通话与用户。连接后必须先发 `hello`；接通后打开 `CallAgentPort.openSession`，发 `call.ready`，双向转发 PCM 音频（上行单帧不超过 64 KB；客户端积压超过 1 MB 时丢弃下行片段）；`barge_in`、`mute` 转给角色会话；`ping` 回 `pong`。持有流的实例每秒读一次数据库状态，所以其他设备 / 实例的挂断能在 1 秒内反映；结束时发 `call.ending` 并关闭角色会话（`close` 带时长与结果）。断线后等待 10 秒重连（`calls.reconnect_check`），超时结束为 failed。

**计费**：通话的钱都在 ai-runtime 经模型网关结算（语音识别按 asr_minute 分段冻结 / 结算、回复 chat_reply、合成按字数，ADR-0025），calls 不调用扣费端口，billing 未改。calls 只做：拨打前 `getSpendStatus` 余额不足 → 422 insufficient_balance；通话中每 15 秒查一次，发现余额用完记 `balance_low_at`，30 秒内角色未道别结束则强制以 insufficient_balance 结束。接口与帧中都没有费用信息。

**时长**：durationSec 以服务器为准（接通起算，最多 3600）；到 3600 秒强制 time_limit。55 分钟提醒由 ai-runtime 的角色会话自己计时说出（契约里 CallAgentSession 没有提醒回调）。

**兜底巡检**：每分钟 `calls.sweep` 处理响铃超时、未自动接听、断线未重连、超时长、余额用完（进程崩溃、任务丢失时）。

**可用状态**：`CALL_AGENT_PORT` 未绑定 → service_disabled；绑定了 `CALL_SERVICE_STATUS` 时再看语音服务是否开通；然后依次判断 contact_inactive、busy、insufficient_balance。

**推送**：push 模块订阅 `calls.call_started`（direction = incoming），发 kind = call 的通知（标题角色名、正文「邀请你语音通话」、deepLink `/calls/{callId}`，不受免打扰拦截，免打扰由 ai-runtime 来电前判断）。

**注销**：`purgeUser` 删除该用户全部通话会话。私聊里的通话记录归 chat 删除。
