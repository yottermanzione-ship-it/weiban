package app.weiban.platform

import android.app.Notification
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import app.weiban.data.OwnerRecord
import kotlinx.coroutines.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26], application = PushTestApplication::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativePushRuntimeTest {
    private lateinit var fixture: PushFixture

    @Before fun setup() {
        fixture = PushFixture()
    }

    @After fun close() {
        fixture.close()
    }

    @Test fun optInBindsTheOwnedDeviceAndDisableUnregistersItBeforeAnyFurtherDisplay() =
        runBlocking {
            with(fixture) {
                transport.available = false
                assertTrue(runCatching { runtime.enable(owner) }.isFailure)
                assertEquals(0, transport.requests.get())
                assertEquals(0, server.requestCount)
                transport.available = true
                runtime.enable(owner)
                assertEquals(deviceId, repository.notifications.deviceId(owner))
                val request = requests.single()
                assertEquals("POST", request.method)
                assertEquals("Bearer ${auth.session.token}", request.getHeader("Authorization"))
                assertTrue(
                    request.body
                        .clone()
                        .readUtf8()
                        .contains("fixture-provider-token"),
                )
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                assertEquals(1, manager.activeNotifications.size)
                runtime.disable(owner)
                assertFalse(repository.notifications.enabled(owner))
                assertTrue(requests.any { it.method == "DELETE" && it.path == "/api/v1/push/devices/$deviceId" })
                assertEquals(0, manager.activeNotifications.size)
                assertFalse(runtime.receive(raw(envelope().copy(notificationId = "01920000-0000-7000-8000-000000000042"))))
            }
        }

    @Test fun aLateTokenForTheReplacedSessionCannotBindOrChangeTheNewAccount() =
        runBlocking {
            with(fixture) {
                val token = CompletableDeferred<String>()
                transport.waitFor = token
                val old = async(Dispatchers.IO) { runtime.enable(owner) }
                withTimeout(5000) { while (transport.requests.get() == 0) yield() }
                repository.authenticate(replacement())
                runtime.detach(owner)
                token.complete("late-token")
                old.await()
                assertEquals(0, server.requestCount)
                assertEquals(replacement(), repository.auth.value)
                val next = OwnerRecord(userId = owner.userId, sessionId = replacement().session.sessionId)
                assertFalse(repository.notifications.enabled(next))
                assertNull(repository.notifications.deviceId(next))
            }
        }

    @Test fun actualChannelsNotificationsAndPendingIntentContainPixelsAndOwnedMetadataOnly() =
        runBlocking {
            with(fixture) {
                runtime.enable(owner)
                val notice = envelope().copy(sound = false)
                assertTrue(runtime.receive(raw(notice)))
                val work =
                    WorkManager
                        .getInstance(
                            context,
                        ).getWorkInfosByTag("weiban-notifications:${owner.userId}:${owner.sessionId}")
                        .get(5, TimeUnit.SECONDS)
                        .single()
                val requestData =
                    withContext(Dispatchers.IO) {
                        (
                            WorkManager.getInstance(
                                context,
                            ) as androidx.work.impl.WorkManagerImpl
                        ).workDatabase.workSpecDao().getWorkSpec(work.id.toString())!!.input
                    }
                assertEquals(setOf("userId", "sessionId", "notificationId"), requestData.keyValueMap.keys)
                assertEquals(owner.userId, requestData.getString("userId"))
                assertEquals(owner.sessionId, requestData.getString("sessionId"))
                assertEquals(notice.notificationId, requestData.getString("notificationId"))
                val worker = TestListenableWorkerBuilder<NotificationWorker>(context, inputData = requestData).build()
                assertEquals(
                    androidx.work.ListenableWorker.Result
                        .success(),
                    worker.doWork(),
                )
                assertNotNull(work)
                val posted = manager.activeNotifications.single().notification
                assertEquals("私密内容", posted.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
                assertEquals(2, posted.number)
                assertEquals("weiban.messages.silent", posted.channelId)
                assertNull(manager.getNotificationChannel(posted.channelId).sound)
                val icon = posted.getLargeIcon()!!.loadDrawable(context) as android.graphics.drawable.BitmapDrawable
                assertEquals(96, icon.bitmap.width)
                assertEquals(96, icon.bitmap.height)
                val targetIntent =
                    org.robolectric.Shadows
                        .shadowOf(posted.contentIntent)
                        .savedIntent
                assertTrue(
                    org.robolectric.Shadows
                        .shadowOf(posted.contentIntent)
                        .flags and android.app.PendingIntent.FLAG_IMMUTABLE != 0,
                )
                assertFalse(targetIntent.toUri(0).contains(auth.session.token))
                assertFalse(targetIntent.getStringExtra(NativeNotices.EXTRA)!!.contains("私密内容"))
                assertEquals("/chat/$conversationId", runtime.navigation.open(targetIntent)?.route)
                repository.authenticate(replacement())
                runtime.detach(owner)
                assertNull(runtime.navigation.open(targetIntent))
                assertNull(runtime.navigation.target.value)
                assertEquals(0, manager.activeNotifications.size)
            }
        }

    @Test fun invalidLegacyExpiredForeignAndUnsafeRoutesNeverEnterTheInboxOrOs() =
        runBlocking {
            with(fixture) {
                runtime.enable(owner)
                val valid = envelope()
                val invalid =
                    listOf(
                        raw(valid).replace("\"recipientSessionId\":\"${owner.sessionId}\",", ""),
                        raw(valid.copy(sentAt = "2026-10-07T07:49:59.000Z")),
                        raw(valid.copy(sentAt = "2026-10-07T08:01:01.000Z")),
                        raw(valid.copy(recipientSessionId = replacement().session.sessionId)),
                        raw(valid.copy(kind = "admin_alert", deepLink = "/admin/alerts")),
                        raw(valid.copy(deepLink = "//evil.example")),
                        raw(valid.copy(deepLink = "/chat/$deviceId")),
                        raw(valid.copy(deepLink = "/chat/$conversationId?token=leak")),
                        "{" + " ".repeat(9000),
                    )
                for (payload in invalid) assertFalse(payload, runtime.receive(payload))
                assertEquals(0, manager.activeNotifications.size)
                assertNull(repository.notifications.pending(owner, valid.notificationId))
                assertTrue(runtime.receive(raw(valid)))
            }
        }

    @Test fun persistentDuplicateGuardAndPreviewSettingSurviveRepositoryRestart() =
        runBlocking {
            with(fixture) {
                runtime.enable(owner)
                // Return current server privacy preference through the actual endpoint.
                val original = server.dispatcher
                server.dispatcher =
                    object : okhttp3.mockwebserver.Dispatcher() {
                        override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest) =
                            if (request.path ==
                                "/api/v1/me/notification-settings"
                            ) {
                                okhttp3.mockwebserver.MockResponse().setBody(
                                    repository.api.json.encodeToString(
                                        app.weiban.contracts.NotificationSettings
                                            .serializer(),
                                        settings.copy(pushShowContent = false, pushSoundEnabled = false),
                                    ),
                                )
                            } else {
                                original.dispatch(request)
                            }
                    }
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                assertEquals(
                    "你收到一条新消息",
                    manager.activeNotifications
                        .single()
                        .notification.extras
                        .getCharSequence(Notification.EXTRA_TEXT)
                        .toString(),
                )
                val restored = restarted()
                restored.restore()
                val restartedRuntime = NativePushRuntime(context, restored, transport, android.app.Activity::class.java) { now }
                assertFalse(restartedRuntime.receive(raw(envelope())))
                assertNull(repository.notifications.pending(owner, envelope().notificationId))
                assertEquals(1, manager.activeNotifications.size)
            }
        }

    @Test fun disabledBeforeTokenCompletionDoesNotBind() =
        runBlocking {
            with(fixture) {
                val token = CompletableDeferred<String>()
                transport.waitFor = token
                val enabled = async(Dispatchers.IO) { runtime.enable(owner) }
                withTimeout(5000) { while (transport.requests.get() == 0) yield() }
                val disabled = async(Dispatchers.IO) { runtime.disable(owner) }
                withTimeout(5000) { while (repository.notifications.enabled(owner)) yield() }
                token.complete("late-disabled-token")
                enabled.await()
                disabled.await()
                assertEquals(0, server.requestCount)
                assertFalse(repository.notifications.enabled(owner))
            }
        }
}
