package app.weiban.data

import app.weiban.contracts.ClientSyncOperationEdit
import app.weiban.contracts.ClientSyncState
import app.weiban.contracts.Endpoints
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class ChatBatchActivity internal constructor(
    private val repository: SessionRepository,
    private val scope: CoroutineScope,
    private val runnerFor: suspend (OwnerRecord) -> SyncRunner?,
    private val connected: () -> Boolean,
) {
    private val announced = java.util.concurrent.ConcurrentHashMap<String, String>()

    internal fun signal(
        current: SyncRunner,
        expected: OwnerRecord,
        id: String,
    ) {
        if (!connected()) return
        val key = activityKey(current.state.value, id) ?: return
        scope.launch {
            try {
                repository.call(
                    Endpoints.chatEndpointsRecordEdit,
                    params = mapOf("conversationId" to id),
                    body =
                        kotlinx.serialization.json.buildJsonObject {
                            put("batchKey", kotlinx.serialization.json.JsonPrimitive(key))
                        },
                    options = SessionCallOptions(owner = expected),
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: java.io.IOException) {
                // Offline sends remain queued; the server will apply its own quiet window upon arrival.
            }
        }
    }

    private fun activityKey(
        state: ClientSyncState,
        id: String,
    ): String? {
        announced.keys.removeAll { known -> state.outbox.none { it.conversationId == known } }
        val head = state.outbox.firstOrNull { it.conversationId == id && it.state == "pending" }
        val transmitting = state.outbox.firstOrNull { it.conversationId == id && it.state == "sending" }
        val room = state.conversations.firstOrNull { it.conversationId == id }
        val last = room?.lastMessage
        val waiting =
            last != null && last.seq > (room.peerReadSeq ?: 0L) &&
                room.participants.any { it.participantId == last.senderParticipantId && it.kind == "user" }
        val key = head?.body?.clientMsgId ?: transmitting?.body?.clientMsgId ?: last?.messageId?.takeIf { waiting }
        val localOnly = head != null && !waiting && transmitting == null
        return key?.takeUnless { localOnly && announced.put(id, it) == it }
    }

    suspend fun edit(
        expected: OwnerRecord,
        id: String,
    ) {
        val current = runnerFor(expected) ?: return
        if (current.state.value.outbox
                .any { it.conversationId == id && it.state == "pending" }
        ) {
            current.dispatch(ClientSyncOperationEdit(conversationId = id, now = System.currentTimeMillis() + 500))
        }
        signal(current, expected, id)
    }
}
