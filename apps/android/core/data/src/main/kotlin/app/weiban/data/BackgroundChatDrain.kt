package app.weiban.data

import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

enum class ChatDrainResult { COMPLETE, STALE, RETRY }

/** Bounded background catch-up; payloads and credentials remain in owner-scoped Room/Keystore. */
class BackgroundChatDrain(
    private val repository: SessionRepository,
    private val runtime: ChatRuntime,
) {
    suspend fun drain(
        owner: OwnerRecord,
        timeoutMillis: Long = 45_000,
    ): ChatDrainResult {
        require(timeoutMillis > 0)
        if (!owns(owner)) return ChatDrainResult.STALE
        val completed =
            withTimeoutOrNull(timeoutMillis) {
                runtime.background(owner) { waitForOutbox(owner) }
            }
        return when {
            !owns(owner) -> ChatDrainResult.STALE
            completed == true -> ChatDrainResult.COMPLETE
            else -> ChatDrainResult.RETRY
        }
    }

    private fun owns(owner: OwnerRecord): Boolean {
        val auth = repository.auth.value
        return auth?.user?.userId == owner.userId && auth?.session?.sessionId == owner.sessionId
    }

    private suspend fun waitForOutbox(owner: OwnerRecord): Boolean {
        while (owns(owner)) {
            // Read the durable commit: the UI collector may still show the pre-enqueue snapshot.
            val state = repository.loadSync(owner)
            val waiting = state?.outbox?.any { it.state == "pending" || it.state == "sending" } == true
            if (state?.initialized == true && !waiting) return true
            delay(250)
        }
        return false
    }
}
