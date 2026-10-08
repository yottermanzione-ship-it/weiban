package app.weiban.platform

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.WorkManagerTestInitHelper
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.network.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import java.time.Instant
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class PushTestApplication :
    Application(),
    NativePushHost {
    override lateinit var push: NativePushRuntime

    override suspend fun prepareNativePush() { /* Fixture repository has already restored its owned session. */ }
}

internal class TestTransport : PushTransport {
    override val provider = "fcm"
    override var available = true
    val requests = AtomicInteger()
    var waitFor: CompletableDeferred<String>? = null

    override suspend fun token(): String {
        requests.incrementAndGet()
        return waitFor?.await() ?: "fixture-provider-token"
    }

    override suspend fun stop() { /* No external token service in the fixture. */ }
}

internal class PushFixture : AutoCloseable {
    val context = ApplicationProvider.getApplicationContext<PushTestApplication>()
    val database = Room.inMemoryDatabaseBuilder(context, LocalDatabase::class.java).build()
    val server = MockWebServer()
    val transport = TestTransport()
    val requests = ConcurrentLinkedQueue<RecordedRequest>()
    val time = "2026-10-07T08:00:00.000Z"
    val now = Instant.parse(time).toEpochMilli()
    val auth =
        AuthResponse(
            AuthenticatedSession(
                "01920000-0000-7000-8000-000000000015",
                "fixture-access-token-".repeat(3),
                "app",
                "2026-11-06T03:00:00.000Z",
            ),
            CurrentUser("01920000-0000-7000-8000-000000000014", "test_user", "user", true, time),
        )
    val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
    val conversationId = "01920000-0000-7000-8000-000000000031"
    val deviceId = "01920000-0000-7000-8000-000000000040"
    var settings = NotificationSettings(true, true, true, true, NotificationSettingsDoNotDisturb(false, "22:00", "08:00"), true, time)
    var muted = false
    var contentScope = "normal"
    val repository: SessionRepository
    val runtime: NativePushRuntime
    val manager get() = context.getSystemService(NotificationManager::class.java)
    private val executor = Executors.newSingleThreadExecutor()
    private val vault =
        object : SessionVault {
            var saved: AuthResponse? = null

            override fun load() = saved

            override fun save(auth: AuthResponse) {
                saved = auth
            }

            override fun clear() {
                saved = null
            }
        }

    init {
        server.start()
        repository =
            SessionRepository(
                ApiClient(
                    server
                        .url("/")
                        .newBuilder()
                        .host("127.0.0.1")
                        .build()
                        .toString(),
                ),
                database,
                vault,
            )
        runtime = NativePushRuntime(context, repository, transport, android.app.Activity::class.java) { now }
        context.push = runtime
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(executor).build())
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests.add(request)
                    return when (request.requestUrl!!.encodedPath) {
                        "/api/v1/push/devices" ->
                            MockResponse().setBody(
                                repository.api.json.encodeToString(
                                    PushDevice.serializer(),
                                    PushDevice(deviceId, "android", owner.sessionId, time),
                                ),
                            )
                        "/api/v1/push/devices/$deviceId" -> MockResponse().setResponseCode(204)
                        "/api/v1/me/notification-settings" ->
                            MockResponse().setBody(
                                repository.api.json.encodeToString(NotificationSettings.serializer(), settings),
                            )
                        "/api/v1/me/profile" ->
                            MockResponse().setBody(
                                repository.api.json.encodeToString(
                                    Profile.serializer(),
                                    Profile(null, null, null, "unspecified", null, null, "Asia/Shanghai", time),
                                ),
                            )
                        "/api/v1/conversations/$conversationId" ->
                            MockResponse().setBody(
                                repository.api.json.encodeToString(
                                    Conversation.serializer(),
                                    Conversation(
                                        conversationId,
                                        "direct",
                                        null,
                                        emptyList(),
                                        contentScope,
                                        1,
                                        null,
                                        UserConversationState(false, muted, false, 0, 0, false),
                                        1,
                                        null,
                                        time,
                                        time,
                                    ),
                                ),
                            )
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
        runBlocking { repository.authenticate(auth) }
    }

    fun envelope() =
        NotificationEnvelope(
            recipientUserId = owner.userId,
            recipientSessionId = owner.sessionId,
            notificationId = "01920000-0000-7000-8000-000000000041",
            kind = "message",
            collapseKey = "chat:$conversationId",
            title = "好友",
            body = "私密内容",
            count = 2,
            deepLink = "/chat/$conversationId",
            conversationId = conversationId,
            sound = true,
            sentAt = time,
        )

    fun raw(value: NotificationEnvelope) = repository.api.json.encodeToString(NotificationEnvelope.serializer(), value)

    fun restarted() = SessionRepository(repository.api, database, vault)

    fun replacement() = auth.copy(session = auth.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"))

    override fun close() {
        manager.cancelAll()
        executor.shutdownNow()
        server.close()
        database.close()
    }
}
