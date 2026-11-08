package app.weiban.paymentmonitor

import android.app.Notification

/** Same text surfaces as the supplied legacy APK. Nothing from these strings is persisted. */
object ReceiptNotification {
    fun read(pkg: String, notification: Notification): ReceiptCandidate? {
        if (pkg != "com.tencent.mm" && pkg != "com.eg.android.AlipayGphone") return null
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        if (!ReceiptParser.acceptsTitle(pkg, title)) return null
        val messaging = extras.containsKey("android.messages") || extras.containsKey("android.messagingUser") || extras.getBoolean("android.isGroupConversation", false)
        if (messaging && !ReceiptParser.acceptsMessagingTitle(pkg, title)) return null
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES).orEmpty().map { it.toString() }
        val texts = listOf(
            Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT, Notification.EXTRA_SUMMARY_TEXT,
            Notification.EXTRA_SUB_TEXT, Notification.EXTRA_INFO_TEXT, Notification.EXTRA_TITLE_BIG,
            "android.conversationTitle"
        ).mapNotNull { extras.getCharSequence(it)?.toString() } +
            lines +
            listOfNotNull(notification.tickerText?.toString())
        return ReceiptParser.parseViews(pkg, title, texts, notification.flags and Notification.FLAG_GROUP_SUMMARY != 0, messaging, ReceiptParser.hasMultipleMoneyLines(lines))
    }
}
