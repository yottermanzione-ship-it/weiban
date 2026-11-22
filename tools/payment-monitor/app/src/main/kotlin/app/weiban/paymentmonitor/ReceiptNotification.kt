package app.weiban.paymentmonitor

import android.app.Notification

data class CapturedReceipt(val candidate: ReceiptCandidate, val noticeText: String?)

/** Read visible payment notification text. Private conversation payloads are never collected. */
object ReceiptNotification {
    fun read(pkg: String, notification: Notification): CapturedReceipt? {
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
        ).mapNotNull { extras.getCharSequence(it)?.toString() }
        val ticker = listOfNotNull(notification.tickerText?.toString())
        val views = texts + lines + ticker
        val candidate = ReceiptParser.parseViews(pkg, title, views, notification.flags and Notification.FLAG_GROUP_SUMMARY != 0, messaging, ReceiptParser.hasMultipleMoneyLines(lines)) ?: return null
        val noticeText = if (ReceiptParser.canKeepNoticeText(candidate.channel, title, views, messaging)) {
            // Keep separate inbox lines even when two transactions display the same amount and text.
            val original = ((listOf(title) + texts + ticker).distinct() + lines).filter { it.isNotBlank() }.joinToString("\n")
            val limit = 8192
            val truncation = "\n（通知文本已截断）"
            if (original.length <= limit) original
            else original.take(limit - truncation.length).dropLastWhile { it.isHighSurrogate() } + truncation
        } else null
        return CapturedReceipt(candidate, noticeText)
    }
}
