package app.weiban.feature.chat

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
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
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RoleBrowserTest {
    val compose = createComposeRule()

    @get:Rule val resources =
        RuleChain
            .outerRule(
                object : ExternalResource() {
                    override fun after() {
                        closeResources()
                    }
                },
            ).around(compose)
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var runtime: ChatRuntime
    private lateinit var api: ApiClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val posts = ConcurrentLinkedQueue<AddContactRequestInput>()
    private val requests = ConcurrentLinkedQueue<String>()
    private val opened = ConcurrentLinkedQueue<String>()

    @Volatile private var accepted = false

    @Volatile private var catalogBodyDelayMs = 0L
    private val firstId = "01920000-0000-7000-8000-00000000001a"
    private val secondId = "01920000-0000-7000-8000-00000000001b"
    private val conversationId = "01920000-0000-7000-8000-000000000099"
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "role-test-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-000000000014", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)

    @Before fun setup() =
        runBlocking {
            server = MockWebServer()
            server.start()
            api =
                ApiClient(
                    server
                        .url("/")
                        .newBuilder()
                        .host("127.0.0.1")
                        .build()
                        .toString(),
                )
            database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
            repository =
                SessionRepository(
                    api,
                    database,
                    object : SessionVault {
                        private var value: AuthResponse? = null

                        override fun load() = value

                        override fun save(auth: AuthResponse) {
                            value = auth
                        }

                        override fun clear() {
                            value = null
                        }
                    },
                )
            repository.authenticate(auth)
            repository.saveSync(owner, SyncEngine.freshState().copy(initialized = true))
            server.dispatcher = responses()
            runtime = ChatRuntime(repository, scope)
            assertTrue(runtime.attach(owner))
        }

    private fun closeResources() {
        runBlocking {
            if (::runtime.isInitialized) runtime.detach()
            scope.coroutineContext[Job]?.cancelAndJoin()
        }
        if (::database.isInitialized) database.close()
        if (::server.isInitialized) server.close()
    }

    private fun role(id: String) =
        CharacterProfile(
            id,
            "preset",
            if (id == firstId) "纸飞机" else "星河",
            CharacterAvatar(null, CharacterDisplay(emptyList(), null, "star", null)),
            "陪你聊聊",
            emptyList(),
            null,
            "original",
            false,
            emptyList(),
            emptyList(),
            "一起认识身边的世界",
            null,
            null,
            CharacterClassification(
                "original",
                null,
                "adult",
                false,
                false,
                CharacterClassificationDerived(false, true, true, "allowed", false),
            ),
            false,
            1,
            false,
        )

    private fun contact(
        id: String,
        pending: Boolean,
    ) = Contact(
        id,
        if (pending) "pending" else "active",
        if (pending) null else "小纸",
        null,
        null,
        "2026-10-07",
        if (pending) null else conversationId,
        "2026-10-07T03:00:00.000Z",
    )

    private fun responses() =
        object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl!!.encodedPath
                requests.add("${request.method} $path")
                return when {
                    path == "/api/v1/contacts" && request.method == "POST" -> addResponse(request)
                    path == "/api/v1/sync/state" -> MockResponse().setBody("{\"latestUpdateSeq\":${if (accepted) 1 else 0}}")
                    path == "/api/v1/sync/updates" -> {
                        val update =
                            UserUpdateContactUpserted(
                                1,
                                "2026-10-07T03:00:00.000Z",
                                data = UserUpdateContactUpsertedData(contact(secondId, false)),
                            )
                        MockResponse().setBody(
                            api.json.encodeToString(
                                SyncEndpointsGetUpdatesResponse.serializer(),
                                SyncEndpointsGetUpdatesResponse(listOf(update), 1, false),
                            ),
                        )
                    }
                    path == "/api/v1/characters/categories" -> MockResponse().setBody("{\"items\":[]}")
                    path == "/api/v1/characters" -> plaza(request)
                    path.startsWith(
                        "/api/v1/characters/",
                    ) -> MockResponse().setBody(api.json.encodeToString(CharacterProfile.serializer(), role(path.substringAfterLast('/'))))
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }

    private fun plaza(request: RecordedRequest): MockResponse {
        val second = request.requestUrl!!.queryParameter("cursor") != null
        val profile = role(if (second) secondId else firstId)
        val summary =
            CharacterSummary(
                profile.characterId,
                profile.kind,
                profile.name,
                profile.avatar,
                profile.tagline,
                profile.tags,
                null,
                profile.basis,
                false,
            )
        return MockResponse()
            .setBody(
                api.json.encodeToString(
                    CharacterEndpointsSearchPlazaResponse.serializer(),
                    CharacterEndpointsSearchPlazaResponse(listOf(summary), if (second) null else "next-page"),
                ),
            ).setBodyDelay(catalogBodyDelayMs, TimeUnit.MILLISECONDS)
    }

    private fun addResponse(request: RecordedRequest): MockResponse {
        assertEquals("Bearer ${auth.session.token}", request.getHeader("Authorization"))
        val body = api.json.decodeFromString(AddContactRequestInput.serializer(), request.body.readUtf8())
        posts.add(body)
        return if (body.restoreMode == null) {
            MockResponse().setResponseCode(409).setBody(
                """{"error":{"code":"restore_choice_required","message":"choose","requestId":"native-role-test"}}""",
            )
        } else {
            MockResponse().setBody(api.json.encodeToString(Contact.serializer(), contact(body.characterId, true)))
        }
    }

    private fun awaitFirstRole() {
        try {
            compose.waitUntil(10_000) { compose.onAllNodesWithText("纸飞机").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("纸飞机").assertIsDisplayed()
        } catch (error: ComposeTimeoutException) {
            // 只记录测试请求的路径，不包含Authorization或用户消息；原始超时作为cause保留。
            throw AssertionError("首次角色未显示；请求数=${server.requestCount}；路径=${requests.toList()}\n${compose.onRoot().printToString()}", error)
        }
    }

    @Test fun delayedCatalogResponseDisplaysFirstRoleWithoutInteraction() {
        catalogBodyDelayMs = 750
        compose.setContent { WeibanTheme { RoleBrowser(repository, runtime, owner, true, opened::add) } }
        awaitFirstRole()
        assertTrue(requests.any { it == "GET /api/v1/characters" })
        assertTrue(posts.isEmpty())
        assertTrue(opened.isEmpty())
    }

    @Test fun actualPlazaPaginationGreetingAndRestoreChoiceUseRealHttp() {
        compose.setContent { WeibanTheme { RoleBrowser(repository, runtime, owner, true, opened::add) } }
        awaitFirstRole()
        compose.onNodeWithText("下一页角色").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("星河").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasText("星河") and !hasSetTextAction()).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("一起认识身边的世界").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performTextInput("你好，期待认识你")
        compose.onNodeWithText("添加到通讯录").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("你们以前认识过").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("恢复旧记录").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("等待通过好友申请").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(2, posts.size)
        assertTrue(posts.all { it.characterId == secondId && it.greeting == "你好，期待认识你" })
        assertEquals("restore", posts.last().restoreMode)
        assertTrue(opened.isEmpty())
    }

    // 换壳第一批（339f723）：通讯录顶部多了 6 行入口（新的朋友、新建角色、群聊…），Robolectric 默认 470dp 高的屏幕
    // 放不下联系人行（LazyColumn 不组合屏外行），这里用常见手机尺寸。
    @Config(qualifiers = "w411dp-h891dp")
    @Test fun actualContactsSearchUsesCanonicalNamesAndPendingCannotOpenChat() {
        runBlocking {
            runtime.detach()
            repository.saveSync(
                owner,
                SyncEngine.freshState().copy(initialized = true, contacts = listOf(contact(firstId, false), contact(secondId, true))),
            )
            runtime.attach(owner)
        }
        compose.setContent { WeibanTheme { RoleBrowser(repository, runtime, owner, false, opened::add) } }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("星河").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performTextInput("星河")
        compose.onNodeWithText("小纸").assertDoesNotExist()
        compose.onNode(hasText("星河") and !hasSetTextAction()).performClick()
        compose.onNodeWithText("等待通过好友申请").assertExists()
        compose.onNodeWithText("发消息").assertDoesNotExist()
        compose.onNodeWithText("‹").performClick()
        compose.onNode(hasSetTextAction()).performTextClearance()
        compose.onNodeWithText("小纸").performClick()
        val sendButton = compose.onNodeWithText("发消息").performScrollTo()
        val beforeBounds = sendButton.fetchSemanticsNode().boundsInRoot
        sendButton.performClick()
        try {
            compose.waitUntil(10_000) { opened.isNotEmpty() }
        } catch (error: ComposeTimeoutException) {
            val afterBounds = runCatching { sendButton.fetchSemanticsNode().boundsInRoot }.getOrNull()
            throw AssertionError(
                "发消息未打开；点击前=$beforeBounds；结束时=$afterBounds；请求路径=${requests.toList()}\n${compose.onRoot().printToString()}",
                error,
            )
        }
        assertEquals(listOf(conversationId), opened.toList())
        assertTrue(posts.isEmpty())
    }

    private fun beginOnboarding() =
        runBlocking {
            repository.authenticate(auth.copy(user = auth.user.copy(profileCompleted = false)))
            repository.updateUser(auth.user)
            repository.saveSync(owner, SyncEngine.freshState().copy(initialized = true))
        }

    @Test fun firstUseWaitsForAcceptedContactAndThenOpensServerConversation() {
        beginOnboarding()
        compose.setContent { WeibanTheme { RoleBrowser(repository, runtime, owner, true, opened::add, onboarding = true) } }
        compose.onNodeWithText("先加一个你喜欢的 TA 吧").assertExists()
        compose.onNodeWithText("返回通讯录").assertDoesNotExist()
        awaitFirstRole()
        compose.onNodeWithText("下一页角色").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("星河").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasText("星河") and !hasSetTextAction()).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("一起认识身边的世界").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("添加到通讯录").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("你们以前认识过").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("恢复旧记录").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("等待通过好友申请").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(opened.isEmpty())
        accepted = true
        // Match production refresh dispatch; do not block the test/UI thread
        // while the accepted-contact update drives Compose navigation.
        scope.launch { runtime.refresh(owner) }
        compose.waitUntil(10_000) { opened.isNotEmpty() }
        assertEquals(listOf(conversationId), opened.toList())
        assertEquals(
            conversationId,
            runBlocking {
                repository
                    .loadSync(owner)!!
                    .contacts
                    .single()
                    .conversationId
            },
        )
    }

    @Test fun selectedRoleAndGreetingSurviveDisposingAndRecreatingTheOnboardingUi() {
        beginOnboarding()
        var mounted by androidx.compose.runtime.mutableStateOf(true)
        compose.setContent {
            WeibanTheme { if (mounted) RoleBrowser(repository, runtime, owner, true, opened::add, onboarding = true) }
        }
        awaitFirstRole()
        compose.onNode(hasText("纸飞机") and !hasSetTextAction()).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("一起认识身边的世界").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performTextInput("很高兴认识你")
        compose.waitUntil(10_000) { runBlocking { repository.onboardingDraft.load(owner)?.greeting == "很高兴认识你" } }
        compose.runOnIdle { mounted = false }
        compose.onNodeWithText("一起认识身边的世界").assertDoesNotExist()
        compose.runOnIdle { mounted = true }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("一起认识身边的世界").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).assertTextContains("很高兴认识你")
        compose.onNodeWithText("添加到通讯录").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("你们以前认识过").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(firstId, posts.single().characterId)
        assertEquals("很高兴认识你", posts.single().greeting)
        assertTrue(opened.isEmpty())
    }
}
