package app.weiban.paymentmonitor

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35])
class ListenerLifecycleTest {
    @Test fun rescanningIgnoredNoticeDoesNotAccumulateCountOrOverwriteConnection() {
        val controller = Robolectric.buildService(ReceiptListener::class.java).create()
        try {
            val ctx = controller.get()
            QueueStore.saveDevice(ctx, "synthetic-device")
            QueueStore.status(ctx, "通知监听与服务器均已连接")
            val previous = QueueStore.read(ctx).toString()
            val notification = android.app.Notification.Builder(ctx, "synthetic")
                .setContentTitle("微信收款助手").setContentText("查看详情").build()
            val sbn = android.service.notification.StatusBarNotification(
                "com.tencent.mm", "com.tencent.mm", 7, "synthetic", 1000, 0, 0,
                notification, android.os.Process.myUserHandle(), 1000L
            )
            repeat(3) { ctx.onNotificationPosted(sbn) }
            assertEquals(0, QueueStore.prefs(ctx).getInt("unrecognized", 0))
            assertEquals("通知监听与服务器均已连接", QueueStore.lastStatus(ctx))
            assertEquals(previous, QueueStore.read(ctx).toString())
        } finally { controller.destroy() }
    }
    @Test fun oldListenerCallbacksCannotDisconnectNewInstance() {
        val first = Robolectric.buildService(ReceiptListener::class.java).create()
        val second = Robolectric.buildService(ReceiptListener::class.java).create()
        try {
            first.get().onListenerConnected()
            second.get().onListenerConnected()
            first.get().onListenerDisconnected()
            assertTrue(ReceiptListener.connected)
            first.destroy()
            assertTrue(ReceiptListener.connected)
            second.get().onListenerDisconnected()
            assertFalse(ReceiptListener.connected)
        } finally { second.destroy() }
    }
    @Test fun disconnectThenManualScanDoesNotPretendToBeConnected() {
        val controller = Robolectric.buildService(ReceiptListener::class.java).create()
        try {
            controller.get().onListenerConnected()
            assertTrue(ReceiptListener.connected)
            controller.get().onListenerDisconnected()
            assertFalse(ReceiptListener.connected)
            ReceiptListener.scan(controller.get())
            assertFalse(ReceiptListener.connected)
            controller.get().onListenerConnected()
            assertTrue(ReceiptListener.connected)
        } finally { controller.destroy() }
        assertFalse(ReceiptListener.connected)
    }
}
