package app.weiban.feature.auth

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
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AuthScreenTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository

    @Before fun setup() {
        server = MockWebServer()
        server.start()
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
        val api = ApiClient(server.url("/").toString())
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
        repository = SessionRepository(api, database, vault)
    }

    @After fun close() {
        server.close()
        database.close()
    }

    @Test fun nativeFieldsSubmitActualHttpAndCommitSessionToRoom() {
        val auth =
            AuthResponse(
                AuthenticatedSession(
                    "01920000-0000-7000-8000-000000000015",
                    "native-test-token-".repeat(3),
                    "app",
                    "2026-11-06T03:00:00.000Z",
                ),
                CurrentUser("01920000-0000-7000-8000-000000000014", "native_user", "user", false, "2026-10-06T03:00:00.000Z"),
            )
        server.enqueue(MockResponse().setBody(repository.api.json.encodeToString(AuthResponse.serializer(), auth)))
        compose.setContent { WeibanTheme { AuthScreen(repository) } }
        compose.onNodeWithText("用户名").performTextInput("native_user")
        compose.onNodeWithText("密码").performTextInput("native-test-password")
        compose.onNodeWithText("登录", useUnmergedTree = true).performClick()
        compose.waitUntil(10_000) { repository.auth.value != null }
        val request = server.takeRequest()
        assertEquals("/api/v1/auth/login", request.path)
        assertTrue(request.body.readUtf8().contains("\"platform\":\"android\""))
        assertEquals(auth.user.userId, runBlocking { database.local().owner() }!!.userId)
    }

    @Test fun failedCredentialsAreVisibleAndDoNotPersistSession() {
        server.enqueue(
            MockResponse()
                .setResponseCode(
                    401,
                ).setBody("""{"error":{"code":"invalid_credentials","message":"bad credentials","requestId":"native-test"}}"""),
        )
        compose.setContent { WeibanTheme { AuthScreen(repository) } }
        compose.onNodeWithText("用户名").performTextInput("native_user")
        compose.onNodeWithText("密码").performTextInput("native-test-password")
        compose.onNodeWithText("登录", useUnmergedTree = true).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("用户名或密码不正确").fetchSemanticsNodes().isNotEmpty() }
        assertNull(repository.auth.value)
        assertNull(runBlocking { database.local().owner() })
    }
}
