package app.weiban.feature.chat

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.WeibanTheme
import app.weiban.network.ApiClient
import app.weiban.network.SessionVault
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentLinkedQueue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CustomCharacterTrialTest {
    @get:Rule val compose = createComposeRule()
    private val requests = ConcurrentLinkedQueue<RecordedRequest>()
    private val conversationId = "01920000-0000-7000-8000-000000000010"
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var runtime: ChatRuntime
    private lateinit var scope: CoroutineScope
    private lateinit var owner: OwnerRecord

    @Before fun setup() {
        server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests.add(request)
                    val response =
                        when {
                            request.method == "POST" && request.path == "/api/v1/characters/custom/trial" ->
                                """{
                                  "characterId":"01920000-0000-7000-8000-000000000011",
                                  "conversationId":"$conversationId",
                                  "expiresAt":"2026-10-11T09:00:00Z"
                                }"""
                            request.method == "GET" && request.path?.contains("/messages") == true -> """{"items":[],"hasMore":false}"""
                            request.method == "DELETE" -> """{"ended":true}"""
                            else -> return MockResponse().setResponseCode(404)
                        }
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(response)
                }
            }
        server.start()
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
        val api =
            ApiClient(
                server
                    .url("/")
                    .newBuilder()
                    .host("127.0.0.1")
                    .build()
                    .toString(),
            )
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
        val auth =
            AuthResponse(
                AuthenticatedSession(
                    "01920000-0000-7000-8000-000000000015",
                    "native-test-token-".repeat(3),
                    "app",
                    "2026-11-06T03:00:00.000Z",
                ),
                CurrentUser("01920000-0000-7000-8000-00000000001e", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
            )
        owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
        runBlocking { repository.authenticate(auth) }
    }

    @After fun close() {
        scope.cancel()
        database.close()
        server.shutdown()
    }

    @Test fun unsavedDraftStartsIndependentTrialAndReturnsToSameFieldsAfterCleanup() {
        val open = CustomEditorOpen(owner)
        compose.setContent {
            WeibanTheme { CustomCharacterEditor(repository, runtime, open) {} }
        }
        val name = "临时试聊角色"
        val description = "这是一位喜欢日常生活的原创成年角色，性格温柔耐心，喜欢散步和读书，说话自然简短，对别人友善，并且尊重他人的个人边界。"
        compose.onNode(hasSetTextAction() and hasText("名字（必填）")).performTextInput(name)
        compose.onNode(hasSetTextAction() and hasText("人设描述（至少50字）")).performTextInput(description)
        compose.onNodeWithText("保存前试聊").performScrollTo().performClick()
        compose.waitUntil(10000) { requests.any { it.method == "GET" && it.path?.contains("/messages") == true } }
        compose.onNodeWithText("和$name 试聊").assertIsDisplayed()
        val created =
            requests
                .first { it.method == "POST" }
                .body
                .clone()
                .readUtf8()
        val fields = Json.parseToJsonElement(created).jsonObject
        assertEquals(name, fields.getValue("name").jsonPrimitive.content)
        assertEquals(description, fields.getValue("description").jsonPrimitive.content)
        assertFalse(requests.any { it.path == "/api/v1/characters/custom" })
        compose.onNodeWithText("结束试聊，返回编辑").performClick()
        compose.waitUntil(10000) { requests.any { it.method == "DELETE" } }
        compose.waitUntil(10000) { compose.onAllNodesWithText("和$name 试聊").fetchSemanticsNodes().isEmpty() }
        compose.onNode(hasSetTextAction() and hasText("名字（必填）")).assertTextContains(name)
        compose.onNode(hasSetTextAction() and hasText("人设描述（至少50字）")).assertTextContains(description)
        assertTrue(requests.any { it.method == "DELETE" && it.path == "/api/v1/characters/custom/trial/$conversationId" })
    }
}
