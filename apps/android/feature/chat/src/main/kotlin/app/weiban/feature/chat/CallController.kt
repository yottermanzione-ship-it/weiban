package app.weiban.feature.chat

import android.content.Context
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import androidx.compose.runtime.staticCompositionLocalOf
import app.weiban.contracts.*
import app.weiban.data.AppUpdates
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

enum class CallPhase { Dialing, Incoming, Connecting, Active, Reconnecting, Ended }

/** 通话页显示的全部状态（design/pages/call.md 第 2 节）。 */
data class CallView(
    val callId: String?,
    val characterId: String,
    val name: String,
    val direction: String,
    val phase: CallPhase,
    val conversationId: String? = null,
    val connectedAtMs: Long? = null,
    val muted: Boolean = false,
    val speaker: Boolean = false,
    val agentSpeaking: Boolean = false,
    val minimized: Boolean = false,
    val endText: String? = null,
    /** 从通知「接听」进来：界面申请麦克风后直接接听。 */
    val autoAnswer: Boolean = false,
)

/** 宿主（app）提供的系统层：前台服务常驻通知、来电通知的撤销。 */
interface CallSystem {
    fun callStarted(view: CallView)

    fun callFinished()

    fun dismissIncomingNotice(callId: String)
}

val LocalCalls = staticCompositionLocalOf<CallController?> { null }

private const val ENDED_PAGE_MS = 1_000L
private const val RECONNECT_GRACE_MS = 10_000L
private const val RECONNECT_STEP_MS = 2_000L
private const val PING_MS = 15_000L
private const val INCOMING_TIMEOUT_MS = 30_000L

/**
 * 语音通话（T-075，ADR-0025 方案 B；契约 http/calls.ts）。应用级单例：页面关掉、回到桌面通话照常继续。
 * 信令走 HTTP（拨打 / 接听 / 拒接 / 挂断），音频走每通电话一条 WebSocket；状态变化同时以 call.updated 同步到所有设备。
 * 全程不出现费用信息（MED-06 第 10 条）。
 */
class CallController(
    context: Context,
    private val repository: SessionRepository,
    baseUrl: String,
) {
    private val app = context.applicationContext
    private val root = baseUrl.toHttpUrl()
    private val serial = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + serial)
    private val http =
        OkHttpClient
            .Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .followRedirects(false)
            .build()
    private val mutable = MutableStateFlow<CallView?>(null)
    val state: StateFlow<CallView?> = mutable
    private val messages = MutableSharedFlow<String>(extraBufferCapacity = 8)

    /** 需要弹窗的提示（余额不足等）。 */
    val notices: SharedFlow<String> = messages
    var system: CallSystem? = null
    private var owner: OwnerRecord? = null
    @Volatile private var socket: WebSocket? = null
    private var generation = 0
    @Volatile private var audio: CallAudio? = null
    private var outputRate = 0
    private var reconnecting: Job? = null
    private var pinging: Job? = null
    private var ringTimeout: Job? = null
    private var ringtone: Ringtone? = null
    private var foreground = false

    init {
        scope.launch {
            AppUpdates.updates.collect { update -> if (update is UserUpdateCallUpdated) server(update.data.call) }
        }
    }

    fun attach(next: OwnerRecord?) {
        scope.launch {
            if (owner != next) {
                if (mutable.value != null) finish(null)
                owner = next
            }
        }
    }

    fun foreground(active: Boolean) {
        scope.launch {
            foreground = active
            updateRingtone()
        }
    }

    private val options get() = SessionCallOptions(owner = owner, networkOnly = true)

    // ---------- 拨出 ----------

    fun dial(
        characterId: String,
        name: String,
    ) {
        scope.launch {
            val current = mutable.value
            if (current != null) {
                // 正在另一通通话中：回到当前通话页（media-l5.md 7.1）。
                mutable.value = current.copy(minimized = false)
                return@launch
            }
            val view = CallView(null, characterId, name, "outgoing", CallPhase.Dialing)
            mutable.value = view
            system?.callStarted(view)
            enterAudio()
            try {
                val call =
                    repository.call(
                        Endpoints.callEndpointsStartCall,
                        body =
                            buildJsonObject {
                                put("characterId", characterId)
                                put("clientRequestId", UUID.randomUUID().toString())
                            },
                        options = options,
                    )
                if (mutable.value?.phase != CallPhase.Dialing) {
                    // 用户在接口返回前已取消。
                    hangUpRemote(call.callId)
                    return@launch
                }
                mutable.value = mutable.value?.copy(callId = call.callId, conversationId = call.conversationId)
                val ticket = call.stream
                if (ticket != null) connect(call.callId, ticket)
            } catch (error: CancellationException) {
                throw error
            } catch (error: ApiFailure) {
                finish(null, immediate = true)
                messages.tryEmit(
                    when (error.code) {
                        "insufficient_balance" -> "余额不足，暂时无法通话"
                        "call_busy" -> "你正在另一通通话中"
                        "service_disabled" -> "语音通话暂不可用"
                        else -> "暂时无法通话，请稍后再试"
                    },
                )
            } catch (_: java.io.IOException) {
                finish(null, immediate = true)
                messages.tryEmit("网络不佳，请稍后再试")
            }
        }
    }

    // ---------- 来电 ----------

    /** 收到来电（推送全屏通知点开 / 应用内 call.updated）：核对仍在响铃再显示来电页（T-070 交接）。 */
    fun incoming(
        callId: String,
        autoAnswer: Boolean = false,
    ) {
        scope.launch {
            val current = mutable.value
            if (current != null) {
                if (current.callId == callId) mutable.value = current.copy(minimized = false, autoAnswer = autoAnswer || current.autoAnswer)
                return@launch
            }
            val call =
                try {
                    repository.call(Endpoints.callEndpointsGetCall, params = mapOf("callId" to callId), options = options)
                } catch (error: CancellationException) {
                    throw error
                } catch (_: java.io.IOException) {
                    null
                }
            if (call == null || call.state != "ringing" || call.direction != "incoming" || mutable.value != null) {
                system?.dismissIncomingNotice(callId)
                return@launch
            }
            showIncoming(call, autoAnswer)
        }
    }

    private suspend fun showIncoming(
        call: CallSession,
        autoAnswer: Boolean,
    ) {
        val name = characterName(call.characterId)
        mutable.value = CallView(call.callId, call.characterId, name, "incoming", CallPhase.Incoming, call.conversationId, autoAnswer = autoAnswer)
        updateRingtone()
        ringTimeout?.cancel()
        // 30 秒无人接听：来电页消失（服务器同时记为未接，MED-07 第 4 条）。
        ringTimeout =
            scope.launch {
                delay(INCOMING_TIMEOUT_MS)
                if (mutable.value?.callId == call.callId && mutable.value?.phase == CallPhase.Incoming) finish("未接听")
            }
    }

    @Suppress("TooGenericExceptionCaught") // Missing profile keeps a neutral name.
    private suspend fun characterName(characterId: String): String =
        try {
            repository.call(Endpoints.characterEndpointsGetProfile, params = mapOf("characterId" to characterId), options = options).name
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            "角色"
        }

    fun answer() {
        scope.launch {
            val current = mutable.value ?: return@launch
            val callId = current.callId ?: return@launch
            if (current.phase != CallPhase.Incoming) return@launch
            ringTimeout?.cancel()
            mutable.value = current.copy(phase = CallPhase.Connecting, autoAnswer = false)
            updateRingtone()
            system?.dismissIncomingNotice(callId)
            system?.callStarted(mutable.value!!)
            enterAudio()
            try {
                val call = repository.call(Endpoints.callEndpointsAnswerCall, params = mapOf("callId" to callId), options = options)
                val ticket = call.stream
                if (ticket == null) finish("通话中断") else connect(callId, ticket)
            } catch (error: CancellationException) {
                throw error
            } catch (_: java.io.IOException) {
                // 409：已被其他设备接听或已超时。
                finish("通话已结束")
            }
        }
    }

    fun decline() {
        scope.launch {
            val current = mutable.value ?: return@launch
            val callId = current.callId ?: return@launch
            system?.dismissIncomingNotice(callId)
            finish(null, immediate = true)
            declineRemote(callId)
        }
    }

    /** 通知栏「拒绝」：不打开界面。 */
    fun declineFromNotice(callId: String) {
        scope.launch {
            if (mutable.value?.callId == callId) finish(null, immediate = true)
            system?.dismissIncomingNotice(callId)
            declineRemote(callId)
        }
    }

    @Suppress("TooGenericExceptionCaught") // Decline is best-effort; the server times out a ringing call by itself.
    private suspend fun declineRemote(callId: String) {
        try {
            repository.call(Endpoints.callEndpointsDeclineCall, params = mapOf("callId" to callId), options = options)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Unit
        }
    }

    // ---------- 通话中 ----------

    fun hangUp() {
        scope.launch {
            val current = mutable.value ?: return@launch
            val callId = current.callId
            if (current.phase == CallPhase.Incoming) {
                decline()
                return@launch
            }
            val text = if (current.connectedAtMs == null) "已取消" else endedText("completed", current)
            finish(text)
            if (callId != null) hangUpRemote(callId)
        }
    }

    @Suppress("TooGenericExceptionCaught") // Hang-up is idempotent; a lost request is closed by the server's reconnect check.
    private suspend fun hangUpRemote(callId: String) {
        try {
            repository.call(Endpoints.callEndpointsHangUp, params = mapOf("callId" to callId), options = options)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Unit
        }
    }

    fun toggleMute() {
        scope.launch {
            val current = mutable.value ?: return@launch
            val muted = !current.muted
            audio?.muted = muted
            send("mute", buildJsonObject { put("muted", muted) })
            mutable.value = current.copy(muted = muted)
        }
    }

    fun toggleSpeaker() {
        scope.launch {
            val current = mutable.value ?: return@launch
            val speaker = !current.speaker
            audio?.setSpeaker(speaker)
            mutable.value = current.copy(speaker = speaker)
        }
    }

    fun minimize(value: Boolean) {
        scope.launch { mutable.value = mutable.value?.copy(minimized = value) }
    }

    // ---------- 音频流 ----------

    private fun enterAudio() {
        if (audio != null) return
        audio =
            CallAudio(
                app,
                onFrame = { frame -> socket?.send(frame.toByteString()) },
                onBargeIn = { scope.launch { send("barge_in", buildJsonObject { put("at", Instant.now().toString()) }) } },
                onFocusLost = { hangUp() },
            ).also { it.enter() }
    }

    private fun connect(
        callId: String,
        ticket: CallStreamTicket,
    ) {
        socket?.cancel()
        val serial = ++generation
        val url =
            root
                .resolve(ticket.path)!!
                .newBuilder()
                .addQueryParameter("token", ticket.token)
                .build()
        socket =
            http.newWebSocket(
                Request.Builder().url(url).build(),
                object : WebSocketListener() {
                    override fun onOpen(
                        webSocket: WebSocket,
                        response: Response,
                    ) {
                        scope.launch {
                            if (serial != generation) return@launch
                            send("hello", buildJsonObject {
                                put("inputSampleRate", 16_000)
                                put("clientTime", Instant.now().toString())
                            })
                            startPing()
                        }
                    }

                    override fun onMessage(
                        webSocket: WebSocket,
                        text: String,
                    ) {
                        scope.launch { if (serial == generation) control(callId, text) }
                    }

                    override fun onMessage(
                        webSocket: WebSocket,
                        bytes: ByteString,
                    ) {
                        if (serial == generation) audio?.play(bytes.toByteArray())
                    }

                    override fun onClosed(
                        webSocket: WebSocket,
                        code: Int,
                        reason: String,
                    ) {
                        scope.launch { if (serial == generation) lost(callId) }
                    }

                    override fun onFailure(
                        webSocket: WebSocket,
                        t: Throwable,
                        response: Response?,
                    ) {
                        scope.launch { if (serial == generation) lost(callId) }
                    }
                },
            )
    }

    private fun send(
        type: String,
        data: JsonObject,
    ) {
        socket?.send(
            buildJsonObject {
                put("type", type)
                put("data", data)
            }.toString(),
        )
    }

    private fun startPing() {
        pinging?.cancel()
        pinging =
            scope.launch {
                while (isActive) {
                    delay(PING_MS)
                    send("ping", buildJsonObject { put("clientTime", Instant.now().toString()) })
                }
            }
    }

    private fun control(
        callId: String,
        raw: String,
    ) {
        val frame = runCatching { Json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        val data = frame["data"] as? JsonObject
        val current = mutable.value?.takeIf { it.callId == callId } ?: return
        when ((frame["type"] as? JsonPrimitive)?.contentOrNull) {
            "call.ready" -> {
                outputRate = data?.get("outputSampleRate")?.jsonPrimitive?.intOrNull ?: outputRate
                reconnecting?.cancel()
                reconnecting = null
                audio?.start(if (outputRate > 0) outputRate else 24_000)
                audio?.muted = current.muted
                if (current.muted) send("mute", buildJsonObject { put("muted", true) })
                mutable.value = current.copy(phase = CallPhase.Active, connectedAtMs = current.connectedAtMs ?: System.currentTimeMillis())
                system?.callStarted(mutable.value!!)
            }
            "call.state" -> {
                val state = data?.get("state")?.jsonPrimitive?.contentOrNull
                val duration = data?.get("durationSec")?.jsonPrimitive?.longOrNull ?: 0L
                if (state == "active" && current.connectedAtMs == null) {
                    mutable.value = current.copy(connectedAtMs = System.currentTimeMillis() - duration * 1000)
                }
            }
            "call.agent_speaking" -> {
                val speaking = data?.get("speaking")?.jsonPrimitive?.booleanOrNull == true
                audio?.agentSpeaking = speaking
                mutable.value = current.copy(agentSpeaking = speaking)
            }
            "call.ending" -> {
                val outcome = data?.get("outcome")?.jsonPrimitive?.contentOrNull ?: "completed"
                finish(endedText(outcome, current))
            }
            else -> Unit
        }
    }

    /** 断线：10 秒内换新凭证重连，「网络不佳，正在重连…」；超时结束（design/pages/call.md 第 3 节）。 */
    private fun lost(callId: String) {
        val current = mutable.value?.takeIf { it.callId == callId } ?: return
        if (current.phase == CallPhase.Ended || current.phase == CallPhase.Incoming || reconnecting != null) return
        socket = null
        pinging?.cancel()
        mutable.value = current.copy(phase = CallPhase.Reconnecting)
        reconnecting =
            scope.launch {
                val deadline = System.currentTimeMillis() + RECONNECT_GRACE_MS
                while (System.currentTimeMillis() < deadline) {
                    delay(RECONNECT_STEP_MS)
                    val ticket =
                        try {
                            repository.call(Endpoints.callEndpointsRenewStreamTicket, params = mapOf("callId" to callId), options = options)
                        } catch (error: CancellationException) {
                            throw error
                        } catch (_: java.io.IOException) {
                            null
                        }
                    if (ticket != null) {
                        reconnecting = null
                        connect(callId, ticket)
                        // 等 call.ready；若这次连接也失败，lost() 会重新进入重连。
                        return@launch
                    }
                }
                reconnecting = null
                finish("通话中断")
            }
    }

    /** 其他设备 / 服务器的状态变化（call.updated）。 */
    private suspend fun server(call: CallSession) {
        val current = mutable.value
        when {
            current?.callId == call.callId && call.state == "ended" ->
                finish(endedText(call.outcome ?: "completed", current), immediate = current.phase == CallPhase.Incoming)
            // 另一台设备接听了：本机来电页消失。
            current?.callId == call.callId && current.phase == CallPhase.Incoming && call.state != "ringing" -> finish(null, immediate = true)
            current == null && call.state == "ringing" && call.direction == "incoming" && owner != null -> showIncoming(call, false)
            current == null && call.state == "ended" -> system?.dismissIncomingNotice(call.callId)
        }
    }

    private fun endedText(
        outcome: String,
        current: CallView,
    ): String {
        val seconds = current.connectedAtMs?.let { (System.currentTimeMillis() - it) / 1000 } ?: 0L
        return when (outcome) {
            "completed" -> if (current.connectedAtMs == null) "通话结束" else "通话结束 %02d:%02d".format(seconds / 60, seconds % 60)
            "time_limit" -> "通话已达到时长上限"
            "insufficient_balance" -> "余额不足，通话已结束"
            "cancelled" -> "已取消"
            "declined" -> if (current.direction == "outgoing") "对方已拒绝" else "已拒绝"
            "missed" -> if (current.direction == "outgoing") "对方未接听" else "未接听"
            "failed" -> "通话中断"
            else -> "通话结束"
        }
    }

    /** 结束：停音频、关连接、停前台服务；结束页停 1 秒后关闭（immediate 直接关闭）。 */
    private fun finish(
        text: String?,
        immediate: Boolean = false,
    ) {
        val current = mutable.value ?: return
        if (current.phase == CallPhase.Ended) return
        generation++
        socket?.close(1000, null)
        socket = null
        pinging?.cancel()
        reconnecting?.cancel()
        reconnecting = null
        ringTimeout?.cancel()
        audio?.release()
        audio = null
        current.callId?.let { system?.dismissIncomingNotice(it) }
        system?.callFinished()
        if (immediate || text == null) {
            mutable.value = null
            updateRingtone()
            return
        }
        mutable.value = current.copy(phase = CallPhase.Ended, endText = text, minimized = false, agentSpeaking = false)
        updateRingtone()
        scope.launch {
            delay(ENDED_PAGE_MS)
            if (mutable.value?.phase == CallPhase.Ended) mutable.value = null
        }
    }

    /** 应用在前台且来电页显示时用系统铃声响铃（品牌铃声素材待制作，design media-l5.md 7.2）。 */
    private fun updateRingtone() {
        val ringing = foreground && mutable.value?.phase == CallPhase.Incoming
        if (ringing && ringtone == null) {
            mutable.value?.callId?.let { system?.dismissIncomingNotice(it) }
            ringtone =
                RingtoneManager.getRingtone(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
                    play()
                }
        } else if (!ringing) {
            ringtone?.stop()
            ringtone = null
        }
    }

    /** 入口是否显示：平台未开通语音服务时不显示（MED-06 第 11 条）。 */
    @Suppress("TooGenericExceptionCaught") // Unknown availability hides the entry.
    suspend fun availability(characterId: String): CallAvailability? =
        try {
            repository.call(Endpoints.callEndpointsGetAvailability, query = mapOf("characterId" to characterId), options = options)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }

    /** App 启动 / 重新登录：恢复进行中的通话为胶囊，或显示仍在响铃的来电。 */
    @Suppress("TooGenericExceptionCaught") // Restore is best-effort.
    fun restore() {
        scope.launch {
            if (mutable.value != null || owner == null) return@launch
            val call =
                try {
                    repository.call(Endpoints.callEndpointsGetActiveCall, options = options).call
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    null
                }
            if (call == null) return@launch
            if (call.state == "ringing" && call.direction == "incoming") {
                showIncoming(call, false)
            } else if (call.state == "active" || call.state == "connecting") {
                // 进程被系统回收后无法续上音频，直接结束这通电话，私聊会出现通话记录。
                hangUpRemote(call.callId)
            }
        }
    }
}
