package app.weiban.feature.me

import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
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
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MeScreenTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private val timestamp = "2026-10-06T03:00:00.000Z"
    private val user = CurrentUser("01920000-0000-7000-8000-000000000014", "native_user", "user", false, timestamp)
    private val profile = AtomicReference(Profile(null, null, null, "unspecified", null, null, "Asia/Shanghai", timestamp))
    private val requests = ConcurrentLinkedQueue<RecordedRequest>()

    @Before fun setup() =
        runBlocking {
            server = MockWebServer()
            database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
            val vault =
                object : SessionVault {
                    var stored: AuthResponse? = null

                    override fun load() = stored

                    override fun save(auth: AuthResponse) {
                        stored = auth
                    }

                    override fun clear() {
                        stored = null
                    }
                }
            // The fixture listens on IPv4; do not let cancellation send a later request to an unused localhost IPv6 route.
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
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        requests.add(request)
                        return respond(request)
                    }
                }
            repository.authenticate(
                AuthResponse(
                    AuthenticatedSession(
                        "01920000-0000-7000-8000-000000000015",
                        "native-test-token-".repeat(3),
                        "app",
                        "2026-11-06T03:00:00.000Z",
                    ),
                    user,
                ),
            )
        }

    private fun respond(request: RecordedRequest): MockResponse {
        val json = repository.api.json
        val body =
            when (request.path) {
                "/api/v1/me/profile" -> {
                    if (request.method == "PATCH") {
                        val input = json.parseToJsonElement(request.body.clone().readUtf8()).jsonObject
                        profile.set(profile.get().copy(nickname = input["nickname"]!!.jsonPrimitive.content))
                    }
                    json.encodeToString(Profile.serializer(), profile.get())
                }
                "/api/v1/billing/wallet" ->
                    json.encodeToString(
                        Wallet.serializer(),
                        Wallet(
                            5_000_001,
                            0,
                            5_000_001,
                            1_000_000,
                            WalletBackgroundBudget(2_000_000, 0, "2026-10-07T00:00:00.000Z"),
                            timestamp,
                        ),
                    )
                "/api/v1/me/preferences" -> json.encodeToString(UserPreferences.serializer(), UserPreferences("pink", timestamp))
                "/api/v1/me" -> json.encodeToString(CurrentUser.serializer(), user.copy(profileCompleted = profile.get().nickname != null))
                else -> return MockResponse().setResponseCode(404)
            }
        return MockResponse().setHeader("Content-Type", "application/json").setBody(body)
    }

    @After fun close() {
        server.close()
        database.close()
    }

    @Test fun replacingAccountDiscardsItsSlowProfileAndShowsTheNewOwnersAvatar() {
        val old = repository.auth.value!!
        val other =
            old.copy(
                user = old.user.copy(userId = "01920000-0000-7000-8000-000000000024", username = "other_user", profileCompleted = true),
                session = old.session.copy(sessionId = "01920000-0000-7000-8000-000000000025", token = "other-test-token-".repeat(4)),
            )
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests.add(request)
                    if (request.path != "/api/v1/me/profile") return respond(request)
                    val previous = request.getHeader("Authorization") == "Bearer ${old.session.token}"
                    val value = profile.get().copy(nickname = if (previous) "旧昵称" else "新昵称")
                    return MockResponse().setBody(repository.api.json.encodeToString(Profile.serializer(), value)).apply {
                        if (previous) setBodyDelay(2, TimeUnit.SECONDS)
                    }
                }
            }
        compose.setContent { WeibanTheme { MeScreen(repository, onTheme = {}, onLogout = {}) } }
        compose.waitUntil(10_000) { requests.any { it.path == "/api/v1/me/profile" } }
        runBlocking { repository.authenticate(other) }
        try {
            compose.waitUntil(10_000) { compose.onAllNodesWithText("新昵称").fetchSemanticsNodes().isNotEmpty() }
        } catch (error: ComposeTimeoutException) {
            val calls =
                requests.map {
                    val actor = if (it.getHeader("Authorization") == "Bearer ${other.session.token}") "new" else "previous"
                    "${it.method} ${it.requestUrl?.encodedPath} $actor"
                }
            throw AssertionError("$calls\n${compose.onRoot().printToString()}", error)
        }
        compose.onNodeWithContentDescription("我的头像").assertExists()
        compose.onNodeWithText("旧昵称").assertDoesNotExist()
        assertEquals(other, repository.auth.value)
        assertFalse(requests.any { it.method == "PATCH" || it.method == "POST" })
        assertEquals(
            1,
            requests.count { it.path == "/api/v1/me/profile" && it.getHeader("Authorization") == "Bearer ${other.session.token}" },
        )
    }

    @Test fun firstProfileSaveUsesNativeFormAndRefreshesAccount() {
        var theme = "green"
        compose.setContent { WeibanTheme { MeScreen(repository, firstProfile = true, onTheme = { theme = it }, onLogout = {}) } }
        compose.waitUntil(10_000) {
            requests.size >= 3 &&
                compose
                    .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
                    .fetchSemanticsNodes()
                    .isEmpty()
        }
        compose.onNodeWithText("TA 该怎么称呼你？").assertExists()
        compose.onNodeWithText("选择并裁剪头像").assertDoesNotExist()
        compose.onNodeWithText("昵称").performTextInput("原生昵称")
        compose.onNodeWithText("下一步").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("账号：native_user").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("原生昵称").assertIsDisplayed()
        assertTrue(
            repository.auth.value!!
                .user.profileCompleted,
        )
        assertEquals("pink", theme)
        val patch = requests.single { it.method == "PATCH" }
        assertEquals("/api/v1/me/profile", patch.path)
        assertEquals(
            "原生昵称",
            repository.api.json
                .parseToJsonElement(patch.body.readUtf8())
                .jsonObject["nickname"]!!
                .jsonPrimitive.content,
        )
        assertNotNull(patch.getHeader("Authorization"))
        assertEquals(user.userId, runBlocking { database.local().owner() }!!.userId)
    }
}
