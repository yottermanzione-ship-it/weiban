package app.weiban.data

import app.weiban.contracts.*

/** Owner-scoped negative coverage survives an older in-flight snapshot; no protocol cursor is forged. */
internal object ClearedHistory {
    fun confirm(
        state: ClientSyncState,
        cid: String,
        throughSeq: Long,
    ): ClientSyncState {
        require(throughSeq in 0..9_007_199_254_740_991L)
        val conversation = state.conversations.find { it.conversationId == cid } ?: error("Unknown conversation")
        val through = maxOf(throughSeq, conversation.state.clearedThroughSeq, local(state, cid))
        val ranges = state.excluded.filterNot { it.conversationId == cid && it.range.reason == "cleared" && it.range.fromSeq == 1L }
        val covered =
            state.copy(
                excluded =
                    if (through == 0L) {
                        ranges
                    } else {
                        ranges +
                            ClientSyncStateExcludedItem(cid, ClientSyncStateExcludedItemRange(1, through, "cleared"))
                    },
            )
        val cleaned = clean(covered, conversation)
        return remove(
            covered.copy(
                conversations =
                    covered.conversations.map {
                        if (it.conversationId == cid) cleaned.copy(state = cleaned.state.copy(markedUnread = false)) else it
                    },
            ),
            cid,
            through,
        )
    }

    private fun local(
        state: ClientSyncState,
        cid: String,
    ): Long =
        state.excluded
            .filter {
                it.conversationId == cid && it.range.reason == "cleared" && it.range.fromSeq == 1L
            }.maxOfOrNull { it.range.throughSeq } ?: 0

    fun clean(
        state: ClientSyncState,
        conversation: Conversation,
    ): Conversation {
        val through = maxOf(conversation.state.clearedThroughSeq, local(state, conversation.conversationId))
        return conversation.copy(
            state = conversation.state.copy(clearedThroughSeq = through),
            lastMessage = if (conversation.lastSeq <= through) null else conversation.lastMessage,
            unreadCount = if (conversation.lastSeq <= through) 0 else conversation.unreadCount,
        )
    }

    fun remove(
        state: ClientSyncState,
        cid: String,
        through: Long,
    ): ClientSyncState =
        state.copy(
            messages =
                state.messages.filter { it.conversationId != cid || it.seq > through }.map { message ->
                    val quote = message.quote
                    if (message.conversationId == cid && quote != null && quote.seq <= through) {
                        message.copy(quote = quote.copy(preview = null))
                    } else {
                        message
                    }
                },
        )
}
