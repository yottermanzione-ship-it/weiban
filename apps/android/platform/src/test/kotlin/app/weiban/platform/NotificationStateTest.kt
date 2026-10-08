package app.weiban.platform

import app.weiban.contracts.PushDevice
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26], application = PushTestApplication::class)
class NotificationStateTest {
    private lateinit var fixture: PushFixture

    @Before fun setup() {
        fixture = PushFixture()
    }

    @After fun close() {
        fixture.close()
    }

    @Test fun inboxIsBoundedDisabledPayloadsAreDeletedAndReceiptsPreventRestartDuplicates() =
        runBlocking {
            with(fixture) {
                repository.notifications.setEnabled(owner, true)
                val ids = (1..130).map { "01920000-0000-7000-8000-" + it.toString(16).padStart(12, '0') }
                for (id in ids) assertTrue(repository.notifications.enqueue(owner, envelope().copy(notificationId = id)))
                assertNull(repository.notifications.pending(owner, ids.first()))
                assertNull(repository.notifications.pending(owner, ids[1]))
                var displayed = 0
                assertTrue(repository.notifications.publish(owner, ids.last()) { displayed++ })
                assertFalse(repository.notifications.publish(owner, ids.last()) { displayed++ })
                assertEquals(1, displayed)
                val restored = restarted()
                restored.restore()
                assertFalse(restored.notifications.enqueue(owner, envelope().copy(notificationId = ids.last())))
                assertFalse(restored.notifications.enqueue(owner, envelope().copy(recipientSessionId = replacement().session.sessionId)))
                restored.notifications.setEnabled(owner, false)
                withContext(Dispatchers.IO) {
                    database.openHelper.readableDatabase.query("SELECT count(*) FROM cache WHERE key LIKE 'notification:payload:%'").use {
                        assertTrue(it.moveToFirst())
                        assertEquals(0, it.getInt(0))
                    }
                }
            }
        }

    @Test fun disableAfterPostStartedDeletesTheCompletedRegistrationRatherThanLosingItsId() =
        runBlocking {
            with(fixture) {
                val started = CompletableDeferred<Unit>()
                val release = java.util.concurrent.CountDownLatch(1)
                val calls = java.util.concurrent.ConcurrentLinkedQueue<String>()
                server.dispatcher =
                    object : Dispatcher() {
                        override fun dispatch(request: RecordedRequest): MockResponse {
                            calls.add(request.method!!)
                            if (request.method == "POST") {
                                started.complete(Unit)
                                check(release.await(5, java.util.concurrent.TimeUnit.SECONDS))
                                return MockResponse().setBody(
                                    repository.api.json.encodeToString(
                                        PushDevice.serializer(),
                                        PushDevice(deviceId, "android", owner.sessionId, time),
                                    ),
                                )
                            }
                            return MockResponse().setResponseCode(204)
                        }
                    }
                val bind = async(Dispatchers.IO) { runtime.enable(owner) }
                withTimeout(5000) { started.await() }
                val stop = async(Dispatchers.IO) { runtime.disable(owner) }
                withTimeout(5000) { while (repository.notifications.enabled(owner)) yield() }
                release.countDown()
                bind.await()
                stop.await()
                assertEquals(listOf("POST", "DELETE"), calls.toList())
                assertNull(repository.notifications.deviceId(owner))
                assertFalse(repository.notifications.enabled(owner))
            }
        }
}
