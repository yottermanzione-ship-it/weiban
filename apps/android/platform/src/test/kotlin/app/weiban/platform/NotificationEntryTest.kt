package app.weiban.platform

import android.content.Intent
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(
    sdk = [26],
    application = PushTestApplication::class,
)
class NotificationEntryTest {
    private lateinit var fixture: PushFixture

    @Before fun setup() {
        fixture = PushFixture()
    }

    @After fun close() {
        fixture.close()
    }

    @Test fun firebaseNotificationDisplayIntentsCannotReachTheAutomaticSdkDisplayPath() {
        val service = Robolectric.buildService(WeibanMessagingService::class.java).create().get()
        for (action in listOf(
            "com.google.android.c2dm.intent.RECEIVE",
            "com.google.firebase.messaging.RECEIVE_DIRECT_BOOT",
        )) {
            service.handleIntent(
                Intent(action)
                    .putExtra(
                        "gcm.n.e",
                        "1",
                    ).putExtra(
                        "gcm.n.title",
                        "old account private title",
                    ),
            )
            service.handleIntent(
                Intent(action)
                    .putExtra(
                        "gcm.notification.e",
                        "1",
                    ).putExtra(
                        "gcm.notification.body",
                        "private body",
                    ),
            )
        }
        assertEquals(
            0,
            fixture.manager.activeNotifications.size,
        )
        assertEquals(
            0,
            fixture.server.requestCount,
        )
    }

    @Test fun sdkRegistrationCallbackCompletesTheInMemoryWaiterWithoutQueuingAnotherRegistration() =
        runBlocking {
            val request = FirebaseRegistrationCallbacks.begin()
            try {
                val service = Robolectric.buildService(WeibanMessagingService::class.java).create().get()
                service.onRegistered("sdk-registration-token")
                assertEquals("sdk-registration-token", request.await())
                assertEquals(0, fixture.transport.requests.get())
                assertEquals(0, fixture.server.requestCount)
            } finally {
                FirebaseRegistrationCallbacks.finish(request)
            }
        }

    @Test fun realSdkDataCallbackPersistsOwnedPayloadButLegacyAndUnavailableDoNot() =
        runBlocking {
            with(fixture) {
                runtime.enable(owner)
                val service = Robolectric.buildService(WeibanMessagingService::class.java).create().get()
                service.onMessageReceived(
                    RemoteMessage
                        .Builder("fixture")
                        .addData(
                            "weiban",
                            raw(envelope()),
                        ).build(),
                )
                assertEquals(
                    envelope(),
                    repository.notifications.pending(
                        owner,
                        envelope().notificationId,
                    ),
                )
                service.onMessageReceived(
                    RemoteMessage
                        .Builder("fixture")
                        .addData(
                            "body",
                            "legacy private body",
                        ).build(),
                )
                transport.available = false
                service.onMessageReceived(
                    RemoteMessage
                        .Builder("fixture")
                        .addData(
                            "weiban",
                            raw(envelope().copy(notificationId = deviceId)),
                        ).build(),
                )
                assertNull(
                    repository.notifications.pending(
                        owner,
                        deviceId,
                    ),
                )
                assertEquals(
                    0,
                    manager.activeNotifications.size,
                )
                assertEquals(
                    1,
                    server.requestCount,
                )
            }
        }

    @Test fun onlyConfiguredHttpsAdminOriginAndTypedInternalRoutesAreAccepted() {
        assertEquals(
            "https://admin.example/admin/alerts",
            adminNotificationAddress("https://admin.example/"),
        )
        for (origin in listOf(
            "",
            "http://admin.example",
            "https://user@admin.example",
            "https://admin.example/path",
            "https://admin.example?token=x",
            "https://admin.example#x",
        )) {
            assertNull(adminNotificationAddress(origin))
        }
        val notice = fixture.envelope()
        assertEquals(
            "/chat/${fixture.conversationId}",
            notificationRoute(notice),
        )
        for (route in listOf(
            "/chat",
            "/wallet",
            "/models",
            "/services",
        )) {
            assertEquals(
                route,
                notificationRoute(notice.copy(deepLink = route)),
            )
        }
        assertNull(notificationRoute(notice.copy(deepLink = "/admin/alerts")))
        assertTrue(
            notificationOwned(
                notice.copy(
                    kind = "admin_alert",
                    deepLink = "/admin/alerts",
                ),
                fixture.auth.copy(user = fixture.auth.user.copy(role = "admin")),
                fixture.now,
            ),
        )
    }
}
