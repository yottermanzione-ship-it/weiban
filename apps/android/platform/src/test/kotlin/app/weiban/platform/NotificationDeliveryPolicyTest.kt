package app.weiban.platform

import android.app.Notification
import app.weiban.contracts.Endpoints
import app.weiban.contracts.NotificationSettingsDoNotDisturb
import app.weiban.data.SessionCallOptions
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26], application = PushTestApplication::class)
class NotificationDeliveryPolicyTest {
    private lateinit var fixture: PushFixture

    @Before fun setup() {
        fixture = PushFixture()
    }

    @After fun close() {
        fixture.close()
    }

    @Test fun deliveryReadsFreshQuietHoursAndUsesTheProfileTimeZone() =
        runBlocking {
            with(fixture) {
                runtime.enable(owner)
                repository.call(Endpoints.identityEndpointsGetNotificationSettings, options = SessionCallOptions(owner = owner))
                settings = settings.copy(doNotDisturb = NotificationSettingsDoNotDisturb(true, "15:00", "17:00"))
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                assertEquals(
                    "weiban.messages.silent",
                    manager.activeNotifications
                        .single()
                        .notification.channelId,
                )
                assertEquals(2, requests.count { it.path == "/api/v1/me/notification-settings" })
                assertTrue(requests.any { it.path == "/api/v1/me/profile" })
            }
        }

    @Test fun currentConversationMuteAndAdultScopeOverrideAnEarlierPayload() =
        runBlocking {
            with(fixture) {
                runtime.enable(owner)
                muted = true
                contentScope = "adult"
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                val notification = manager.activeNotifications.single().notification
                assertEquals("weiban.messages.silent", notification.channelId)
                assertEquals("你收到一条新消息", notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
            }
        }

    @Test fun quietHoursIncludeTheStartExcludeTheEndAndCrossMidnight() {
        val base = fixture.settings.copy(doNotDisturb = NotificationSettingsDoNotDisturb(true, "22:00", "08:00"))

        fun quiet(time: String) = notificationQuiet(Instant.parse(time).toEpochMilli(), "Asia/Shanghai", base)
        assertTrue(quiet("2026-10-07T14:00:00Z"))
        assertTrue(quiet("2026-10-07T23:59:59Z"))
        assertFalse(quiet("2026-10-08T00:00:00Z"))
        assertFalse(quiet("2026-10-07T13:59:59Z"))
        assertTrue(
            notificationQuiet(fixture.now, "UTC", base.copy(doNotDisturb = NotificationSettingsDoNotDisturb(true, "08:00", "08:00"))),
        )
        assertFalse(notificationQuiet(fixture.now, "UTC", base.copy(doNotDisturb = base.doNotDisturb.copy(enabled = false))))
    }
}
