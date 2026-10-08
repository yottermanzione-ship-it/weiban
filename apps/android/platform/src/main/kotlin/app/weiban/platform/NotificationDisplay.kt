package app.weiban.platform

import app.weiban.contracts.Endpoints
import app.weiban.contracts.NotificationEnvelope
import app.weiban.contracts.NotificationSettings
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

internal fun notificationQuiet(
    now: Long,
    zone: String,
    settings: NotificationSettings,
): Boolean {
    val quiet = settings.doNotDisturb
    if (!quiet.enabled) return false
    val local = Instant.ofEpochMilli(now).atZone(ZoneId.of(zone)).toLocalTime()
    val start = LocalTime.parse(quiet.start)
    val end = LocalTime.parse(quiet.end)
    return when {
        start == end -> true
        start < end -> local >= start && local < end
        else -> local >= start || local < end
    }
}

internal class NotificationDisplay(
    private val repository: SessionRepository,
    private val now: () -> Long,
) {
    suspend fun prepare(
        owner: OwnerRecord,
        envelope: NotificationEnvelope,
    ): () -> NotificationEnvelope {
        val options = SessionCallOptions(owner = owner, networkOnly = true)
        val settings = repository.call(Endpoints.identityEndpointsGetNotificationSettings, options = options)
        val conversationId = envelope.conversationId
        val conversation =
            if (envelope.kind == "message" && conversationId != null) {
                repository.call(
                    Endpoints.chatEndpointsGetConversation,
                    params = mapOf("conversationId" to conversationId),
                    options = options,
                )
            } else {
                null
            }
        val zone =
            if (settings.doNotDisturb.enabled) {
                repository.call(Endpoints.identityEndpointsGetProfile, options = options).timeZone
            } else {
                "UTC"
            }
        // Re-evaluate the clock at OS publication, after any avatar/network delay.
        return {
            envelope.copy(
                sound =
                    envelope.sound && settings.pushSoundEnabled && conversation?.state?.muted != true &&
                        !notificationQuiet(now(), zone, settings),
                body = if (settings.pushShowContent && conversation?.contentScope != "adult") envelope.body else "你收到一条新消息",
            )
        }
    }
}
