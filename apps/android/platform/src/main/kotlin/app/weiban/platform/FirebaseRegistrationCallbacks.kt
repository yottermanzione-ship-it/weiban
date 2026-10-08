package app.weiban.platform

import kotlinx.coroutines.CompletableDeferred
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

/** A callback token lives only in memory while an explicit SDK registration is pending. */
internal object FirebaseRegistrationCallbacks {
    private val pending = AtomicReference<CompletableDeferred<String>?>(null)

    fun begin(): CompletableDeferred<String> {
        val request = CompletableDeferred<String>()
        pending.getAndSet(request)?.completeExceptionally(IOException("通知连接已替换"))
        return request
    }

    fun complete(token: String): Boolean = pending.getAndSet(null)?.complete(token) == true

    fun finish(request: CompletableDeferred<String>) {
        pending.compareAndSet(request, null)
        request.cancel()
    }
}
