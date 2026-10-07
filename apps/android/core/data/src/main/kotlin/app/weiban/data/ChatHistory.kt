package app.weiban.data

import app.weiban.contracts.*
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first

/** History requests belong to the application owner, not the lifetime of a screen. */
class ChatHistory(
    private val repository: SessionRepository,
    private val scope: CoroutineScope,
    private val runner: suspend (OwnerRecord) -> SyncRunner?,
    private val refresh: suspend (OwnerRecord) -> Long?,
) {
    suspend fun older(
        expected: OwnerRecord,
        conversationId: String,
        beforeSeq: Long,
    ) {
        val current = runner(expected) ?: return
        val page =
            repository.call(
                Endpoints.chatEndpointsListMessages,
                params = mapOf("conversationId" to conversationId),
                query = mapOf("beforeSeq" to beforeSeq.toString(), "limit" to "50"),
                options = SessionCallOptions(networkOnly = true, owner = expected),
            )
        if (runner(expected) === current) current.history(conversationId, beforeSeq, page)
    }

    suspend fun clear(
        expected: OwnerRecord,
        conversationId: String,
    ) {
        val current = ready(expected)
        scope
            .async {
                val confirmed =
                    repository.call(
                        Endpoints.chatEndpointsClearHistory,
                        params = mapOf("conversationId" to conversationId),
                        options = SessionCallOptions(networkOnly = true, owner = expected),
                    )
                verify(expected, current)
                current.clearHistory(conversationId, confirmed.clearedThroughSeq)
                verify(expected, current)
            }.await()
    }

    /** A no-content mutation completes only after its committed server updates are durable locally. */
    suspend fun synchronize(expected: OwnerRecord) {
        val current = ready(expected)
        val sequence = refresh(expected) ?: throw ApiFailure("sync_not_ready", 0)
        withTimeout(10_000) {
            combine(current.state, repository.auth) { state, auth ->
                auth?.user?.userId != expected.userId || auth.session.sessionId != expected.sessionId ||
                    (state.initialized && state.lastUpdateSeq >= sequence)
            }.first { it }
        }
        verify(expected, current)
    }

    private suspend fun ready(expected: OwnerRecord): SyncRunner =
        runner(expected)?.takeIf { it.active } ?: throw ApiFailure("sync_not_ready", 0)

    private suspend fun verify(
        expected: OwnerRecord,
        current: SyncRunner,
    ) {
        val auth = repository.auth.value
        val matching = auth?.user?.userId == expected.userId && auth.session.sessionId == expected.sessionId
        if (!matching || runner(expected) !== current || !current.active) throw ApiFailure("session_changed", 0)
    }
}
