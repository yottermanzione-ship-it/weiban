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
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatInformationTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var runtime: ChatRuntime
    private lateinit var initial: ClientSyncState
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutations = ConcurrentLinkedQueue<String>()
    private val removed = AtomicBoolean(false)
    private val ready = AtomicBoolean(false)
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "information-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-00000000001e", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
    private val time = "2026-10-07T03:00:00.000Z"

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
            initial =
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
                initial.copy(
                    messages = listOf(api.json.decodeFromJsonElement(Message.serializer(), ContractJson.normalize("Message", message))),
                )
            repository.authenticate(auth)
            repository.saveSync(owner, initial)
            runtime = ChatRuntime(repository, scope)
            runtime.attach(owner)
            server.dispatcher = responses()
            showInformation()
        }

    private fun showInformation() {
        compose.setContent {
            WeibanTheme {
                ChatInformation(repository, runtime, owner, initial, initial.conversations.single(), {}) {
                    val durable = runBlocking { repository.loadSync(owner)!! }
                    assertTrue(durable.messages.isEmpty())
                    assertTrue(
                        durable.conversations
                            .single()
                            .state.hidden,
                    )
                    removed.set(true)
                }
            }
        }
    }

    @After fun close() =
        runBlocking {
            runtime.detach()
            scope.cancel()
            server.close()
            database.close()
        }

    private fun responses() =
        object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl!!.encodedPath
                if (request.method == "POST" || request.method == "DELETE" || request.method == "PATCH") {
                    mutations.add(request.method + " " + request.path)
                    ready.set(true)
                    return if (request.method == "DELETE") {
                        MockResponse().setResponseCode(204)
                    } else {
                        MockResponse().setBody(repository.api.json.encodeToString(UserConversationState.serializer(), changedState()))
                    }
                }
                return when {
                    path.endsWith("/sync/state") -> MockResponse().setBody("{\"latestUpdateSeq\":" + if (ready.get()) "1}" else "0}")
                    path.endsWith("/sync/updates") -> {
                        val update =
                            UserUpdateConversationStateUpdated(
                                updateSeq = 1,
                                occurredAt = time,
                                data =
                                    UserUpdateConversationStateUpdatedData(
                                        initial.conversations.single().conversationId,
                                        changedState(),
                                        0,
                                    ),
                            )
                        val page = SyncEndpointsGetUpdatesResponse(listOf(update), 1, false)
                        MockResponse().setBody(repository.api.json.encodeToString(SyncEndpointsGetUpdatesResponse.serializer(), page))
                    }
                    path.endsWith(
                        "/companion-settings",
                    ) ->
                        MockResponse().setBody(
                            "{\"instantReply\":false,\"splitBubbles\":false,\"updatedAt\":\"$time\",\"inheritsDefaults\":true}",
                        )
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }

    private fun changedState() =
        initial.conversations.single().state.copy(
            clearedThroughSeq = if (mutations.any { it.startsWith("PATCH") }) 0 else 1,
            pinned = mutations.any { it.startsWith("PATCH") },
            hidden =
                mutations.any {
                    it.startsWith("DELETE")
                },
        )

    @Test fun pinToggleHasAccessibleLabelAndPersistsActualServerState() {
        compose.onNodeWithContentDescription("置顶聊天").performClick()
        compose.waitUntil(10_000) {
            runBlocking {
                repository
                    .loadSync(owner)!!
                    .conversations
                    .single()
                    .state.pinned
            }
        }
        assertEquals(1, mutations.size)
        assertTrue(mutations.single().startsWith("PATCH "))
        assertTrue(mutations.single().endsWith("/state"))
        assertTrue(runBlocking { repository.loadSync(owner)!!.messages.isNotEmpty() })
    }

    @Test fun cancellingClearDoesNotCallApiAndConfirmedClearIsDurable() {
        compose.onNodeWithText("清空聊天记录").performScrollTo().performClick()
        compose.onNodeWithText("取消").performClick()
        assertTrue(mutations.isEmpty())
        compose.onNodeWithText("清空聊天记录").performClick()
        compose.onNodeWithText("确认").performClick()
        compose.waitUntil(10_000) { runBlocking { repository.loadSync(owner)!!.lastUpdateSeq == 1L } }
        assertEquals(1, mutations.size)
        assertTrue(mutations.single().endsWith("/clear"))
        assertTrue(runBlocking { repository.loadSync(owner)!!.messages.isEmpty() })
        compose.onNodeWithText("已保存").assertExists()
    }

    @Test fun permanentRemovalRequiresTwoConfirmationsAndDurableSyncBeforeLeaving() {
        compose.onNodeWithText("永久删除角色和数据").performScrollTo().performClick()
        compose.onNodeWithText("确认").performClick()
        assertTrue(mutations.isEmpty())
        compose.onNodeWithText("再次确认永久删除：重新添加也无法恢复这些数据").assertExists()
        compose.onNodeWithText("确认").performClick()
        compose.waitUntil(10_000) { removed.get() }
        assertEquals(1, mutations.size)
        assertTrue(mutations.single().contains("mode=purge"))
    }
}
