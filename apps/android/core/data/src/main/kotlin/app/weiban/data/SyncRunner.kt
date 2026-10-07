package app.weiban.data

import app.weiban.contracts.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface SyncDriverPort {
    suspend fun save(state: ClientSyncState): Boolean

    suspend fun execute(effect: ClientSyncEffect): List<ClientSyncOperation>

    fun failed(error: Exception)
}

/** One owner runtime serves UI and background work. Commit before publishing state or network effects. */
class SyncRunner(
    initial: ClientSyncState,
    private val scope: CoroutineScope,
    private val port: SyncDriverPort,
) {
    private val lock = Mutex()
    private var engine = SyncEngine(initial)
    private val committed = MutableStateFlow(engine.state)
    val state: StateFlow<ClientSyncState> = committed
    private var effectsJob = SupervisorJob(scope.coroutineContext[Job])

    @Volatile private var stopped = false
    val active: Boolean get() = !stopped

    fun stop() {
        stopped = true
        effectsJob.cancel()
    }

    suspend fun dispatch(operation: ClientSyncOperation) = dispatch(operation, null)

    private suspend fun dispatch(
        operation: ClientSyncOperation,
        guard: Job?,
    ) = mutate(guard) {
        if (operation is ClientSyncOperationOffline) {
            effectsJob.cancel()
            effectsJob = SupervisorJob(scope.coroutineContext[Job])
        }
        it.apply(operation)
    }

    suspend fun history(
        conversationId: String,
        beforeSeq: Long,
        page: MessagePage,
    ) = mutate(null) { it.history(conversationId, beforeSeq, page) }

    @Suppress("TooGenericExceptionCaught") // Persistence/validation failures stop this owner runtime; cancellation still propagates.
    private suspend fun mutate(guard: Job?, action: (SyncEngine) -> Unit) =
        lock.withLock {
            if (stopped || guard?.isActive == false) return@withLock
            val previous = engine.state
            try {
                action(engine)
                if (!port.save(engine.state)) {
                    engine = SyncEngine(previous)
                    stop()
                    return@withLock
                }
            } catch (error: CancellationException) {
                engine = SyncEngine(previous)
                stop()
                throw error
            } catch (error: Exception) {
                engine = SyncEngine(previous)
                stop()
                port.failed(error)
                throw error
            }
            if (!stopped) {
                committed.value = engine.state
                engine.drainEffects().forEach { execute(it, effectsJob) }
            }
        }

    @Suppress("TooGenericExceptionCaught") // Network and decoding failures share the effect boundary; cancellation propagates.
    private fun execute(effect: ClientSyncEffect, guard: Job) {
        scope.launch(guard) {
            try {
                if (!stopped) port.execute(effect).forEach { dispatch(it, guard) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // Deliberate coroutine boundary: transport and decoding failures are surfaced without losing committed outbox.
                if (!stopped && guard.isActive) port.failed(error)
            }
        }
    }
}
