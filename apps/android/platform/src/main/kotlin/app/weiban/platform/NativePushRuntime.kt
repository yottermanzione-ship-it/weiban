package app.weiban.platform

import android.content.Context
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.network.ContractJson

/** IDs only are exposed to navigation; bodies/tokens never enter pending intents or WorkManager input. */
data class NotificationTarget(
    val owner: OwnerRecord,
    val route: String,
    val notificationId: String,
)

class NativePushRuntime(
    private val context: Context,
    private val repository: SessionRepository,
    private val transport: PushTransport,
    activity: Class<*>,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val notices = NativeNotices(context, activity, repository.api.json)
    private val registration = NotificationRegistration(repository, transport, notices)
    private val avatar = NotificationAvatar(context, repository)
    private val display = NotificationDisplay(repository, now)
    val navigation = NotificationNavigation(repository, now)
    val available get() = transport.available

    fun permitted() = notices.permitted()

    suspend fun enable(owner: OwnerRecord) {
        check(available && permitted())
        if (repository.notifications.setEnabled(owner, true)) registration.bind(owner)
    }

    suspend fun bind(owner: OwnerRecord) = registration.bind(owner)

    suspend fun rebind() {
        val auth = repository.auth.value ?: return
        val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
        if (available && repository.notifications.enabled(owner)) NotificationWork.register(context, owner)
    }

    suspend fun disable(owner: OwnerRecord) {
        NotificationWork.cancel(context, owner)
        registration.disable(owner)
    }

    fun detach(owner: OwnerRecord) {
        notices.cancel(owner)
        NotificationWork.cancel(context, owner)
        navigation.detach(owner)
    }

    suspend fun receive(raw: String): Boolean {
        val envelope = if (available) decode(raw) else null
        if (envelope == null) return false
        val owner = owner(envelope)
        val valid = notificationOwned(envelope, repository.auth.value, now()) && notificationRoute(envelope) != null
        return if (valid && repository.notifications.enqueue(owner, envelope)) {
            NotificationWork.deliver(context, owner, envelope.notificationId)
            true
        } else {
            false
        }
    }

    suspend fun deliver(
        owner: OwnerRecord,
        id: String,
    ) {
        val envelope = repository.notifications.pending(owner, id) ?: return
        val valid = notificationOwned(envelope, repository.auth.value, now()) && notificationRoute(envelope) != null
        if (!valid || !available || !permitted()) {
            repository.notifications.discard(owner, id)
            return
        }
        val appearance = display.prepare(owner, envelope)
        val icon = avatar.load(owner, envelope)
        try {
            repository.notifications.publish(owner, id) {
                check(notificationOwned(envelope, repository.auth.value, now()) && permitted())
                notices.show(owner, appearance(), icon)
            }
        } finally {
            icon.recycle()
        }
    }

    private fun owner(envelope: NotificationEnvelope) =
        OwnerRecord(userId = envelope.recipientUserId, sessionId = envelope.recipientSessionId)

    private fun decode(raw: String): NotificationEnvelope? {
        if (raw.toByteArray(Charsets.UTF_8).size > 8192) return null
        return runCatching {
            repository.api.json.decodeFromJsonElement(
                NotificationEnvelope.serializer(),
                ContractJson.normalize("NotificationEnvelope", repository.api.json.parseToJsonElement(raw)),
            )
        }.getOrNull()
    }
}
