package app.weiban.feature.chat

import android.content.Context
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.WeibanTheme
import app.weiban.network.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockWebServer
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatScreenTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var runtime: ChatRuntime
    private lateinit var scope: CoroutineScope
    private lateinit var owner: OwnerRecord

    @Before fun setup() {
        server = MockWebServer()
        server.start()
        val api = ApiClient(server.url("/").toString())
        server.shutdown()
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
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        runtime = ChatRuntime(repository, scope)
        val auth = testAuth()
        owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
        runBlocking {
            repository.authenticate(auth)
            assertTrue(repository.saveSync(owner, initial(api)))
            assertTrue(runtime.attach(owner))
        }
    }

    private fun testAuth() =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "native-test-token-".repeat(3), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-00000000001e", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )

    private fun initial(api: ApiClient): ClientSyncState {
        val vector = javaClass.getResourceAsStream("/recall-before-history.json")!!.bufferedReader().use { it.readText() }
        val raw =
            api.json
                .parseToJsonElement(vector)
                .jsonObject
                .getValue("initialState")
        return api.json.decodeFromJsonElement(ClientSyncState.serializer(), ContractJson.normalize("ClientSyncState", raw))
    }

    @After fun close() {
        runBlocking { runtime.detach() }
        scope.cancel()
        database.close()
        server.close()
    }

    @Test fun actualComposeOfflineSendCommitsRoomBeforeClearingAndSurvivesRestart() {
        compose.setContent { WeibanTheme { ChatScreen(repository, runtime, owner, {}) } }
        compose.onNodeWithText("角色", useUnmergedTree = true).performClick()
        compose.onNode(hasSetTextAction()).performTextInput("原生离线消息")
        compose.onNodeWithText("发送", useUnmergedTree = true).performClick()
        compose.waitUntil(10_000) { runBlocking { repository.loadSync(owner)?.outbox?.size == 1 } }
        val persisted = runBlocking { repository.loadSync(owner)!!.outbox.single() }
        assertEquals("原生离线消息", (persisted.body.content as UserSendableContentText).text)
        compose.onNode(hasSetTextAction()).assert(
            androidx.compose.ui.test.SemanticsMatcher.expectValue(
                androidx.compose.ui.semantics.SemanticsProperties.EditableText,
                androidx.compose.ui.text
                    .AnnotatedString(""),
            ),
        )
        compose.onNodeWithText("原生离线消息").assertExists()
        runBlocking {
            runtime.detach()
            runtime.attach(owner)
        }
        compose.waitUntil(10_000) { runtime.snapshot.value.state.outbox.size == 1 }
        assertEquals(
            persisted.body.clientMsgId,
            runtime.snapshot.value.state.outbox
                .single()
                .body.clientMsgId,
        )
        compose.onNodeWithText("原生离线消息").assertExists()
    }
}
