package app.weiban.platform

import android.Manifest
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = PushTestApplication::class)
class NotificationPermissionTest {
    private lateinit var fixture: PushFixture

    @Before fun setup() {
        fixture = PushFixture()
    }

    @After fun close() {
        fixture.close()
    }

    @Test fun missingAndroidPermissionAndSystemDisabledNotificationsNeverRequestATokenOrBind() =
        runBlocking {
            with(fixture) {
                Shadows.shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
                assertFalse(runtime.permitted())
                assertTrue(runCatching { runtime.enable(owner) }.isFailure)
                assertFalse(repository.notifications.enabled(owner))
                assertEquals(0, transport.requests.get())
                assertEquals(0, server.requestCount)
                Shadows.shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
                Shadows.shadowOf(manager).setNotificationsEnabled(false)
                assertFalse(runtime.permitted())
                assertTrue(runCatching { runtime.enable(owner) }.isFailure)
                assertEquals(0, transport.requests.get())
                Shadows.shadowOf(manager).setNotificationsEnabled(true)
                runtime.enable(owner)
                assertTrue(repository.notifications.enabled(owner))
                assertEquals(1, server.requestCount)
            }
        }
}
