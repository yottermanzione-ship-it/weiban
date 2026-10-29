package app.weiban.platform

import android.app.Activity
import android.app.Application
import android.app.NotificationManager
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.NotificationEnvelope
import app.weiban.data.OwnerRecord
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 26], application = Application::class)
// API 24 exposes notification sound through this field; the compatibility test intentionally checks it.
@Suppress("DEPRECATION")
class LegacyAndroidNotificationTest {
    @Test fun messagesCanBePublishedAndCancelledWithoutCallingUnavailableChannelApis() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val manager = context.getSystemService(NotificationManager::class.java)
        val owner = OwnerRecord(userId = "legacy-test-user", sessionId = "legacy-test-session")
        val envelope =
            NotificationEnvelope(
                recipientUserId = owner.userId,
                recipientSessionId = owner.sessionId,
                notificationId = "legacy-notification",
                kind = "message",
                collapseKey = "chat:legacy-test",
                title = "测试通知",
                body = "假数据，不连接任何账号",
                count = 1,
                deepLink = "/chat/legacy-test",
                conversationId = "legacy-test",
                sound = false,
                sentAt = "2026-10-29T00:00:00Z",
            )
        val notices = NativeNotices(context, Activity::class.java, Json)
        val icon = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        try {
            notices.show(owner, envelope, icon)
            assertEquals(1, manager.activeNotifications.size)
            assertNull(
                manager.activeNotifications
                    .single()
                    .notification.sound,
            )
            notices.cancel(owner)
            assertEquals(0, manager.activeNotifications.size)
        } finally {
            manager.cancelAll()
            icon.recycle()
        }
    }

    @Test fun ongoingCallNotificationDoesNotRequireAndroid8Channels() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val notification = CallNotices.ongoing(context, Activity::class.java, "legacy-test-session", null, "测试通话", null)
        assertNotNull(notification)
        assertNull(notification.sound)
    }
}
