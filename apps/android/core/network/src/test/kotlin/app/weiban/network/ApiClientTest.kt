package app.weiban.network

import app.weiban.contracts.*
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class ApiClientTest {
    private val user = CurrentUser("01920000-0000-7000-8000-000000000014", "test_user", "user", true, "2026-10-06T03:00:00.000Z")

    private fun auth(token: String) =
        AuthResponse(AuthenticatedSession("01920000-0000-7000-8000-000000000015", token, "app", "2026-11-06T03:00:00.000Z"), user)

    @Test fun staleCapturedSessionCannotStartPostOrMediaRequestWithNewToken() =
        runBlocking {
            MockWebServer().use { server ->
                val api = ApiClient(server.url("/").toString())
                val previous = auth("old-token-".repeat(4))
                val current = auth("new-token-".repeat(4))
                api.authenticate(previous)
                api.authenticate(current)
                val post = runCatching { api.call(Endpoints.identityEndpointsLogout, expectedSession = previous) }
                assertEquals("session_changed", (post.exceptionOrNull() as ApiFailure).code)
                val grant = media(server.url("/api/v1/media/01920000-0000-7000-8000-000000000099/content?token=grant").toString())
                val download = runCatching { api.download(grant, expectedSession = previous) }
                assertEquals("session_changed", (download.exceptionOrNull() as ApiFailure).code)
                assertEquals(0, server.requestCount)
                assertSame(current, api.current())
            }
        }

    @Test fun changedAccountRejectsLateBody() =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(
                    MockResponse()
                        .setBody(
                            """
{
    "userId": "${user.userId}",
    "username": "test_user",
    "role": "user",
    "profileCompleted": true,
    "createdAt": "${user.createdAt}"
}
                            """.trimIndent(),
                        ).setBodyDelay(300, TimeUnit.MILLISECONDS),
                )
                val api = ApiClient(server.url("/").toString())
                api.authenticate(auth("old-token-".repeat(4)))
                val result = async(kotlinx.coroutines.Dispatchers.IO) { runCatching { api.call(Endpoints.identityEndpointsMe) } }
                val request = server.takeRequest(5, TimeUnit.SECONDS)!!
                assertTrue(request.getHeader("Authorization")!!.contains("old-token"))
                api.authenticate(auth("new-token-".repeat(4)))
                assertEquals("session_changed", (result.await().exceptionOrNull() as ApiFailure).code)
                assertTrue(
                    api
                        .current()!!
                        .session.token
                        .startsWith("new-token"),
                )
            }
        }

    @Test fun redirectDoesNotForwardCredential() =
        runBlocking {
            MockWebServer().use { target ->
                MockWebServer().use { server ->
                    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target.url("/leak")))
                    val api = ApiClient(server.url("/").toString())
                    api.authenticate(auth("secret-token".repeat(4)))
                    assertEquals(302, (runCatching { api.call(Endpoints.identityEndpointsMe) }.exceptionOrNull() as ApiFailure).status)
                    assertNull(target.takeRequest(100, TimeUnit.MILLISECONDS))
                }
            }
        }

    @Test fun actualUnauthorizedResponseDropsSession() =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(
                    MockResponse()
                        .setResponseCode(
                            401,
                        ).setBody("""{"error":{"code":"unauthenticated","message":"expired","requestId":"native-test"}}"""),
                )
                val api = ApiClient(server.url("/").toString())
                api.authenticate(auth("token-".repeat(8)))
                assertEquals(401, (runCatching { api.call(Endpoints.identityEndpointsMe) }.exceptionOrNull() as ApiFailure).status)
                assertNull(api.current())
            }
        }

    private fun media(url: String) =
        MediaObject(
            "01920000-0000-7000-8000-000000000099",
            "user_avatar",
            "image/webp",
            3,
            1,
            1,
            url,
            "2026-10-06T03:05:00.000Z",
            "2026-10-06T03:00:00.000Z",
        )

    @Test fun mediaGrantDownloadsWithoutBearer() =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setHeader("Content-Type", "image/webp").setBody("pic"))
                val api = ApiClient(server.url("/").toString())
                api.authenticate(auth("private-bearer-".repeat(3)))
                val path = "/api/v1/media/01920000-0000-7000-8000-000000000099/content?token=grant"
                val grant = media(server.url(path).toString())
                assertArrayEquals("pic".toByteArray(), api.download(grant))
                assertNull(server.takeRequest().getHeader("Authorization"))
            }
        }

    @Test fun mediaGrantCannotTargetAnotherOriginOrPath() =
        runBlocking {
            MockWebServer().use { server ->
                MockWebServer().use { other ->
                    val api = ApiClient(server.url("/").toString())
                    api.authenticate(auth("private-bearer-".repeat(3)))
                    val path = "/api/v1/media/01920000-0000-7000-8000-000000000099/content?token=grant"
                    assertTrue(
                        runCatching { api.download(media(other.url(path).toString())) }.exceptionOrNull() is IllegalArgumentException,
                    )
                    assertTrue(
                        runCatching {
                            api.download(
                                media(server.url("/leak?token=grant").toString()),
                            )
                        }.exceptionOrNull() is IllegalArgumentException,
                    )
                    assertNull(server.takeRequest(100, TimeUnit.MILLISECONDS))
                    assertNull(other.takeRequest(100, TimeUnit.MILLISECONDS))
                }
            }
        }

    @Test fun invalidCredentialsAndUnknownErrorsDoNotDropExistingSession() =
        runBlocking {
            MockWebServer().use { server ->
                val api = ApiClient(server.url("/").toString())
                val existing = auth("private-bearer-".repeat(3))
                api.authenticate(existing)
                for (code in listOf("invalid_credentials", "future_error")) {
                    val body = "{\"error\":{\"code\":\"$code\",\"message\":\"request failed\",\"requestId\":\"native-test\"}}"
                    server.enqueue(MockResponse().setResponseCode(401).setBody(body))
                    val expected = if (code == "future_error") "unsupported" else code
                    assertEquals(expected, (runCatching { api.call(Endpoints.identityEndpointsMe) }.exceptionOrNull() as ApiFailure).code)
                    assertSame(existing, api.current())
                }
            }
        }

    @Test fun cancellationClosesSlowBodyWithoutWaitingForNetworkTimeout() =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setBody("{}").setBodyDelay(2, TimeUnit.SECONDS))
                val api = ApiClient(server.url("/").toString())
                api.authenticate(auth("cancel-private-token".repeat(3)))
                val request = async { api.call(Endpoints.identityEndpointsMe) }
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    server.takeRequest(5, TimeUnit.SECONDS) ?: error("request missing")
                }
                kotlinx.coroutines.withTimeout(1000) {
                    request.cancel()
                    request.join()
                }
                assertTrue(request.isCancelled)
            }
        }
}
