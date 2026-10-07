package app.weiban.feature.chat

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ContactAvatarEditorTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var server: MockWebServer
    private lateinit var database: LocalDatabase
    private lateinit var repository: SessionRepository
    private lateinit var runtime: ChatRuntime
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val requests = ConcurrentLinkedQueue<RecordedRequest>()
    private val sequence = AtomicInteger(0)
    private val roleId = "01920000-0000-7000-8000-00000000001f"
    private val mediaId = "01920000-0000-7000-8000-000000000099"
    private val time = "2026-10-07T03:00:00.000Z"
    private val auth =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "crop-token-".repeat(8), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-00000000001e", "native_user", "user", true, time),
        )
    private val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)

    @Volatile private var contact = Contact(roleId, "active", "原备注", null, "原称呼", "2026-10-07", null, time)

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
                        var saved: AuthResponse? = null

                        override fun load() = saved

                        override fun save(auth: AuthResponse) {
                            saved = auth
                        }

                        override fun clear() {
                            saved = null
                        }
                    },
                )
            repository.authenticate(auth)
            repository.saveSync(owner, SyncEngine.freshState().copy(initialized = true, contacts = listOf(contact)))
            runtime = ChatRuntime(repository, scope)
            runtime.attach(owner)
            server.dispatcher = responses()
            compose.setContent {
                WeibanTheme {
                    val current =
                        runtime.snapshot
                            .collectAsState()
                            .value.state.contacts
                            .singleOrNull() ?: contact
                    ContactAvatarEditor(repository, runtime, owner, current)
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
                requests.add(request)
                val path = request.requestUrl!!.encodedPath
                return when {
                    request.method == "POST" && path.endsWith("/media") -> mediaResponse()
                    request.method == "PATCH" -> {
                        val input =
                            repository.api.json
                                .parseToJsonElement(request.body.clone().readUtf8())
                                .jsonObject
                        assertEquals(setOf("customAvatarMediaId"), input.keys)
                        contact = contact.copy(customAvatarMediaId = input.getValue("customAvatarMediaId").jsonPrimitive.contentOrNull)
                        sequence.incrementAndGet()
                        MockResponse().setBody(repository.api.json.encodeToString(Contact.serializer(), contact))
                    }
                    path.endsWith("/sync/state") -> MockResponse().setBody("{\"latestUpdateSeq\":${sequence.get()}}")
                    path.endsWith("/sync/updates") -> {
                        val after = request.requestUrl!!.queryParameter("since")?.toLong() ?: 0
                        val latest = sequence.get().toLong()
                        val updates =
                            if (latest >
                                after
                            ) {
                                listOf(UserUpdateContactUpserted(latest, time, data = UserUpdateContactUpsertedData(contact)))
                            } else {
                                emptyList()
                            }
                        MockResponse().setBody(
                            repository.api.json.encodeToString(
                                SyncEndpointsGetUpdatesResponse.serializer(),
                                SyncEndpointsGetUpdatesResponse(updates, latest, false),
                            ),
                        )
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }

    private fun mediaResponse(): MockResponse {
        val media =
            MediaObject(
                mediaId,
                "contact_avatar",
                "image/png",
                1024,
                512,
                512,
                server.url("/api/v1/media/$mediaId/content?token=fixture").toString(),
                "2026-11-06T03:00:00.000Z",
                time,
            )
        return MockResponse().setBody(repository.api.json.encodeToString(MediaObject.serializer(), media))
    }

    private fun selectPicture() {
        compose.onNodeWithText("设置头像").performClick()
        compose.onNodeWithText("选择并裁剪头像").performClick()
        val image = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888)
        image.eraseColor(Color.RED)
        val file = File(compose.activity.cacheDir, "contact-avatar-test.png")
        file.outputStream().use { assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        image.recycle()
        compose.runOnIdle {
            val activity = shadowOf(compose.activity)
            val launched = activity.nextStartedActivityForResult
            assertEquals(Intent.ACTION_GET_CONTENT, launched.intent.action)
            activity.receiveResult(launched.intent, Activity.RESULT_OK, Intent().setData(Uri.fromFile(file)))
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("调整头像").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun cropUploadAndRestoreSaveOnlyAvatarAndWaitForDurableContact() {
        selectPicture()
        compose.onNodeWithText("使用头像").performClick()
        compose.waitUntil(10_000) {
            runBlocking {
                repository
                    .loadSync(owner)
                    ?.contacts
                    ?.single()
                    ?.customAvatarMediaId == mediaId
            }
        }
        compose.onNodeWithText("已设置，只有你能看到").assertExists()
        val upload = requests.single { it.method == "POST" }
        assertEquals("contact_avatar", upload.requestUrl!!.queryParameter("purpose"))
        assertTrue(upload.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        val body = upload.body.clone().readByteArray()
        val marker = "\r\n\r\n".toByteArray()
        val start =
            body.indices.first { i -> i + marker.size <= body.size && marker.indices.all { body[i + it] == marker[it] } } + marker.size
        val image = app.weiban.designsystem.decodeAvatar(body.copyOfRange(start, body.size))
        assertEquals(512, image.width)
        assertEquals(512, image.height)
        image.recycle()
        compose.onNodeWithText("恢复默认头像").performClick()
        compose.waitUntil(10_000) { runBlocking { repository.loadSync(owner)?.lastUpdateSeq == 2L } }
        compose.onNodeWithText("已恢复默认头像").assertExists()
        compose.onNodeWithText("恢复默认头像").assertDoesNotExist()
        val durable = runBlocking { repository.loadSync(owner)!!.contacts.single() }
        assertNull(durable.customAvatarMediaId)
        assertEquals("原备注", durable.remark)
        assertEquals("原称呼", durable.addressAs)
        assertEquals(2, requests.count { it.method == "PATCH" })
    }

    @Test fun replacingAccountDiscardsOpenCropWithoutUploadingIntoNewSession() {
        selectPicture()
        val other =
            auth.copy(
                user = auth.user.copy(userId = "01920000-0000-7000-8000-000000000024"),
                session = auth.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"),
            )
        runBlocking { repository.authenticate(other) }
        compose.onNodeWithText("调整头像").assertDoesNotExist()
        compose.onNodeWithText("设置头像").assertDoesNotExist()
        assertFalse(requests.any { it.method == "POST" || it.method == "PATCH" })
        assertEquals(other, repository.auth.value)
    }
}
