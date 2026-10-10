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
    } else if (route.startsWith("/moments/posts/")) {
        // 角色在朋友圈评论里 @ 我（SOC-08 第 4 条）：点通知进入对应动态。
        val id = route.removePrefix("/moments/posts/")
        route.takeIf { runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false) }
    } else if (route.startsWith("/play/letters/")) {
        // 慢信送达（PLAY-05）：「XX 给你寄来了一封信」点击进入信件。
        val id = route.removePrefix("/play/letters/")
        route.takeIf { runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false) }
    } else if (route.startsWith("/calls/")) {
        // 角色来电（MED-07）：kind = call，打开前核对仍在响铃（T-070 交接）。
        val id = route.removePrefix("/calls/")
        route.takeIf { envelope.kind == "call" && runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false) }
    } else {
        route.takeIf { it in listOf("/chat", "/wallet", "/models", "/services", "/moments") }
    }
}
