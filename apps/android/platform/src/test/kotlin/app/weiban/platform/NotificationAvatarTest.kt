package app.weiban.platform

import android.app.Notification
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import app.weiban.contracts.*
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import okio.Buffer
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26], application = PushTestApplication::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotificationAvatarTest {
    private lateinit var fixture: PushFixture
    private val characterId = "01920000-0000-7000-8000-000000000050"
    private val privateId = "01920000-0000-7000-8000-000000000051"
    private val adminId = "01920000-0000-7000-8000-000000000052"
    private val reached = CompletableDeferred<Unit>()
    private var delayed = false
    private var missing = false

    @Before fun setup() {
        fixture = PushFixture()
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            org.robolectric.Shadows
                .shadowOf(fixture.context)
                .grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        assertTrue(fixture.runtime.permitted())
    }

    @After fun close() {
        fixture.close()
    }

    private fun responses(): Dispatcher =
        object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                fixture.requests.add(request)
                val json = fixture.repository.api.json
                val path = request.requestUrl!!.encodedPath
                return when (path) {
                    "/api/v1/me/notification-settings" ->
                        MockResponse().setBody(
                            json.encodeToString(NotificationSettings.serializer(), fixture.settings),
                        )
                    "/api/v1/conversations/${fixture.conversationId}" ->
                        MockResponse().setBody(
                            json.encodeToString(Conversation.serializer(), conversation()),
                        )
                    "/api/v1/characters/$characterId" ->
                        MockResponse().setBody(
                            json.encodeToString(CharacterProfile.serializer(), profile()),
                        )
                    "/api/v1/contacts" ->
                        MockResponse().setBody(
                            json.encodeToString(
                                ContactsEndpointsListResponse.serializer(),
                                ContactsEndpointsListResponse(listOf(contact())),
                            ),
                        )
                    "/api/v1/media/$privateId" -> {
                        reached.complete(Unit)
                        MockResponse()
                            .setBody(
                                json.encodeToString(MediaObject.serializer(), media()),
                            ).apply { if (delayed) setBodyDelay(1, TimeUnit.SECONDS) }
                    }
                    "/api/v1/media/$privateId/content" ->
                        if (missing) {
                            MockResponse().setResponseCode(
                                404,
                            )
                        } else {
                            MockResponse().setHeader("Content-Type", "image/webp").setBody(Buffer().write(picture()))
                        }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }

    private fun profile() =
        CharacterProfile(
            characterId,
            "preset",
            "纸飞机",
            CharacterAvatar(
                CharacterAvatarImage(adminId, "https://unused.example/image"),
                CharacterDisplay(listOf("#E8608C"), "A", "star", null),
            ),
            "陪你聊聊",
            emptyList(),
            null,
            "original",
            true,
            emptyList(),
            emptyList(),
            "你好",
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

    private fun conversation() =
        Conversation(
            fixture.conversationId,
            "direct",
            null,
            listOf(Participant("01920000-0000-7000-8000-000000000053", "character", characterId, fixture.time)),
            "normal",
            1,
            null,
            UserConversationState(false, false, false, 0, 0, false),
            1,
            null,
            fixture.time,
            fixture.time,
        )

    private fun contact() = Contact(characterId, "active", null, privateId, null, "2026-10-07", fixture.conversationId, fixture.time)

    private fun media() =
        MediaObject(
            privateId,
            "contact_avatar",
            "image/webp",
            picture().size.toLong(),
            192,
            96,
            fixture.server
                .url("/api/v1/media/$privateId/content?token=fixture-media-grant")
                .newBuilder()
                .host("127.0.0.1")
                .build()
                .toString(),
            "2026-11-06T03:00:00.000Z",
            fixture.time,
        )

    // Lossless WebP produced by the same sharp encoder used by the server: red sides, blue centre.
    private fun picture(): ByteArray = requireNotNull(javaClass.getResourceAsStream("/avatar-center.webp")).use { it.readBytes() }

    @Test
    @Config(sdk = [35], application = PushTestApplication::class)
    fun modernSystemCanResizeThe96PixelExportWithoutLosingItsOwnedPixels() =
        runBlocking {
            with(fixture) {
                repository.notifications.setEnabled(owner, true)
                server.dispatcher = responses()
                val exported = NotificationAvatar(context, repository).load(owner, envelope())
                try {
                    assertEquals(96, exported.width)
                    assertEquals(96, exported.height)
                    assertEquals(Color.BLUE, exported.getPixel(48, 48))
                } finally {
                    exported.recycle()
                }
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                val icon =
                    manager.activeNotifications
                        .single()
                        .notification
                        .getLargeIcon()!!
                        .loadDrawable(context) as BitmapDrawable
                assertEquals(48, icon.bitmap.width)
                assertEquals(48, icon.bitmap.height)
                assertEquals(Color.BLUE, icon.bitmap.getPixel(24, 24))
                assertEquals(0, Color.alpha(icon.bitmap.getPixel(0, 0)))
            }
        }

    @Test fun actualLargeIconDownloadsPrivateAvatarBeforeAdminAndExportsRounded96Pixels() =
        runBlocking {
            with(fixture) {
                repository.notifications.setEnabled(owner, true)
                server.dispatcher = responses()
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                val posted = manager.activeNotifications.single().notification
                val icon = posted.getLargeIcon()!!.loadDrawable(context) as BitmapDrawable
                assertEquals(96, icon.bitmap.width)
                assertEquals(96, icon.bitmap.height)
                assertEquals(Color.BLUE, icon.bitmap.getPixel(48, 48))
                assertEquals(0, Color.alpha(icon.bitmap.getPixel(0, 0)))
                assertTrue(requests.any { it.requestUrl!!.encodedPath == "/api/v1/media/$privateId" })
                assertFalse(requests.any { it.path!!.contains(adminId) })
                assertNull(requests.last().getHeader("Authorization"))
                assertEquals("私密内容", posted.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
            }
        }

    @Test fun replacingAccountWhilePrivateAvatarGrantIsPendingPreventsDownloadAndDisplay() =
        runBlocking {
            with(fixture) {
                repository.notifications.setEnabled(owner, true)
                delayed = true
                server.dispatcher = responses()
                assertTrue(runtime.receive(raw(envelope())))
                val delivery = async(Dispatchers.IO) { runtime.deliver(owner, envelope().notificationId) }
                withTimeout(5000) { reached.await() }
                repository.authenticate(replacement())
                runtime.detach(owner)
                delivery.await()
                assertFalse(requests.any { it.requestUrl!!.encodedPath.endsWith("/content") })
                assertEquals(0, manager.activeNotifications.size)
                assertEquals(replacement(), repository.auth.value)
            }
        }

    @Test fun expiredPrivateImageUsesTheSameCanonicalRoleDefaultWithoutBorrowingAdminImage() =
        runBlocking {
            with(fixture) {
                repository.notifications.setEnabled(owner, true)
                missing = true
                server.dispatcher = responses()
                assertTrue(runtime.receive(raw(envelope())))
                runtime.deliver(owner, envelope().notificationId)
                val icon =
                    manager.activeNotifications
                        .single()
                        .notification
                        .getLargeIcon()!!
                        .loadDrawable(context) as BitmapDrawable
                assertEquals(Color.rgb(232, 96, 140), icon.bitmap.getPixel(48, 5))
                assertFalse(requests.any { it.path!!.contains(adminId) })
            }
        }
}
