package app.weiban.shell

import android.app.NotificationManager
import android.content.Context
import androidx.work.ListenableWorker.Result
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Instant
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class ShellNoticesTest {
    private val user = "019b0000-0000-7000-8000-000000000001"
    private val session = "019b0000-0000-7000-8000-000000000002"
    private val device = "019b0000-0000-7000-8000-000000000003"
    private val conversation = "019b0000-0000-7000-8000-000000000004"
    private val notice = "019b0000-0000-7000-8000-000000000005"
    private val token = "fixture-only-notification-session-token-00001"
    private lateinit var context: Context
    private lateinit var store: ShellNoticeStore
    private lateinit var server: MockWebServer
    private lateinit var state: ShellNoticeState

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        store = ShellNoticeStore(context) { SecretKeySpec(ByteArray(32) { 7 }, "AES") }
        server = MockWebServer().apply { start() }
        val raw =
            JSONObject()
                .put(
                    "session",
                    JSONObject()
                        .put("sessionId", session)
                        .put("token", token)
                        .put("kind", "app")
                        .put("expiresAt", "2099-01-01T00:00:00.000Z"),
                ).put(
                    "user",
                    JSONObject()
                        .put(
                            "userId",
                            user,
                        ).put(
                            "username",
                            "notice_test",
                        ).put("role", "user")
                        .put("profileCompleted", true)
                        .put("createdAt", "2026-01-01T00:00:00.000Z"),
                ).toString()
        state = ShellNoticeState(parseNoticeAuth(raw), raw, device, true)
        store.write(state)
    }

    @After fun close() {
        server.shutdown()
    }

    private fun payload(owner: String = user): JSONObject =
        JSONObject()
            .put(
                "v",
                1,
            ).put(
                "recipientUserId",
                owner,
            ).put(
                "recipientSessionId",
                session,
            ).put(
                "notificationId",
                notice,
            ).put(
                "kind",
                "message",
            ).put(
                "collapseKey",
                conversation,
            ).put(
                "title",
                "测试角色",
            ).put(
                "body",
                "通知测试正文",
            ).put(
                "count",
                1,
            ).put(
                "deepLink",
                "/chat/$conversation",
            ).put("conversationId", conversation)
            .put("sound", true)
            .put("sentAt", Instant.now().toString())

    private fun reply(payload: JSONObject): MockResponse =
        MockResponse().setBody(JSONObject().put("items", JSONArray().put(payload)).toString())

    private fun runDelivery(): Result =
        ShellNoticeDelivery(context, store, ShellNoticeHttp(server.url("/").toString().removeSuffix("/"))).run()

    @Test fun encryptsCredentialsAndPreservesInstallationWhenLoggingOut() {
        assertEquals(
            token,
            store
                .read()!!
                .auth.session.token,
        )
        val stored = context.getSharedPreferences("weiban_native_notices", Context.MODE_PRIVATE).all.toString()
        assertFalse(stored.contains(token))
        val installation = store.installation()
        store.clear()
        assertNull(store.read())
        assertEquals(installation, store.installation())
    }

    @Test fun displaysNativeNotificationAcknowledgesAndDoesNotRepeatAfterNetworkRetry() {
        repeat(2) {
            server.enqueue(reply(payload()))
            server.enqueue(MockResponse().setResponseCode(204))
        }
        assertEquals(Result.success(), runDelivery())
        val manager = context.getSystemService(NotificationManager::class.java)
        val rendered = manager.activeNotifications.single().notification
        assertEquals("通知测试正文", rendered.extras.getString("android.text"))
        val click = shadowOf(rendered.contentIntent).savedIntent
        assertEquals("$user:$session", click.getStringExtra("noticeOwner"))
        assertEquals("/chat/$conversation", click.getStringExtra("noticeRoute"))
        assertFalse(click.extras.toString().contains(token))
        assertFalse(click.extras.toString().contains("通知测试正文"))
        assertEquals("GET", server.takeRequest().method)
        assertTrue(
            server
                .takeRequest()
                .body
                .readUtf8()
                .contains(notice),
        )
        assertEquals(Result.success(), runDelivery())
        assertEquals(1, manager.activeNotifications.size)
        assertEquals(listOf(notice), store.read()!!.seen)
    }

    @Test fun changedOwnerAndForeignPayloadCannotDisplay() {
        server.enqueue(reply(payload("019b0000-0000-7000-8000-000000000009")))
        runDelivery()
        assertEquals(0, context.getSystemService(NotificationManager::class.java).activeNotifications.size)
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    store.clear()
                    return reply(payload())
                }
            }
        runDelivery()
        assertEquals(0, context.getSystemService(NotificationManager::class.java).activeNotifications.size)
        assertNull(store.read())
    }

    @Test fun routeAndPermissionChecksRejectUnsafeTargetsAndDisabledNotifications() {
        assertNull(ShellNotices.route("https://example.com/"))
        assertNull(ShellNotices.route("//example.com"))
        assertNull(ShellNotices.route("/chat/$conversation", device))
        shadowOf(context.getSystemService(NotificationManager::class.java)).setNotificationsEnabled(false)
        assertFalse(ShellNotices.permitted(context))
        assertEquals(Result.success(), runDelivery())
        assertEquals(0, server.requestCount)
    }
}
