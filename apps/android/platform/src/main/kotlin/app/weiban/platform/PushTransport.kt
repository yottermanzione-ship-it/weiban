package app.weiban.platform

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

interface PushTransport {
    val provider: String
    val available: Boolean

    suspend fun token(): String

    suspend fun stop()
}

/** These are public app configuration fields; server/provider credentials never enter the APK. */
data class FirebasePushConfig(
    val appId: String,
    val senderId: String,
    val projectId: String,
    val apiKey: String,
) {
    val complete: Boolean get() = listOf(appId, senderId, projectId, apiKey).all { it.isNotBlank() }
}

class FirebasePushTransport(
    private val context: Context,
    private val config: FirebasePushConfig,
) : PushTransport {
    override val provider = "fcm"
    override val available: Boolean
        get() =
            config.complete &&
                GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    fun initialize() {
        if (!available) return
        if (FirebaseApp.getApps(context).isEmpty()) {
            val options =
                FirebaseOptions
                    .Builder()
                    .setApplicationId(config.appId)
                    .setGcmSenderId(config.senderId)
                    .setProjectId(config.projectId)
                    .setApiKey(config.apiKey)
                    .build()
            val collectionEnabled: Boolean? = false
            FirebaseApp.initializeApp(context, options).setDataCollectionDefaultEnabled(collectionEnabled)
        }
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        FirebaseMessaging.getInstance().setNotificationDelegationEnabled(false)
        FirebaseMessaging.getInstance().setDeliveryMetricsExportToBigQuery(false)
    }

    override suspend fun token(): String {
        check(available)
        initialize()
        val request = FirebaseRegistrationCallbacks.begin()
        return try {
            withTimeout(30_000) {
                FirebaseMessaging.getInstance().register().addOnCompleteListener { task ->
                    if (!task.isSuccessful) request.completeExceptionally(IOException("通知通道暂不可用"))
                }
                request.await()
            }
        } finally {
            FirebaseRegistrationCallbacks.finish(request)
        }
    }

    override suspend fun stop() {
        if (!available || FirebaseApp.getApps(context).isEmpty()) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        suspendCancellableCoroutine<Unit> { continuation ->
            FirebaseMessaging.getInstance().unregister().addOnCompleteListener { task ->
                if (!continuation.isActive) return@addOnCompleteListener
                if (task.isSuccessful) {
                    continuation.resume(Unit)
                } else {
                    continuation.resumeWithException(IOException("通知通道暂不可用"))
                }
            }
        }
    }
}
