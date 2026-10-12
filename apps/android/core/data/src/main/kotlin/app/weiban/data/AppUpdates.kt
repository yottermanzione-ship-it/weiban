package app.weiban.data

import app.weiban.contracts.UserUpdate
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * 3.0 updates the shared sync core does not store (moments badge / post changes, data.changed, call, transcript).
 * The sync engine forwards them here once per updateSeq; screens subscribe and refetch what they show.
 */
object AppUpdates {
    private val flow = MutableSharedFlow<UserUpdate>(extraBufferCapacity = 64)
    val updates: SharedFlow<UserUpdate> = flow

    fun publish(update: UserUpdate) {
        flow.tryEmit(update)
    }
}
