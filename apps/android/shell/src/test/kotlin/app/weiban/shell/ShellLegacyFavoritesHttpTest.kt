package app.weiban.shell

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class ShellLegacyFavoritesHttpTest {
    private val user = "019b0000-0000-7000-8000-000000000001"
    private lateinit var server: MockWebServer

    @Before
    fun setup() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun close() {
        server.shutdown()
    }

    private fun auth() =
        parseNoticeAuth(
            JSONObject()
                .put(
                    "session",
                    JSONObject()
                        .put("sessionId", "019b0000-0000-7000-8000-000000000002")
                        .put("token", "synthetic-current-session-token-long-enough")
                        .put("kind", "app")
                        .put("expiresAt", "2099-01-01T00:00:00.000Z"),
                ).put(
                    "user",
                    JSONObject()
                        .put("userId", user)
                        .put("username", "unused9")
                        .put("role", "user")
                        .put("profileCompleted", true)
                        .put("createdAt", "2026-01-01T00:00:00.000Z"),
                ).toString(),
        )

    private fun body(
        keys: JSONArray = JSONArray().put("fixture1"),
        owner: String = user,
    ): String =
        JSONObject()
            .put("userId", owner)
            .put("legacyAccountKeys", keys)
            .put("available", keys.length() > 0)
            .toString()

    private fun http() = ShellLegacyFavoritesHttp(server.url("/").toString().removeSuffix("/"))

    @Test
    fun sourceUsesOnlyTheFixedAuthenticatedRouteAndChecksTheReturnedUser() {
        server.enqueue(MockResponse().setBody(body()))
        assertEquals(listOf("fixture1"), http().source(auth()).accountKeys)
        val request = server.takeRequest()
        assertEquals("/api/v1/library/legacy-favorites/source", request.path)
        assertEquals("Bearer synthetic-current-session-token-long-enough", request.getHeader("Authorization"))
        assertEquals("GET", request.method)
        server.enqueue(MockResponse().setBody(body(owner = "019b0000-0000-7000-8000-000000000009")))
        assertEquals("owner_mismatch", assertThrows(LegacyFavoritesFailure::class.java) { http().source(auth()) }.reason)
    }

    @Test
    fun redirectsDoNotForwardTheTokenAndInvalidAccountKeysAreRejected() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", server.url("/other")))
        assertEquals("source_unavailable", assertThrows(LegacyFavoritesFailure::class.java) { http().source(auth()) }.reason)
        assertEquals(1, server.requestCount)
        for (keys in listOf(JSONArray().put("../other"), JSONArray().put("fixture1").put("fixture1"))) {
            server.enqueue(MockResponse().setBody(body(keys)))
            assertEquals("source_invalid", assertThrows(LegacyFavoritesFailure::class.java) { http().source(auth()) }.reason)
        }
    }

    @Test
    fun revokedSessionsAndOversizedMappingResponsesAreExplicitFailures() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("private-provider-canary"))
        val revoked = assertThrows(LegacyFavoritesFailure::class.java) { http().source(auth()) }
        assertEquals("authentication_failed", revoked.reason)
        assertFalse(revoked.toString().contains("private-provider-canary"))
        server.enqueue(MockResponse().setBody("x".repeat(16385)))
        assertEquals("source_invalid", assertThrows(LegacyFavoritesFailure::class.java) { http().source(auth()) }.reason)
    }
}
