package app.weiban.platform

import app.weiban.contracts.AuthResponse
import app.weiban.contracts.NotificationEnvelope
import java.time.OffsetDateTime
import java.util.UUID

internal fun notificationOwned(
    envelope: NotificationEnvelope,
    auth: AuthResponse?,
    now: Long,
): Boolean {
    if (auth == null || auth.session.kind != "app" ||
        OffsetDateTime.parse(auth.session.expiresAt).toInstant().toEpochMilli() <= now
    ) {
        return false
    }
    val sent = OffsetDateTime.parse(envelope.sentAt).toInstant().toEpochMilli()
    val recipient = auth.user.userId == envelope.recipientUserId && auth.session.sessionId == envelope.recipientSessionId
    val role = envelope.kind != "admin_alert" || auth.user.role == "admin"
    val timely = sent <= now + 60_000 && now - sent <= 600_000
    return recipient && role && timely
}

internal fun notificationRoute(envelope: NotificationEnvelope): String? {
    val route = envelope.deepLink
    return if (envelope.kind == "admin_alert") {
        route.takeIf { it == "/admin/alerts" }
    } else if (route.startsWith("/chat/")) {
        val id = route.removePrefix("/chat/")
        val valid = runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false)
        route.takeIf { valid && (envelope.conversationId == null || envelope.conversationId == id) }
    } else {
        route.takeIf { it in listOf("/chat", "/wallet", "/models", "/services") }
    }
}
