package app.weiban.data

import app.weiban.contracts.*
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.util.UUID

data class ChatSnapshot(
    val owner: OwnerRecord?,
    val state: ClientSyncState,
)

/** Application singleton: foreground and WorkManager share the same serial runner and Room owner. */
class ChatRuntime(
    private val repository: SessionRepository,
    private val scope: CoroutineScope,
    private val onQueued: (OwnerRecord) -> Unit = {},
) {
    private val lock = Mutex()

    @Volatile private var owner: OwnerRecord? = null

    @Volatile private var bootstrapping = false
    private var runner: SyncRunner? = null
    private var observing: Job? = null
    private var loop: Job? = null
    private var backgroundUsers = 0
    private var realtime: ChatRealtime? = null
    private var typingJob: Job? = null

    @Volatile private var foreground = false

    @Volatile private var focused: String? = null
    private val typingState = MutableStateFlow<Map<String, Long>>(emptyMap())
    val typing: StateFlow<Map<String, Long>> = typingState
    private val committed = MutableStateFlow(ChatSnapshot(null, SyncEngine.freshState()))
    val snapshot: StateFlow<ChatSnapshot> = committed
    private val problem = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = problem
    private val connected = MutableStateFlow(false)
    val online: StateFlow<Boolean> = connected

    suspend fun attach(expected: OwnerRecord): Boolean =
        lock.withLock {
            val auth = repository.auth.value
            if (auth?.user?.userId != expected.userId || auth.session.sessionId != expected.sessionId) return@withLock false
            if (owner == expected && runner?.active == true) return@withLock true
            detachLocked()
            val initial = repository.loadSync(expected) ?: SyncEngine.freshState()
            val http = SyncHttp(repository, expected)
            val current =
                SyncRunner(
                    initial,
                    scope,
                    object : SyncDriverPort {
                        override suspend fun save(state: ClientSyncState) = repository.saveSync(expected, state)

                        override suspend fun execute(effect: ClientSyncEffect) = http.execute(effect)

                        override fun failed(error: Exception) {
                            if (owner != expected) return
                            bootstrapping = false
                            connected.value = false
                            if (runner?.active == false) {
                                problem.value = "本机保存失败，请检查设备存储后重新打开微伴"
                                return
                            }
                            problem.value = "同步暂未完成，将自动重试"
                            scope.launch { runnerFor(expected)?.dispatch(ClientSyncOperationOffline()) }
                        }
                    },
                )
            owner = expected
            runner = current
            committed.value = ChatSnapshot(expected, current.state.value)
            observe(expected, current)
            connectRealtime(expected, auth, current)
            if (foreground || backgroundUsers > 0) startPolling(expected, current)
            true
        }

    private fun observe(
        expected: OwnerRecord,
        current: SyncRunner,
    ) {
        observing =
            scope.launch {
                current.state.collect {
                    if (owner == expected) {
                        committed.value = ChatSnapshot(expected, it)
                        if (it.initialized) bootstrapping = false
                    }
                }
            }
    }

    private fun startPolling(
        expected: OwnerRecord,
        current: SyncRunner,
    ) {
        if (loop?.isActive == true) return
        loop =
            scope.launch {
                while (isActive) {
                    refresh(expected)
                    repeat(20) {
                        delay(250)
                        val now = System.currentTimeMillis()
                        val due =
                            current.state.value.outbox
                                .any { it.state == "pending" && it.retryAt <= now }
                        if (connected.value && due) current.dispatch(ClientSyncOperationTick(now = now))
                    }
                }
            }
    }

    private fun connectRealtime(
        expected: OwnerRecord,
        auth: AuthResponse,
        current: SyncRunner,
    ) {
        val transport =
            ChatRealtime(repository, auth, scope, { current.state.value.lastUpdateSeq }, { operation ->
                if (operation is ClientSyncOperationReconnect) {
                    reconnect(expected, operation.latestUpdateSeq)
                } else {
                    runnerFor(expected)?.dispatch(operation)
                }
            }, { message -> if (owner == expected) problem.value = message })
        realtime = transport
        typingJob = scope.launch { transport.typing.collect { if (owner == expected) typingState.value = it } }
        transport.focus(focused, foreground)
        if (foreground) transport.start()
    }

    fun foreground(active: Boolean) {
        foreground = active
        realtime?.focus(focused, active)
        if (active) realtime?.start() else realtime?.stop()
        scope.launch {
            lock.withLock {
                val expected = owner
                val current = runner
                if (expected != null && current != null) {
                    if (foreground || backgroundUsers > 0) startPolling(expected, current) else pausePolling(current)
                }
            }
        }
    }

    fun focus(conversationId: String?) {
        focused = conversationId
        realtime?.focus(conversationId, foreground)
    }

    /** Background leases share the foreground runner; the last inactive lease aborts transport and preserves pending IDs. */
    suspend fun <T> background(
        expected: OwnerRecord,
        work: suspend () -> T,
    ): T? {
        val accepted =
            if (attach(expected)) {
                lock.withLock {
                    if (owner == expected) {
                        backgroundUsers++
                        startPolling(expected, runner!!)
                        true
                    } else {
                        false
                    }
                }
            } else {
                false
            }
        return if (!accepted) {
            null
        } else {
            try {
                work()
            } finally {
                withContext(NonCancellable) {
                    lock.withLock {
                        if (owner == expected) {
                            backgroundUsers--
                            if (!foreground && backgroundUsers == 0) runner?.let { pausePolling(it) }
                        }
                    }
                }
            }
        }
    }

    private suspend fun pausePolling(current: SyncRunner) {
        loop?.cancel()
        loop = null
        bootstrapping = false
        connected.value = false
        current.dispatch(ClientSyncOperationOffline())
    }

    suspend fun detach() = lock.withLock { detachLocked() }

    private fun detachLocked() {
        loop?.cancel()
        observing?.cancel()
        typingJob?.cancel()
        realtime?.stop()
        runner?.stop()
        loop = null
        backgroundUsers = 0
        observing = null
        realtime = null
        typingJob = null
        typingState.value = emptyMap()
        focused = null
        runner = null
        owner = null
        bootstrapping = false
        committed.value = ChatSnapshot(null, SyncEngine.freshState())
        connected.value = false
        problem.value = null
    }

    private suspend fun runnerFor(expected: OwnerRecord): SyncRunner? =
        lock.withLock {
            runner.takeIf { owner == expected }
        }

    suspend fun refresh(expected: OwnerRecord) {
        val current = runnerFor(expected)?.takeIf { it.active && !bootstrapping } ?: return
        try {
            val remote =
                repository.call(
                    Endpoints.syncEndpointsGetState,
                    options = SessionCallOptions(networkOnly = true, owner = expected),
                )
            if (runnerFor(expected) !== current) return
            reconnect(expected, remote.latestUpdateSeq)
        } catch (error: CancellationException) {
            throw error
        } catch (_: IOException) {
            if (runnerFor(expected) === current) {
                bootstrapping = false
                connected.value = false
                problem.value = "网络暂不可用，消息已保存在此设备"
                current.dispatch(ClientSyncOperationOffline())
            }
        }
    }

    private suspend fun reconnect(
        expected: OwnerRecord,
        latestUpdateSeq: Long,
    ) = lock.withLock {
        val current = runner.takeIf { owner == expected && !bootstrapping && it?.active == true } ?: return@withLock
        bootstrapping = !current.state.value.initialized
        current.dispatch(ClientSyncOperationReconnect(latestUpdateSeq = latestUpdateSeq, now = System.currentTimeMillis()))
        connected.value = current.active
        if (current.active) problem.value = null
    }

    suspend fun send(
        expected: OwnerRecord,
        conversationId: String,
        text: String,
        quoteMessageId: String? = null,
    ) {
        require(text.isNotBlank() && text.length <= 4_000)
        val current = runnerFor(expected) ?: throw ApiFailure("sync_not_ready", 0)
        // Queue scheduling belongs to the application, even when the initiating screen disappears during the Room commit.
        withContext(NonCancellable) {
            current.dispatch(
                ClientSyncOperationEnqueue(
                    conversationId = conversationId,
                    body = SendMessageRequest(UUID.randomUUID().toString(), UserSendableContentText(text = text), quoteMessageId),
                    now = System.currentTimeMillis(),
                ),
            )
            if (!current.active) throw ApiFailure("sync_not_ready", 0)
            onQueued(expected)
        }
    }

    suspend fun retry(
        expected: OwnerRecord,
        conversationId: String,
        clientMsgId: String,
    ) {
        val current = runnerFor(expected) ?: return
        withContext(NonCancellable) {
            current.dispatch(
                ClientSyncOperationRetry(
                    conversationId = conversationId,
                    clientMsgId = clientMsgId,
                    now = System.currentTimeMillis(),
                ),
            )
            if (current.active) onQueued(expected)
        }
    }

    suspend fun inspect(
        expected: OwnerRecord,
        conversationId: String,
    ) {
        runnerFor(expected)?.dispatch(ClientSyncOperationInspect(conversationId = conversationId))
    }

    suspend fun older(
        expected: OwnerRecord,
        conversationId: String,
        beforeSeq: Long,
    ) {
        val current = runnerFor(expected) ?: return
        val page =
            repository.call(
                Endpoints.chatEndpointsListMessages,
                params = mapOf("conversationId" to conversationId),
                query = mapOf("beforeSeq" to beforeSeq.toString(), "limit" to "50"),
                options = SessionCallOptions(networkOnly = true, owner = expected),
            )
        if (runnerFor(expected) === current) current.history(conversationId, beforeSeq, page)
    }
}
