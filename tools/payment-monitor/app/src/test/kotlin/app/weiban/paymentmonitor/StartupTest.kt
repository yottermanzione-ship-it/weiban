package app.weiban.paymentmonitor

import android.app.Notification
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35])
class StartupTest {
    private lateinit var ctx: Context
    @Before fun setup() {
        ctx = RuntimeEnvironment.getApplication()
        QueueStore.prefs(ctx).edit().clear().commit()
        listOf("receipts-v1.json", "receipts-v1.json.bak", "receipts-v1.json.new").forEach { java.io.File(ctx.filesDir, it).delete() }
    }

    @Test fun foregroundMonitorCreatesOngoingStatusNotification() {
        val controller = Robolectric.buildService(MonitorService::class.java).create()
        try {
            val service = shadowOf(controller.get())
            assertEquals(41, service.lastForegroundNotificationId)
            val notification = service.lastForegroundNotification
            assertEquals("微伴收款监控运行中", notification.extras.getCharSequence(Notification.EXTRA_TITLE))
            assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
            assertNotNull(notification.contentIntent)
        } finally { controller.destroy() }
    }

    @Test fun startWithoutPairingPromptsInsteadOfStartingService() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            descendants(activity.window.decorView).filterIsInstance<Button>().single { it.text == "开始监控" }.performClick()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertTrue(dialog.isShowing)
            assertEquals("请先保存连接设置", shadowOf(dialog).message)
            assertTrue(activity.window.attributes.flags and android.view.WindowManager.LayoutParams.FLAG_SECURE != 0)
            assertNull(shadowOf(RuntimeEnvironment.getApplication()).nextStartedService)
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun rejectedRetryHasVisibleWarningWithoutClaimingConnected() {
        QueueStore.prefs(ctx).edit().putBoolean("retryUnavailable", true).commit()
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            ShadowLooper.idleMainLooper()
            val text = descendants(controller.get().window.decorView).filterIsInstance<TextView>().joinToString("\n") { it.text }
            assertTrue(text.contains("后台补报未能安排"))
            assertTrue(text.contains("通知监听：未连接"))
            assertTrue(text.contains("尚未连接服务器"))
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun upgradeKeepsBindingAndJournalWithoutDisplayingStaleSettlement() {
        QueueStore.saveDevice(ctx, "synthetic-device")
        QueueStore.enqueue(ctx, ReceiptCandidate("alipay", 1290), "synthetic-history", 1000)
        val event = QueueStore.pending(ctx).first()
        QueueStore.accept(ctx, event.getString("eventId"), org.json.JSONObject().put("status", "review"))
        assertTrue("ack must persist before opening UI", QueueStore.pending(ctx).isEmpty())
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 1440), "synthetic-pending", 2000)
        val journal = QueueStore.read(ctx).toString()
        QueueStore.prefs(ctx).edit().putInt("unrecognized", 81).putBoolean("reviewPending", true)
            .putLong("connectedAt", 9876).putString("status", "监控已连接；有到账需要到后台核对").commit()
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            ShadowLooper.idleMainLooper()
            val views = descendants(controller.get().window.decorView)
            val save = views.filterIsInstance<Button>().single { it.text == "保存设置" }
            assertEquals(View.GONE, (save.parent as View).visibility)
            assertEquals(0, controller.get().window.attributes.flags and android.view.WindowManager.LayoutParams.FLAG_SECURE)
            val text = views.filterIsInstance<TextView>().joinToString("\n") { it.text }
            assertTrue(text.contains("已保存，无需重复设置"))
            assertTrue(text, text.contains("待补报：1"))
            assertTrue(text, text.contains("监控上报记录"))
            assertFalse(text.contains("最近到账"))
            assertFalse(text.contains("历史未识别通知"))
            assertFalse(text.contains("待核对"))
            assertFalse(text.contains("有到账需要到后台核对"))
            assertFalse(text.contains("synthetic-history"))
            assertEquals("synthetic-device", QueueStore.deviceId(ctx))
            assertEquals(9876L, QueueStore.prefs(ctx).getLong("connectedAt", 0))
            assertEquals(journal, QueueStore.read(ctx).toString())
            QueueStore.retireLegacyDisplay(ctx)
            assertEquals(journal, QueueStore.read(ctx).toString())
        } finally { controller.pause().stop().destroy() }
    }

    private fun descendants(view: View): List<View> = listOf(view) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
}
