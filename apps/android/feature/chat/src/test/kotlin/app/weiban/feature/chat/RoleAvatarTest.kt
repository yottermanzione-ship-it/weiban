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
import okhttp3.mockwebserver.*
import okio.Buffer
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Base64
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RoleAvatarTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private val requests = ConcurrentLinkedQueue<RecordedRequest>()
    private val privateId = "01920000-0000-7000-8000-000000000099"
    private val adminId = "01920000-0000-7000-8000-000000000088"
    private val auth =
        AuthResponse(
            AuthenticatedSession(
                "01920000-0000-7000-8000-000000000015",
                "picture-test-token-".repeat(4),
                "app",
                "2026-11-06T03:00:00.000Z",
            ),
            CurrentUser("01920000-0000-7000-8000-00000000001e", "native_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
    private val bytes =
        Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqoAAAAASUVORK5CYII=",
        )

    @Before fun setup() =
        runBlocking {
            server = MockWebServer()
            server.start()
            database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
            repository =
                SessionRepository(
                    ApiClient(server.url("/").toString()),
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
            repository.authenticate(auth)
        }

    @After fun close() {
        server.close()
        database.close()
    }

    private fun showPicture(delayMetadata: Boolean = false) {
        val media =
            MediaObject(
                privateId,
                "contact_avatar",
                "image/png",
                bytes.size.toLong(),
                1,
                1,
                server.url("/api/v1/media/$privateId/content?token=picture-grant").toString(),
                "2026-11-06T03:00:00.000Z",
                "2026-10-06T03:00:00.000Z",
            )
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests.add(request)
                    return if (request.requestUrl!!.encodedPath.endsWith("/content")) {
                        MockResponse().setBody(Buffer().write(bytes))
                    } else {
                        MockResponse().setBody(repository.api.json.encodeToString(MediaObject.serializer(), media)).apply {
                            if (delayMetadata) setBodyDelay(3, TimeUnit.SECONDS)
                        }
                    }
                }
            }
        val picture =
            CharacterAvatar(
                CharacterAvatarImage(adminId, server.url("/unused-admin-picture").toString()),
                CharacterDisplay(emptyList(), null, "star", null),
            )
        val role = RoleAvatarIdentity("01920000-0000-7000-8000-00000000001f", "王一博", picture, privateId)
        compose.setContent { WeibanTheme { RoleAvatar(repository, owner, role) } }
    }

    @Test fun privatePictureHasPriorityAndContentRequestDoesNotCarryBearer() {
        showPicture()
        compose.waitUntil(10_000) { requests.any { it.requestUrl!!.encodedPath.endsWith("/content") } }
        assertEquals(2, requests.size)
        assertEquals("/api/v1/media/$privateId", requests.first().requestUrl!!.encodedPath)
        assertFalse(requests.any { it.path!!.contains(adminId) })
        assertNull(requests.last().getHeader("Authorization"))
        compose.onNodeWithContentDescription("王一博头像").assertExists()
    }

    @Test fun accountReplacementMasksOldPictureAndCancelsItsPendingGrant() {
        showPicture(delayMetadata = true)
        compose.waitUntil(10_000) { requests.size == 1 }
        val other =
            auth.copy(
                user = auth.user.copy(userId = "01920000-0000-7000-8000-000000000024"),
                session = auth.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"),
            )
        runBlocking { repository.authenticate(other) }
        compose.onNodeWithContentDescription("角色头像").assertExists()
        compose.onNodeWithContentDescription("王一博头像").assertDoesNotExist()
        assertFalse(requests.any { it.requestUrl!!.encodedPath.endsWith("/content") })
        assertEquals(other, repository.auth.value)
    }
}
