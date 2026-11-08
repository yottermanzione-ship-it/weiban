package app.weiban.paymentmonitor

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class ReceiptListener : NotificationListenerService() {
    companion object { @Volatile var connected = false }
    override fun onListenerConnected() {
        connected = true
        try { activeNotifications?.forEach { onNotificationPosted(it) } } catch (_: Exception) { QueueStore.status(this, "监听已连接，历史通知读取失败，请核对后台") }
        Delivery.start(this)
    }
    override fun onListenerDisconnected() {
        connected = false; QueueStore.status(this, "通知监听已断开，请重新开启通知使用权")
        Delivery.start(this); requestRebind(ComponentName(this, ReceiptListener::class.java))
    }
    override fun onDestroy() { connected = false; super.onDestroy() }
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Filter before reading extras. Other app notifications are neither read nor logged.
        if (sbn.packageName != "com.tencent.mm" && sbn.packageName != "com.eg.android.AlipayGphone") return
        if (QueueStore.deviceId(this).isEmpty()) return
        val n = sbn.notification
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        if (!ReceiptParser.acceptsTitle(sbn.packageName, title)) return
        val summary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.isNotEmpty() == true
        val messaging = extras.containsKey("android.messages") || extras.containsKey("android.messagingUser") || extras.getBoolean("android.isGroupConversation", false)
        // Do not inspect ordinary chat or aggregate notification bodies, even inside a payment app.
        if (summary || messaging) { unrecognized(); return }
        val texts = listOfNotNull(extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(), extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        val parsed = texts.map { ReceiptParser.parse(sbn.packageName, title, it, summary, messaging) }
        if (parsed.isEmpty() || parsed.any { it == null } || parsed.filterNotNull().distinct().size != 1) {
            unrecognized()
            return
        }
        try { QueueStore.enqueue(this, parsed.first()!!, sbn.key, sbn.postTime); Delivery.start(this) }
        catch (_: Exception) { QueueStore.status(this, "到账记录未能写入，请立即核对实际收款；原队列未清除") }
    }
    private fun unrecognized() {
        val prefs = QueueStore.prefs(this)
        prefs.edit().putInt("unrecognized", prefs.getInt("unrecognized", 0) + 1).commit()
        QueueStore.status(this, "有支付应用通知未能可靠识别，请核对实际收款；通知原文未保存")
    }
}
