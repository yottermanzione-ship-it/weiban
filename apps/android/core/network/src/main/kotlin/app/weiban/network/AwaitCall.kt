package app.weiban.network

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Keep cancellation registered until the whole bounded body has been decoded. */
internal suspend fun <T> Call.awaitDecoded(decode: (Response) -> T): T =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }

                // Decoder failures must reach the suspended caller instead of escaping the OkHttp callback.
                @Suppress("TooGenericExceptionCaught")
                override fun onResponse(
                    call: Call,
                    response: Response,
                ) {
                    try {
                        val value = response.use(decode)
                        if (continuation.isActive) continuation.resume(value)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    }
                }
            },
        )
    }
