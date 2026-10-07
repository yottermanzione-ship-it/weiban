package app.weiban.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
class ChatRealtimeTest {
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var api: ApiClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val frames = ConcurrentLinkedQueue<ClientFrame>()
    private val operations = ConcurrentLinkedQueue<ClientSyncOperation>()
    private val peer = AtomicReference<WebSocket?>(null)
    private lateinit var transport: ChatRealtime
    private val conversationId = "01920000-0000-7000-8000-00000000000a"
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "ws-test-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-000000000014", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )

    @Before fun setup() {
        server = MockWebServer()
        server.start()
        api = ApiClient(server.url("/").toString())
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
        val vault =
            object : SessionVault {
                var value: AuthResponse? = null

                override fun load() = value

                override fun save(auth: AuthResponse) {
                    value = auth
                }

                override fun clear() {
                    value = null
                }
            }
        repository = SessionRepository(api, database, vault)
        runBlocking { repository.authenticate(auth) }
        server.enqueue(MockResponse().withWebSocketUpgrade(listener()))
        transport = ChatRealtime(repository, auth, scope, { 0 }, { operations.add(it) }, {})
    }

    private fun listener() =
        object : WebSocketListener() {
            override fun onOpen(
                webSocket: WebSocket,
                response: Response,
            ) {
                peer.set(webSocket)
            }

            override fun onMessage(
                webSocket: WebSocket,
                text: String,
            ) {
                val frame = api.json.decodeFromString(ClientFrame.serializer(), text)
                frames.add(frame)
                if (frame is ClientFrameAuth) {
                    send(
                        webSocket,
                        ServerFrameAuthOk(
                            data =
                                ServerFrameAuthOkData(
                                    auth.user.userId,
                                    auth.session.sessionId,
                                    0,
                                    CONTRACT_VERSION,
                                    "2026-10-07T03:00:00.000Z",
                                ),
                        ),
                    )
                }
            }

            override fun onClosing(
                webSocket: WebSocket,
                code: Int,
                reason: String,
            ) {
                webSocket.close(code, reason)
            }
        }

    private fun send(
        webSocket: WebSocket,
        frame: ServerFrame,
    ) {
        assertTrue(webSocket.send(api.json.encodeToString(ServerFrame.serializer(), frame)))
    }

    @After fun close() {
        transport.stop()
        scope.cancel()
        server.close()
        database.close()
    }

    @Test fun realUpgradeUsesFirstAuthFrameAndRoutesOwnedUpdatesTypingAndPresence() =
        runBlocking {
            transport.focus(conversationId, true)
            transport.start()
            withTimeout(5_000) { while (frames.size < 2 || operations.isEmpty()) delay(10) }
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("/api/v1/ws", request.path)
            assertNull(request.getHeader("Authorization"))
            assertTrue(frames.first() is ClientFrameAuth)
            val first = frames.first() as ClientFrameAuth
            assertEquals(auth.session.token, first.data.token)
            assertEquals(CONTRACT_VERSION, first.data.contractVersion)
            assertEquals("android", first.data.device.platform)
            val focus = frames.filterIsInstance<ClientFramePresenceFocus>().single()
            assertEquals(conversationId, focus.data.conversationId)
            assertTrue(focus.data.foreground)
            send(peer.get()!!, ServerFrameTyping(data = ServerFrameTypingData(conversationId, auth.user.userId, "start")))
            withTimeout(2_000) { transport.typing.first { it.isNotEmpty() } }
            val vector = javaClass.getResourceAsStream("/recall-before-history.json")!!.bufferedReader().use { it.readText() }
            val raw =
                api.json
                    .parseToJsonElement(vector)
                    .jsonObject
                    .getValue("steps")
                    .jsonArray
                    .first()
                    .jsonObject
                    .getValue("operation")
            val update = api.json.decodeFromJsonElement(ClientSyncOperation.serializer(), raw) as ClientSyncOperationUpdate
            send(peer.get()!!, ServerFrameUpdate(data = update.update))
            withTimeout(2_000) { while (operations.none { it is ClientSyncOperationUpdate }) delay(10) }
            assertEquals(update.update, (operations.last() as ClientSyncOperationUpdate).update)
            transport.stop()
            assertTrue(transport.typing.value.isEmpty())
        }

    @Test fun oldSocketUnauthenticatedCloseCannotForgetNewAccount() =
        runBlocking {
            transport.start()
            withTimeout(5_000) { while (operations.isEmpty()) delay(10) }
            val other =
                auth.copy(
                    session = auth.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"),
                    user = auth.user.copy(userId = "01920000-0000-7000-8000-000000000024"),
                )
            repository.authenticate(other)
            assertTrue(peer.get()!!.close(4401, "session revoked"))
            withTimeout(5_000) { while (transport.active) delay(10) }
            assertEquals(other, repository.auth.value)
            assertEquals(other.session.sessionId, database.local().owner()!!.sessionId)
        }
}
