package app.weiban.paymentmonitor

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class ReceiptListener : NotificationListenerService() {
    companion object {
        @Volatile var connected = false
        private var live: java.lang.ref.WeakReference<ReceiptListener>? = null
        fun scan(context: android.content.Context) {
            try {
                val listener = live?.get()
                if (listener != null && connected) listener.scanCurrent()
                else {
                    connected = false; live = null
                    requestRebind(ComponentName(context, ReceiptListener::class.java))
                }
            } catch (_: RuntimeException) { QueueStore.status(context, "通知监听未能连接，请检查通知使用权") }
        }
    }
    private fun scanCurrent() {
        try { activeNotifications?.forEach { onNotificationPosted(it) } }
        catch (_: Exception) { QueueStore.status(this, "现有通知读取失败，请核对实际收款") }
    }
    override fun onListenerConnected() {
        connected = true; live = java.lang.ref.WeakReference(this)
        scanCurrent()
        Delivery.start(this)
    }
    override fun onListenerDisconnected() {
        if (live?.get() !== this) return
        connected = false; live = null
        QueueStore.status(this, "通知监听已断开，正在重新连接；此时尚不能监控到账")
        scan(this); Delivery.start(this)
    }
    override fun onDestroy() {
        if (live?.get() === this) { connected = false; live = null }
        super.onDestroy()
    }
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Filter before reading extras. Other app notifications are neither read nor logged.
        if (sbn.packageName != "com.tencent.mm" && sbn.packageName != "com.eg.android.AlipayGphone") return
        if (QueueStore.deviceId(this).isEmpty()) return
        val n = sbn.notification
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        if (!ReceiptParser.acceptsTitle(sbn.packageName, title)) return
        val summary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || (extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.size ?: 0) > 1
        val messaging = extras.containsKey("android.messages") || extras.containsKey("android.messagingUser") || extras.getBoolean("android.isGroupConversation", false)
        // Do not inspect ordinary chat or aggregate notification bodies, even inside a payment app.
        if (summary || messaging) { unrecognized(); return }
        val texts = listOfNotNull(
            extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            n.tickerText?.toString(),
            extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.singleOrNull()?.toString()
        )
        val parsed = ReceiptParser.parseViews(sbn.packageName, title, texts)
        if (parsed == null) { unrecognized(); return }
        try { QueueStore.enqueue(this, parsed, sbn.key, sbn.postTime); Delivery.start(this) }
        catch (_: Exception) { QueueStore.status(this, "到账记录未能写入，请立即核对实际收款；原队列未清除") }
    }
    private fun unrecognized() {
        val prefs = QueueStore.prefs(this)
        prefs.edit().putInt("unrecognized", prefs.getInt("unrecognized", 0) + 1).commit()
        QueueStore.status(this, "有支付应用通知未能可靠识别，请核对实际收款；通知原文未保存")
    }
}
