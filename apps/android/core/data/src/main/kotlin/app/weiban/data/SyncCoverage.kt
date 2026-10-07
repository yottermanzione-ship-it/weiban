package app.weiban.data

import app.weiban.contracts.*

/** Scanned negative ranges remove content even before its live hide update arrives. */
internal object SyncCoverage {
    fun apply(
        initial: ClientSyncState,
        cid: String,
        coverage: MessagePageCoverage,
    ): ClientSyncState {
        var state = initial
        require(coverage.throughSeq >= coverage.fromSeq && coverage.throughSeq - coverage.fromSeq <= 199)
        require((coverage.fromSeq == 0L) == (coverage.throughSeq == 0L))
        for (range in coverage.excludedRanges) {
            require(range.fromSeq >= coverage.fromSeq && range.throughSeq <= coverage.throughSeq && range.throughSeq >= range.fromSeq)
            state =
                state.copy(
                    excluded =
                        state.excluded +
                            ClientSyncStateExcludedItem(
                                conversationId = cid,
                                range = ClientSyncStateExcludedItemRange(range.fromSeq, range.throughSeq, range.reason),
                            ),
                )
        }
        if (coverage.fromSeq >
            0
        ) {
            for (seq in coverage.fromSeq..coverage.throughSeq) {
                require(excluded(state, cid, seq) || state.messages.any { it.conversationId == cid && it.seq == seq })
            }
        }
        state =
            state.copy(
                scannedThrough = state.scannedThrough + (cid to maxOf(state.scannedThrough[cid] ?: 0, coverage.throughSeq)),
                messages =
                    state.messages.filterNot { excluded(state, it.conversationId, it.seq) }.map { message ->
                        val quote = message.quote
                        if (quote != null &&
                            excluded(state, message.conversationId, quote.seq)
                        ) {
                            message.copy(quote = quote.copy(preview = null))
                        } else {
                            message
                        }
                    },
            )
        return state
    }

    private fun excluded(
        state: ClientSyncState,
        cid: String,
        seq: Long,
    ) = state.excluded.any {
        it.conversationId == cid && seq in it.range.fromSeq..it.range.throughSeq
    }
}
