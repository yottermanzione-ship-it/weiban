package app.weiban.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
class SessionRepositoryTest {
    private class MemoryVault : SessionVault {
        var value: AuthResponse? = null

        override fun load() = value

        override fun save(auth: AuthResponse) {
            value = auth
        }

        override fun clear() {
            value = null
        }
    }

    private lateinit var db: LocalDatabase
    private lateinit var server: MockWebServer
    private lateinit var api: ApiClient
    private lateinit var vault: MemoryVault
    private lateinit var repository: SessionRepository
    private val a =
        AuthResponse(
            AuthenticatedSession("01920000-0000-7000-8000-000000000015", "test-token-".repeat(4), "app", "2026-11-06T03:00:00.000Z"),
            CurrentUser("01920000-0000-7000-8000-000000000014", "test_user", "user", true, "2026-10-06T03:00:00.000Z"),
        )
    private val b =
        a.copy(
            session = a.session.copy(sessionId = "01920000-0000-7000-8000-000000000025"),
            user = a.user.copy(userId = "01920000-0000-7000-8000-000000000024", username = "other_user"),
        )

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), LocalDatabase::class.java).build()
        server = MockWebServer()
        server.start()
        api = ApiClient(server.url("/").toString())
        vault = MemoryVault()
        repository = SessionRepository(api, db, vault)
    }

    @After fun teardown() {
        server.close()
        db.close()
    }

    @Test fun realRoomCacheWorksOfflineAndCannotCrossAccount() =
        runBlocking {
            repository.authenticate(a)
            server.enqueue(MockResponse().setBody(api.json.encodeToString(CurrentUser.serializer(), a.user)))
            assertEquals(a.user, repository.call(Endpoints.identityEndpointsMe))
            assertNotNull(db.local().cache("IdentityEndpoints.me:{}:{}"))
            server.shutdown()
            assertEquals(a.user, repository.call(Endpoints.identityEndpointsMe))
            repository.authenticate(b)
            assertNull(db.local().cache("IdentityEndpoints.me:{}:{}"))
            assertTrue(runCatching { repository.call(Endpoints.identityEndpointsMe) }.isFailure)
            repository.forget()
            assertNull(vault.value)
            assertNull(db.local().owner())
            assertNull(db.local().sync())
        }

    @Test fun lateOldResponseCannotPopulateNewOwnersDatabase() =
        runBlocking {
            repository.authenticate(a)
            server.enqueue(
                MockResponse().setBody(api.json.encodeToString(CurrentUser.serializer(), a.user)).setBodyDelay(300, TimeUnit.MILLISECONDS),
            )
            val pending = async(Dispatchers.IO) { runCatching { repository.call(Endpoints.identityEndpointsMe) } }
            server.takeRequest(5, TimeUnit.SECONDS) ?: error("Request did not arrive")
            repository.authenticate(b)
            assertEquals("session_changed", (pending.await().exceptionOrNull() as ApiFailure).code)
            assertEquals(b.user.userId, db.local().owner()!!.userId)
            assertNull(db.local().cache("IdentityEndpoints.me:{}:{}"))
        }

    @Test fun vaultAndDatabaseOwnerMustMatchOnRestart() =
        runBlocking {
            repository.authenticate(a)
            db.local().cache(CacheRecord("private", "old account"))
            vault.value = b
            repository.restore()
            assertNull(repository.auth.value)
            assertNull(vault.value)
            assertNull(db.local().cache("private"))
            assertNull(db.local().owner())
        }

    @Test fun networkOnlySyncDoesNotUseOrOverwritePageCache() =
        runBlocking {
            repository.authenticate(a)
            server.enqueue(MockResponse().setBody(api.json.encodeToString(CurrentUser.serializer(), a.user)))
            repository.call(Endpoints.identityEndpointsMe)
            server.enqueue(MockResponse().setBody(api.json.encodeToString(CurrentUser.serializer(), a.user.copy(profileCompleted = false))))
            assertFalse(repository.call(Endpoints.identityEndpointsMe, options = SessionCallOptions(networkOnly = true)).profileCompleted)
            server.shutdown()
            assertTrue(repository.call(Endpoints.identityEndpointsMe).profileCompleted)
            assertTrue(
                runCatching { repository.call(Endpoints.identityEndpointsMe, options = SessionCallOptions(networkOnly = true)) }.isFailure,
            )
        }

    @Test fun runtimeOfflineQueueSurvivesRestartAndIsNotExposedToNextOwner() =
        runBlocking {
            repository.authenticate(a)
            server.shutdown()
            val owner = OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId)
            val other = OwnerRecord(userId = b.user.userId, sessionId = b.session.sessionId)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val first = ChatRuntime(repository, scope)
            val restarted = ChatRuntime(repository, scope)
            try {
                assertTrue(first.attach(owner))
                first.send(owner, "01920000-0000-7000-8000-000000000099", "断网持久消息")
                val persisted = repository.loadSync(owner)!!.outbox.single()
                assertEquals("断网持久消息", (persisted.body.content as UserSendableContentText).text)
                first.detach()
                assertTrue(restarted.attach(owner))
                assertEquals(
                    persisted.body.clientMsgId,
                    restarted.snapshot.value.state.outbox
                        .single()
                        .body.clientMsgId,
                )
                repository.authenticate(b)
                assertTrue(restarted.attach(other))
                assertEquals(other, restarted.snapshot.value.owner)
                assertTrue(
                    restarted.snapshot.value.state.outbox
                        .isEmpty(),
                )
                assertTrue(runCatching { restarted.send(owner, "01920000-0000-7000-8000-000000000099", "迟到旧会话") }.isFailure)
                assertTrue(repository.loadSync(other)?.outbox.isNullOrEmpty())
            } finally {
                first.detach()
                restarted.detach()
                scope.cancel()
            }
        }

    @Test fun atomicSyncOwnerRejectsLateWritesAndOldConnectionInvalidation() =
        runBlocking {
            repository.authenticate(a)
            val owner = OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId)
            assertTrue(repository.saveSync(owner, SyncEngine.freshState()))
            assertNotNull(repository.loadSync(owner))
            repository.authenticate(b)
            assertFalse(repository.saveSync(owner, SyncEngine.freshState()))
            assertNull(repository.loadSync(owner))
            repository.forgetIf(owner)
            assertEquals(
                b.user.userId,
                repository.auth.value!!
                    .user.userId,
            )
            repository.forget()
            assertFalse(repository.saveSync(owner, SyncEngine.freshState()))
            assertNull(db.local().sync())
        }
}
