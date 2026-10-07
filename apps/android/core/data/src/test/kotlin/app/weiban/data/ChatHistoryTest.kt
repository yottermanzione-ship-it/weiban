package app.weiban.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
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
class ChatHistoryTest {
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var runtime: ChatRuntime
    private lateinit var initial: ClientSyncState
    private lateinit var scope: CoroutineScope
    private val failures = ConcurrentLinkedQueue<Throwable>()
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "history-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-00000000001e", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)

    @Before fun setup() =
        runBlocking {
            server = MockWebServer()
            server.start()
            val api = ApiClient(server.url("/").toString())
            database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
            repository =
                SessionRepository(
                    api,
                    database,
                    object : SessionVault {
                        var value: AuthResponse? = null

                        override fun load() = value

                        override fun save(auth: AuthResponse) {
                            value = auth
                        }

                        override fun clear() {
                            value = null
                        }
                    },
                )
            val raw =
                api.json
                    .parseToJsonElement(
                        javaClass.getResourceAsStream("/recall-before-history.json")!!.bufferedReader().use {
                            it.readText()
                        },
                    ).jsonObject
            val state =
                api.json.decodeFromJsonElement(
                    ClientSyncState.serializer(),
                    ContractJson.normalize("ClientSyncState", raw.getValue("initialState")),
                )
            val message =
                raw
                    .getValue(
                        "steps",
                    ).jsonArray[2]
                    .jsonObject
                    .getValue(
                        "operation",
                    ).jsonObject
                    .getValue("update")
                    .jsonObject
                    .getValue("data")
                    .jsonObject
                    .getValue("message")
            initial =
                state.copy(
                    messages = listOf(api.json.decodeFromJsonElement(Message.serializer(), ContractJson.normalize("Message", message))),
                )
            repository.authenticate(auth)
            repository.saveSync(owner, initial)
            scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, error -> failures.add(error) })
            runtime = ChatRuntime(repository, scope)
            assertTrue(runtime.attach(owner))
        }

    @After fun close() =
        runBlocking {
            runtime.detach()
            scope.cancel()
            server.close()
            database.close()
        }

    private fun clearResponse() =
        MockResponse()
            .setBody(
                repository.api.json.encodeToString(
                    UserConversationState.serializer(),
                    initial.conversations
                        .single()
                        .state
                        .copy(clearedThroughSeq = 1),
                ),
            ).setBodyDelay(300, TimeUnit.MILLISECONDS)

    @Test fun clearAcknowledgementIsCommittedEvenAfterInitiatingScreenDisappears() =
        runBlocking {
            server.enqueue(clearResponse())
            val screen = launch { runtime.history.clear(owner, initial.conversations.single().conversationId) }
            val request = withContext(Dispatchers.IO) { server.takeRequest(3, TimeUnit.SECONDS)!! }
            assertEquals("POST", request.method)
            assertTrue(request.path!!.endsWith("/clear"))
            screen.cancelAndJoin()
            withTimeout(5_000) {
                while (repository.loadSync(owner)!!.messages.isNotEmpty()) delay(20)
            }
            val stored = repository.loadSync(owner)!!
            assertEquals(0L, stored.lastUpdateSeq)
            assertEquals(
                1L,
                stored.conversations
                    .single()
                    .state.clearedThroughSeq,
            )
            assertTrue(failures.isEmpty())
        }

    @Test fun lateOldOwnerClearCannotWriteIntoNewAccount() =
        runBlocking {
            server.enqueue(clearResponse())
            val result = async { runCatching { runtime.history.clear(owner, initial.conversations.single().conversationId) } }
            withContext(Dispatchers.IO) { server.takeRequest(3, TimeUnit.SECONDS)!! }
            val other =
                auth.copy(
                    user = auth.user.copy(userId = "01920000-0000-7000-8000-000000000024"),
                    session = auth.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"),
                )
            repository.authenticate(other)
            assertEquals("session_changed", (result.await().exceptionOrNull() as ApiFailure).code)
            assertEquals(other, repository.auth.value)
            assertNull(database.local().sync())
            assertTrue(failures.isEmpty())
        }

    @Test fun storageFailureDuringRefreshStopsRuntimeWithoutCrashingApplicationScope() =
        runBlocking {
            server.enqueue(MockResponse().setBody("{\"latestUpdateSeq\":0}"))
            database.close()
            assertNull(runtime.refresh(owner))
            assertFalse(runtime.online.value)
            assertEquals("本机保存失败，请检查设备存储后重新打开微伴", runtime.error.value)
            assertTrue(failures.isEmpty())
        }
}
