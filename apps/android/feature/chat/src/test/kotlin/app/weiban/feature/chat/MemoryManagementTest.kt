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
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MemoryManagementTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private val entry = AtomicReference<JsonObject?>(null)
    private val characterId = "01920000-0000-7000-8000-000000000019"
    private val memoryId = "01920000-0000-7000-8000-000000000020"
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "memory-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
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
                        var stored: AuthResponse? = null

                        override fun load() = stored

                        override fun save(auth: AuthResponse) {
                            stored = auth
                        }

                        override fun clear() {
                            stored = null
                        }
                    },
                )
            repository.authenticate(auth)
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        if (request.getHeader("Authorization") != "Bearer ${auth.session.token}") return MockResponse().setResponseCode(401)
                        return when (request.method) {
                            "GET" ->
                                json(
                                    buildJsonObject {
                                        put("items", JsonArray(listOfNotNull(entry.get())))
                                        put("nextCursor", JsonNull)
                                    },
                                )
                            "POST" -> {
                                val body = api.json.parseToJsonElement(request.body.readUtf8()).jsonObject
                                val created = record(body.getValue("content").jsonPrimitive.content)
                                entry.set(created)
                                json(created).setResponseCode(201)
                            }
                            "PATCH" -> {
                                val body = api.json.parseToJsonElement(request.body.readUtf8()).jsonObject
                                val updated = JsonObject(entry.get()!! + body + ("updatedAt" to JsonPrimitive("2026-10-08T03:01:00.000Z")))
                                entry.set(updated)
                                json(updated)
                            }
                            "DELETE" -> {
                                entry.set(null)
                                MockResponse().setResponseCode(204)
                            }
                            else -> MockResponse().setResponseCode(404)
                        }
                    }
                }
            compose.setContent { WeibanTheme { MemoryManagement(repository, owner, characterId) {} } }
        }

    private fun json(body: JsonElement) = MockResponse().setHeader("Content-Type", "application/json").setBody(body.toString())

    private fun record(content: String) =
        buildJsonObject {
            put("memoryId", memoryId)
            put("characterId", characterId)
            put("category", "basic")
            put("content", content)
            put("status", "current")
            put("importance", 5)
            put("dueAt", JsonNull)
            put("visibility", "only_this_character")
            put("sharingClass", "never")
            put("scope", "normal")
            put("sourceMessageIds", JsonArray(emptyList()))
            put("createdBy", "user_manual")
            put("knownBy", JsonArray(listOf(JsonPrimitive(characterId))))
            put("createdAt", "2026-10-08T03:00:00.000Z")
            put("updatedAt", "2026-10-08T03:00:00.000Z")
        }

    @After fun close() {
        database.close()
        server.close()
    }

    @Test fun actualHttpAddEditDeleteRequiresConfirmationAndNeverCachesPrivateMemory() {
        compose.waitUntil(10_000) { compose.onAllNodesWithText("还没有记下的事情").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("我想让TA记住…").performTextInput("原生记忆金丝雀：猫叫团子")
        compose.onNodeWithText("添加记忆").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("原生记忆金丝雀：猫叫团子").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("记忆内容").performScrollTo().performTextReplacement("原生记忆金丝雀：猫改叫芝麻")
        compose.onNodeWithText("保存修改").performScrollTo().performClick()
        compose.waitUntil(10_000) {
            entry
                .get()
                ?.get("content")
                ?.jsonPrimitive
                ?.content == "原生记忆金丝雀：猫改叫芝麻"
        }
        compose.waitUntil(10_000) {
            compose.onAllNodes(hasText("删除这条记忆") and isEnabled()).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("删除这条记忆").performScrollTo().performClick()
        assertNotNull(entry.get())
        compose.onNodeWithText("确认让TA忘记这条？").assertIsDisplayed()
        compose.onNodeWithText("确认删除").performClick()
        compose.waitUntil(10_000) { entry.get() == null }
        runBlocking {
            database.openHelper.readableDatabase.query("SELECT key,value FROM cache").use { cursor ->
                var count = 0
                while (cursor.moveToNext()) {
                    assertEquals("ui:onboarding", cursor.getString(0))
                    assertFalse(cursor.getString(1).contains("原生记忆金丝雀"))
                    count++
                }
                assertEquals(1, count)
            }
        }
    }
}
