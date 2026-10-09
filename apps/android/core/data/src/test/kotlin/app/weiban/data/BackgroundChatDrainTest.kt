package app.weiban.data

import android.content.Context
import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
class BackgroundChatDrainTest {
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var api: ApiClient
    private lateinit var runtime: ChatRuntime
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val ids = ConcurrentLinkedQueue<String>()
    private val queued = ConcurrentLinkedQueue<OwnerRecord>()
    private val conversationId = "01920000-0000-7000-8000-00000000000a"
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "drain-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-000000000014", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)

    @Before fun setup() =
        runBlocking {
            server = MockWebServer()
            server.start()
            api = ApiClient(server.url("/").toString())
            database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
            val vault =
                object : SessionVault {
                    private var value: AuthResponse? = null

                    override fun load() = value

                    override fun save(auth: AuthResponse) {
                        value = auth
                    }

                    override fun clear() {
                        value = null
                    }
                }
            repository = SessionRepository(api, database, vault)
            repository.authenticate(auth)
            repository.saveSync(owner, SyncEngine.freshState().copy(initialized = true))
            runtime = ChatRuntime(repository, scope) { queued.add(it) }
            assertTrue(runtime.attach(owner))
        }

    @After fun close() =
        runBlocking {
            runtime.detach()
            scope.cancel()
            server.close()
            database.close()
        }

    private fun responses(delayBody: Boolean = false) =
        object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                when (request.method) {
                    "GET" -> MockResponse().setBody("{\"latestUpdateSeq\":0}")
                    "POST" -> {
                        val body = api.json.decodeFromString(SendMessageRequest.serializer(), request.body.readUtf8())
                        ids.add(body.clientMsgId)
                        val message =
                            Message(
                                messageId = "01920000-0000-7000-8000-000000000099",
                                conversationId = conversationId,
                                seq = 1,
                                senderParticipantId = auth.user.userId,
                                senderKind = "user",
                                content = ReceivedMessageContentText(text = (body.content as UserSendableContentText).text),
                                quote = null,
                                status = "normal",
                                scope = "normal",
                                clientMsgId = body.clientMsgId,
                                createdAt = "2026-10-07T03:00:00.000Z",
                                recalledAt = null,
                            )
                        val response =
                            MockResponse().setBody(
                                api.json.encodeToString(MessageAck.serializer(), MessageAck(body.clientMsgId, message)),
                            )
                        if (delayBody) response.setBodyDelay(3, TimeUnit.SECONDS) else response
                    }
                    else -> MockResponse().setResponseCode(404)
                }
        }

    @Test fun backgroundSendsDurableQueueAndPausesWhenLeaseEnds() =
        runBlocking {
            server.dispatcher = responses()
            runtime.send(owner, conversationId, "后台恢复")
            val original =
                repository
                    .loadSync(owner)!!
                    .outbox
                    .single()
                    .body.clientMsgId
            assertEquals(ChatDrainResult.COMPLETE, BackgroundChatDrain(repository, runtime).drain(owner, 8_000))
            assertEquals(listOf(original), ids.toList())
            val stored = repository.loadSync(owner)!!
            assertTrue(stored.outbox.isEmpty())
            assertEquals(original, stored.messages.single().clientMsgId)
            assertFalse(runtime.online.value)
        }

    @Test fun deadlinePreservesOriginalIdAndNextLeaseRetriesSameMessage() =
        runBlocking {
            server.dispatcher = responses(delayBody = true)
            runtime.send(owner, conversationId, "响应中断后恢复")
            val original =
                repository
                    .loadSync(owner)!!
                    .outbox
                    .single()
                    .body.clientMsgId
            val drain = BackgroundChatDrain(repository, runtime)
            assertEquals(ChatDrainResult.RETRY, drain.drain(owner, 1_000))
            assertEquals(
                original,
                repository
                    .loadSync(owner)!!
                    .outbox
                    .single()
                    .body.clientMsgId,
            )
            assertFalse(runtime.online.value)
            server.dispatcher = responses()
            assertEquals(ChatDrainResult.COMPLETE, drain.drain(owner, 8_000))
            assertEquals(listOf(original, original), ids.toList())
            assertEquals(1, repository.loadSync(owner)!!.messages.size)
        }

    @Test fun staleWorkCannotUseNewAccountOrSendItsQueue() =
        runBlocking {
            runtime.send(owner, conversationId, "旧账号队列")
            val other =
                auth.copy(
                    user = auth.user.copy(userId = "01920000-0000-7000-8000-000000000024"),
                    session = auth.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"),
                )
            repository.authenticate(other)
            assertEquals(ChatDrainResult.STALE, BackgroundChatDrain(repository, runtime).drain(owner))
            assertEquals(other, repository.auth.value)
            assertEquals(other.user.userId, database.local().owner()!!.userId)
            assertNull(database.local().sync())
            val body = SendMessageRequest("01920000-0000-7000-8000-000000000088", UserSendableContentText(text = "迟到旧任务"), null)
            val operations = SyncHttp(repository, owner).execute(ClientSyncEffectSend(conversationId = conversationId, body = body))
            assertTrue(operations.single() is ClientSyncOperationSendFailed)
            val stalePost = runCatching { repository.call(Endpoints.identityEndpointsLogout, options = SessionCallOptions(owner = owner)) }
            assertEquals("session_changed", (stalePost.exceptionOrNull() as ApiFailure).code)
            assertEquals(other, repository.auth.value)
            assertEquals(0, server.requestCount)
        }

    @Test fun disappearingScreenStillSchedulesWorkAfterBlockedRoomCommit() =
        runBlocking {
            val locked = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val transaction =
                launch(Dispatchers.IO) {
                    database.withTransaction {
                        locked.complete(Unit)
                        release.await()
                    }
                }
            withTimeout(3_000) { locked.await() }
            val screen = launch(start = CoroutineStart.UNDISPATCHED) { runtime.send(owner, conversationId, "切换页面时发送") }
            screen.cancel()
            release.complete(Unit)
            withTimeout(5_000) {
                screen.join()
                transaction.join()
            }
            assertEquals(
                "切换页面时发送",
                (
                    repository
                        .loadSync(owner)!!
                        .outbox
                        .single()
                        .body.content as UserSendableContentText
                ).text,
            )
            assertEquals(listOf(owner), queued.toList())
            assertEquals(0, server.requestCount)
        }
}
