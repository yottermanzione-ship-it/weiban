package app.weiban.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.filterNotNull
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

    @Test fun observersSeeAuthenticatedSessionsOnlyAfterTheHttpBindingIsReady() =
        runBlocking {
            val ready = mutableListOf<Boolean>()
            val observer =
                launch(Dispatchers.Unconfined) {
                    repository.auth.filterNotNull().collect { ready.add(api.current() === it) }
                }
            try {
                repository.authenticate(a)
                repository.updateUser(
                    a.user.copy(profileCompleted = false),
                    OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId),
                )
                val unchanged =
                    repository.auth.value!!
                        .user
                        .copy()
                repository.updateUser(unchanged, OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId))
                assertSame(repository.auth.value, api.current())
                server.enqueue(MockResponse().setBody(api.json.encodeToString(CurrentUser.serializer(), unchanged)))
                assertEquals(unchanged, repository.call(Endpoints.identityEndpointsMe))
                repository.forget()
                db.local().owner(OwnerRecord(userId = b.user.userId, sessionId = b.session.sessionId))
                vault.value = b
                repository.restore()
                vault.value = b.copy()
                repository.restore()
                assertSame(repository.auth.value, api.current())
                server.enqueue(MockResponse().setBody(api.json.encodeToString(CurrentUser.serializer(), b.user)))
                assertEquals(b.user, repository.call(Endpoints.identityEndpointsMe))
                assertEquals(listOf(true, true, true), ready)
            } finally {
                observer.cancelAndJoin()
            }
        }

    @Test fun oldProfileRefreshCannotUpdateTheSameUsersReplacementSession() =
        runBlocking {
            repository.authenticate(a)
            val owner = OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId)
            val replacement = a.copy(session = b.session, user = a.user.copy(profileCompleted = false))
            repository.authenticate(replacement)
            val error = runCatching { repository.updateUser(a.user, owner) }.exceptionOrNull()
            assertTrue(error is ApiFailure)
            assertEquals("session_changed", (error as ApiFailure).code)
            assertEquals(replacement, repository.auth.value)
            assertEquals(replacement, vault.value)
        }

    @Test fun unfinishedOnboardingSurvivesProfileSaveAndRepositoryRestart() =
        runBlocking {
            repository.authenticate(a.copy(user = a.user.copy(profileCompleted = false)))
            assertTrue(repository.onboardingPending.value)
            repository.updateUser(a.user)
            val restarted = SessionRepository(api, db, vault)
            restarted.restore()
            assertTrue(
                restarted.auth.value!!
                    .user.profileCompleted,
            )
            assertTrue(restarted.onboardingPending.value)
            assertTrue(restarted.finishOnboarding(OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId)))
            val completed = SessionRepository(api, db, vault)
            completed.restore()
            assertFalse(completed.onboardingPending.value)
        }

    @Test fun oldOwnerCannotFinishNewAccountsOnboarding() =
        runBlocking {
            repository.authenticate(a.copy(user = a.user.copy(profileCompleted = false)))
            val oldOwner = OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId)
            repository.authenticate(b.copy(user = b.user.copy(profileCompleted = false)))
            assertFalse(repository.finishOnboarding(oldOwner))
            assertTrue(repository.onboardingPending.value)
            assertEquals("true", db.local().cache("ui:onboarding"))
            repository.forget()
            assertFalse(repository.onboardingPending.value)
            assertNull(db.local().cache("ui:onboarding"))
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

    @Test fun oldImageGrantCannotBeDownloadedUsingTheNewAccount() =
        runBlocking {
            repository.authenticate(a)
            val owner = OwnerRecord(userId = a.user.userId, sessionId = a.session.sessionId)
            val id = "01920000-0000-7000-8000-000000000099"
            val media =
                MediaObject(
                    id,
                    "contact_avatar",
                    "image/png",
                    3,
                    1,
                    1,
                    server.url("/api/v1/media/$id/content?token=old-grant").toString(),
                    "2026-11-06T03:00:00.000Z",
                    "2026-10-06T03:00:00.000Z",
                )
            repository.authenticate(b)
            val rejected = runCatching { repository.download(media, owner) }
            assertEquals("session_changed", (rejected.exceptionOrNull() as ApiFailure).code)
            assertEquals(0, server.requestCount)
            assertEquals(b, repository.auth.value)
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
