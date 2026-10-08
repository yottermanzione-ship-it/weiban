package app.weiban.platform

import android.content.Intent
import app.weiban.contracts.NotificationEnvelope
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.network.ContractJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.net.URI

class NotificationNavigation internal constructor(
    private val repository: SessionRepository,
    private val now: () -> Long,
) {
    private val mutable = MutableStateFlow<NotificationTarget?>(null)
    val target: StateFlow<NotificationTarget?> = mutable

    suspend fun open(intent: Intent): NotificationTarget? {
        val envelope = envelope(intent) ?: return null
        val route = notificationRoute(envelope)
        val owner = OwnerRecord(userId = envelope.recipientUserId, sessionId = envelope.recipientSessionId)
        return if (route != null && notificationOwned(envelope, repository.auth.value, now()) && repository.notifications.enabled(owner)) {
            NotificationTarget(owner, route, envelope.notificationId).also { mutable.value = it }
        } else {
            null
        }
    }

    private fun envelope(intent: Intent): NotificationEnvelope? {
        val raw = intent.getStringExtra(NativeNotices.EXTRA)
        if (intent.action != NativeNotices.ACTION || raw == null || raw.toByteArray(Charsets.UTF_8).size > 8192) return null
        return runCatching {
            repository.api.json.decodeFromJsonElement(
                NotificationEnvelope.serializer(),
                ContractJson.normalize("NotificationEnvelope", repository.api.json.parseToJsonElement(raw)),
            )
        }.getOrNull()
    }

    fun consume(value: NotificationTarget) {
        if (mutable.value == value) mutable.value = null
    }

    fun detach(owner: OwnerRecord) {
        if (mutable.value?.owner == owner) mutable.value = null
    }
}

/** The admin site has its own login; a notification never forwards the app token or arbitrary URL. */
fun adminNotificationAddress(origin: String): String? =
    runCatching {
        val uri = URI(origin)
        origin
            .takeIf {
                uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null &&
                    uri.path in listOf("", "/")
            }?.trimEnd('/')
            ?.plus("/admin/alerts")
    }.getOrNull()
