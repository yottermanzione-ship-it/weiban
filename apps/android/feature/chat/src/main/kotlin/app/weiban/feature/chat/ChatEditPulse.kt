package app.weiban.feature.chat

import android.os.SystemClock
import app.weiban.data.ChatRuntime
import app.weiban.data.OwnerRecord
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal class ChatEditPulse(
    private val runtime: ChatRuntime,
    private val owner: OwnerRecord,
    private val conversationId: String,
    private val scope: CoroutineScope,
) {
    private var lastEditAt = -500L

    fun send() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastEditAt < 500L) return
        lastEditAt = now
        scope.launch { runtime.batches.edit(owner, conversationId) }
    }
}
