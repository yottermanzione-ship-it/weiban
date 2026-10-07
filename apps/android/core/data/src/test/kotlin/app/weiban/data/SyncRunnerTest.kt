package app.weiban.data

import app.weiban.contracts.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class SyncRunnerTest {
    @Test fun persistencePrecedesEffectAndCommittedObserver() =
        runBlocking {
            val saved = CompletableDeferred<Unit>()
            val executed = CompletableDeferred<Unit>()
            val effectScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val port =
                object : SyncDriverPort {
                    override suspend fun save(state: ClientSyncState): Boolean {
                        saved.complete(Unit)
                        return true
                    }

                    override suspend fun execute(effect: ClientSyncEffect): List<ClientSyncOperation> {
                        assertTrue(saved.isCompleted)
                        executed.complete(Unit)
                        return emptyList()
                    }

                    override fun failed(error: Exception): Unit = throw AssertionError(error)
                }
            val runner = SyncRunner(SyncEngine.freshState(), effectScope, port)
            try {
                runner.dispatch(ClientSyncOperationReconnect(latestUpdateSeq = 0, now = 1))
                withTimeout(2_000) { executed.await() }
                assertTrue(saved.isCompleted)
            } finally {
                runner.stop()
                effectScope.cancel()
            }
        }

    @Test fun rejectedOwnerNeverStartsNetwork() =
        runBlocking {
            var effects = 0
            val effectScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val port =
                object : SyncDriverPort {
                    override suspend fun save(state: ClientSyncState) = false

                    override suspend fun execute(effect: ClientSyncEffect): List<ClientSyncOperation> {
                        effects++
                        return emptyList()
                    }

                    override fun failed(error: Exception): Unit = throw AssertionError(error)
                }
            val initial = SyncEngine.freshState()
            val runner = SyncRunner(initial, effectScope, port)
            try {
                runner.dispatch(ClientSyncOperationReconnect(latestUpdateSeq = 0, now = 1))
                runner.dispatch(ClientSyncOperationReconnect(latestUpdateSeq = 0, now = 2))
                assertEquals(initial, runner.state.value)
                assertEquals(0, effects)
            } finally {
                effectScope.cancel()
            }
        }

    @Test fun offlineCancelsInFlightEffect() =
        runBlocking {
            val entered = CompletableDeferred<Unit>()
            val cancelled = CompletableDeferred<Unit>()
            val effectScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val port =
                object : SyncDriverPort {
                    override suspend fun save(state: ClientSyncState) = true

                    override suspend fun execute(effect: ClientSyncEffect): List<ClientSyncOperation> {
                        entered.complete(Unit)
                        try {
                            awaitCancellation()
                        } finally {
                            cancelled.complete(Unit)
                        }
                    }

                    override fun failed(error: Exception): Unit = throw AssertionError(error)
                }
            val runner = SyncRunner(SyncEngine.freshState(), effectScope, port)
            try {
                runner.dispatch(ClientSyncOperationReconnect(latestUpdateSeq = 10, now = 1))
                withTimeout(2_000) { entered.await() }
                runner.dispatch(ClientSyncOperationOffline())
                withTimeout(2_000) { cancelled.await() }
                assertFalse(runner.state.value.initialized)
                assertEquals(0L, runner.state.value.lastUpdateSeq)
            } finally {
                runner.stop()
                effectScope.cancel()
            }
        }

    @Test fun cancelledEffectReturningLateCannotWriteAgain() =
        runBlocking {
            val entered = CompletableDeferred<Job>()
            val release = CompletableDeferred<Unit>()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val saves =
                java.util.concurrent.atomic
                    .AtomicInteger()
            val failures =
                java.util.concurrent.atomic
                    .AtomicInteger()
            val port =
                object : SyncDriverPort {
                    override suspend fun save(state: ClientSyncState): Boolean {
                        saves.incrementAndGet()
                        return true
                    }

                    override suspend fun execute(effect: ClientSyncEffect): List<ClientSyncOperation> {
                        entered.complete(currentCoroutineContext()[Job]!!)
                        try {
                            awaitCancellation()
                        } catch (_: CancellationException) {
                            withContext(NonCancellable) { release.await() }
                        }
                        return listOf(ClientSyncOperationAccountReset())
                    }

                    override fun failed(error: Exception) {
                        failures.incrementAndGet()
                    }
                }
            val runner = SyncRunner(SyncEngine.freshState(), scope, port)
            try {
                runner.dispatch(ClientSyncOperationReconnect(latestUpdateSeq = 0, now = 1))
                val effect = withTimeout(2_000) { entered.await() }
                runner.dispatch(ClientSyncOperationOffline())
                release.complete(Unit)
                withTimeout(2_000) { effect.join() }
                assertEquals(2, saves.get())
                assertEquals(0, failures.get())
            } finally {
                release.complete(Unit)
                runner.stop()
                scope.cancel()
            }
        }
}
