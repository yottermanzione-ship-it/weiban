package app.weiban.data

import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import java.util.concurrent.atomic.AtomicReference

private sealed interface SocketEvent {
    data class Frame(
        val frame: ServerFrame,
    ) : SocketEvent

    data class Closed(
        val code: Int,
    ) : SocketEvent
}

private class SocketClock(
    val openedAt: Long = System.currentTimeMillis(),
) {
    var lastPong = openedAt
    var lastPing = openedAt
}

private data class ChatFocus(
    val conversationId: String?,
    val foreground: Boolean,
)

/** One bounded socket inbox per owner. Sends still use durable HTTP; WS accelerates updates and presence. */
class ChatRealtime(
    private val repository: SessionRepository,
    private val auth: AuthResponse,
    private val scope: CoroutineScope,
    private val lastUpdateSeq: () -> Long,
    private val operation: suspend (ClientSyncOperation) -> Unit,
    private val failure: (String) -> Unit,
) {
    private val api = repository.api
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
    private var job: Job? = null
    private val socket = AtomicReference<WebSocket?>(null)
    private val focus = AtomicReference(ChatFocus(null, false))
    private val typingState = MutableStateFlow<Map<String, Long>>(emptyMap())
    val typing: StateFlow<Map<String, Long>> = typingState

    @Volatile private var authenticated = false

    @Volatile private var blocked = false
    private var attempt = 0
    val active: Boolean get() = job?.isActive == true

    fun start() {
        if (job?.isActive == true || blocked) return
        job = scope.launch { run() }
    }

    fun stop() {
        job?.cancel()
        socket.getAndSet(null)?.cancel()
        authenticated = false
        typingState.value = emptyMap()
    }

    fun focus(
        conversationId: String?,
        foreground: Boolean,
    ) {
        focus.set(ChatFocus(conversationId, foreground))
        presence()
    }

    private fun presence() {
        val value = focus.get()
        send(ClientFramePresenceFocus(data = ClientFramePresenceFocusData(value.conversationId, value.foreground)))
    }

    private fun send(frame: ClientFrame) {
        if (authenticated) socket.get()?.send(api.json.encodeToString(ClientFrame.serializer(), frame))
    }

    @Suppress("TooGenericExceptionCaught") // Owner transport boundary surfaces failures; cancellation always propagates.
    private suspend fun run() {
        while (currentCoroutineContext().isActive && !blocked) {
            val code =
                try {
                    connection()
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    failure("连接暂不可用，将自动重试")
                    1006
                }
            when (code) {
                4401 -> {
                    repository.forgetIf(owner)
                }
                4426 -> {
                    blocked = true
                    failure("请更新微伴后继续")
                }
                4409 -> Unit // Resume only on an explicit foreground transition.
            }
            if (code in setOf(4401, 4426, 4409)) return
            val delays = listOf(500L, 1_000L, 2_000L, 4_000L, 8_000L, 10_000L)
            delay((delays[minOf(attempt++, delays.lastIndex)] * kotlin.random.Random.nextDouble(0.8, 1.2)).toLong())
        }
    }

    private fun listener(events: Channel<SocketEvent>) =
        object : WebSocketListener() {
            override fun onOpen(
                webSocket: WebSocket,
                response: Response,
            ) {
                val current = api.current()
                if (current?.user?.userId != owner.userId || current.session.sessionId != owner.sessionId) {
                    webSocket.close(4401, "session changed")
                    return
                }
                val data =
                    ClientFrameAuthData(
                        auth.session.token,
                        CONTRACT_VERSION,
                        DeviceInfo(
                            "android",
                            "微伴",
                            "0.1.0",
                            java.time.ZoneId
                                .systemDefault()
                                .id,
                        ),
                        lastUpdateSeq(),
                    )
                webSocket.send(api.json.encodeToString(ClientFrame.serializer(), ClientFrameAuth(data = data)))
            }

            override fun onMessage(
                webSocket: WebSocket,
                text: String,
            ) {
                if (text.length > 1_048_576) {
                    webSocket.close(1009, "frame too large")
                    return
                }
                val frame =
                    runCatching {
                        api.json.decodeFromJsonElement(
                            ServerFrame.serializer(),
                            ContractJson.normalize("ServerFrame", api.json.parseToJsonElement(text)),
                        )
                    }.getOrNull()
                if (frame == null) {
                    webSocket.close(1002, "invalid frame")
                } else if (events.trySend(SocketEvent.Frame(frame)).isFailure) {
                    events.close()
                    webSocket.cancel()
                }
            }

            override fun onClosing(
                webSocket: WebSocket,
                code: Int,
                reason: String,
            ) {
                webSocket.close(code, reason)
            }

            override fun onClosed(
                webSocket: WebSocket,
                code: Int,
                reason: String,
            ) {
                events.trySend(SocketEvent.Closed(code))
                events.close()
            }

            override fun onFailure(
                webSocket: WebSocket,
                t: Throwable,
                response: Response?,
            ) {
                events.close()
            }
        }

    private suspend fun connection(): Int {
        val events = Channel<SocketEvent>(256)
        val opened = api.openRealtime(listener(events))
        socket.set(opened)
        val clock = SocketClock()
        return try {
            var closed: Int? = null
            while (currentCoroutineContext().isActive && closed == null) {
                val next = withTimeoutOrNull(250) { events.receiveCatching() }
                closed = if (next?.isClosed == true) 1006 else consume(next?.getOrNull(), clock)
                if (closed == null) closed = heartbeat(clock)
            }
            closed ?: 1006
        } finally {
            if (socket.compareAndSet(opened, null)) {
                authenticated = false
                typingState.value = emptyMap()
            }
            opened.cancel()
            events.close()
        }
    }

    private suspend fun consume(
        event: SocketEvent?,
        clock: SocketClock,
    ): Int? =
        when (event) {
            is SocketEvent.Closed -> event.code
            is SocketEvent.Frame -> {
                if (event.frame is ServerFramePong) clock.lastPong = System.currentTimeMillis()
                handle(event.frame)
                null
            }
            null -> null
        }

    private fun heartbeat(clock: SocketClock): Int? {
        val now = System.currentTimeMillis()
        typingState.value = typingState.value.filterValues { it > now }
        val expired = (!authenticated && now - clock.openedAt > 12_000) || now - clock.lastPong > 45_000
        if (expired) return 1006
        if (authenticated && now - clock.lastPing >= 25_000) {
            clock.lastPing = now
            send(ClientFramePing(data = ClientFramePingData()))
            presence()
        }
        return null
    }

    private suspend fun handle(frame: ServerFrame) {
        when (frame) {
            is ServerFrameAuthOk -> {
                if (frame.data.userId != owner.userId || frame.data.sessionId != owner.sessionId) {
                    blocked = true
                    socket.get()?.close(1008, "owner mismatch")
                    failure("实时连接归属不符，请重新打开微伴")
                    return
                }
                authenticated = true
                attempt = 0
                operation(ClientSyncOperationReconnect(latestUpdateSeq = frame.data.latestUpdateSeq, now = System.currentTimeMillis()))
                presence()
            }
            is ServerFrameUpdate -> if (authenticated) operation(ClientSyncOperationUpdate(update = frame.data))
            is ServerFrameTyping ->
                if (authenticated) {
                    val key = "${frame.data.conversationId}:${frame.data.participantId}"
                    typingState.value =
                        typingState.value + (key to if (frame.data.state == "start") System.currentTimeMillis() + 6_000 else 0)
                }
            else -> Unit
        }
    }
}
