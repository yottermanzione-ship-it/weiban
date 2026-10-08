package app.weiban.data

import androidx.room.withTransaction
import app.weiban.contracts.*
import app.weiban.network.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.io.IOException

data class SessionCallOptions(
    val networkOnly: Boolean = false,
    val owner: OwnerRecord? = null,
)

/** Session changes and all cache writes share one lock; responses never cross an account epoch. */
class SessionRepository(
    val api: ApiClient,
    private val database: LocalDatabase,
    private val vault: SessionVault,
) {
    private val lock = Mutex()
    private val current = MutableStateFlow<AuthResponse?>(null)
    val auth: StateFlow<AuthResponse?> = current
    private val onboarding = MutableStateFlow(false)
    val onboardingPending: StateFlow<Boolean> = onboarding
    val notifications = NotificationStateStore(database, api.json, lock, ::owns)
    val onboardingDraft =
        OnboardingDraftStore(database, api.json, lock) {
            owns(it) && onboarding.value && database.local().cache("ui:onboarding") == "true"
        }

    suspend fun restore() =
        lock.withLock {
            val saved = withContext(Dispatchers.IO) { vault.load() }
            val owner = database.local().owner()
            if (saved == null || owner?.sessionId != saved.session.sessionId || owner?.userId != saved.user.userId) {
                database.withTransaction { database.local().replaceOwner(null) }
                withContext(Dispatchers.IO) { vault.clear() }
                current.value = null
                onboarding.value = false
                api.authenticate(null)
            } else {
                onboarding.value = !saved.user.profileCompleted || database.local().cache("ui:onboarding") == "true"
                val published = current.value?.takeIf { it == saved } ?: saved
                api.authenticate(published)
                current.value = published
            }
        }

    suspend fun authenticate(auth: AuthResponse) =
        lock.withLock {
            current.value = null
            onboarding.value = false
            api.authenticate(null)
            database.withTransaction {
                database.local().replaceOwner(
                    OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId),
                )
            }
            onboarding.value = !auth.user.profileCompleted
            database.local().cache(CacheRecord("ui:onboarding", onboarding.value.toString()))
            withContext(Dispatchers.IO) { vault.save(auth) }
            api.authenticate(auth)
            current.value = auth
        }

    suspend fun forget() =
        lock.withLock {
            current.value = null
            onboarding.value = false
            api.authenticate(null)
            database.withTransaction { database.local().replaceOwner(null) }
            withContext(Dispatchers.IO) { vault.clear() }
        }

    private suspend fun invalidate(expected: AuthResponse) =
        lock.withLock {
            if (current.value !== expected)return@withLock
            current.value = null
            onboarding.value = false
            api.authenticate(null)
            database.withTransaction { database.local().replaceOwner(null) }
            withContext(Dispatchers.IO) { vault.clear() }
        }

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        body: JsonElement? = null,
        params: Map<String, String> = emptyMap(),
        query: Map<String, String> = emptyMap(),
        idempotencyKey: String? = null,
        multipart: okhttp3.MultipartBody? = null,
        options: SessionCallOptions = SessionCallOptions(),
    ): T {
        val captured = capture(options.owner)
        val key = endpoint.id + ":" + params.toSortedMap() + ":" + query.toSortedMap()
        val value =
            try {
                api.call(endpoint, body, params, query, idempotencyKey, multipart, expectedSession = captured)
            } catch (error: ApiFailure) {
                if (error.code == "unauthenticated" && captured != null) invalidate(captured)
                throw error
            } catch (error: IOException) {
                if (options.networkOnly) throw error
                return cached(endpoint, captured, key, error)
            }
        return if (endpoint.auth == "none") value else commit(endpoint, captured, key, value, options.networkOnly)
    }

    private fun capture(expected: OwnerRecord?): AuthResponse? {
        val auth = current.value
        if (expected != null && (auth?.user?.userId != expected.userId || auth.session.sessionId != expected.sessionId)) {
            throw ApiFailure("session_changed", 0)
        }
        return auth
    }

    // Distinct transport, account-epoch and cache-miss reject gates intentionally preserve the original failure.
    @Suppress("ThrowsCount")
    private suspend fun <T> cached(
        endpoint: ContractEndpoint<T>,
        captured: AuthResponse?,
        key: String,
        error: IOException,
    ): T {
        // Only transport failure reads a validated local GET; HTTP errors never resurrect stale state.
        if (endpoint.method != "GET" || captured == null) throw error
        return lock.withLock {
            if (current.value !== captured) throw ApiFailure("session_changed", 0)
            val value = database.local().cache(key) ?: throw error
            api.json.decodeFromString(endpoint.response, value)
        }
    }

    private suspend fun <T> commit(
        endpoint: ContractEndpoint<T>,
        captured: AuthResponse?,
        key: String,
        value: T,
        networkOnly: Boolean,
    ): T =
        lock.withLock {
            if (current.value !== captured || captured == null) throw ApiFailure("session_changed", 0)
            if (endpoint.method == "GET" && !networkOnly) {
                database.withTransaction { database.local().cache(CacheRecord(key, api.json.encodeToString(endpoint.response, value))) }
                // First display also reads the committed representation.
                api.json.decodeFromString(endpoint.response, database.local().cache(key)!!)
            } else {
                value
            }
        }

    /** Finish only after a real conversation is available; preserve this marker across process restarts. */
    suspend fun finishOnboarding(owner: OwnerRecord): Boolean =
        lock.withLock {
            if (!owns(owner)) return@withLock false
            database.withTransaction {
                database.local().cache(CacheRecord("ui:onboarding", "false"))
                database.local().cache(CacheRecord(ONBOARDING_DRAFT_KEY, "null"))
            }
            onboarding.value = false
            true
        }

    suspend fun loadSync(owner: OwnerRecord): ClientSyncState? =
        lock.withLock {
            database.withTransaction {
                if (!owns(owner)) return@withTransaction null
                val stored = database.local().sync() ?: return@withTransaction null
                api.json.decodeFromJsonElement(
                    ClientSyncState.serializer(),
                    ContractJson.normalize("ClientSyncState", api.json.parseToJsonElement(stored.value)),
                )
            }
        }

    suspend fun saveSync(
        owner: OwnerRecord,
        state: ClientSyncState,
    ): Boolean =
        lock.withLock {
            database.withTransaction {
                if (!owns(owner)) return@withTransaction false
                val previous = database.local().sync()
                database.local().sync(
                    SyncRecord(
                        value = api.json.encodeToString(ClientSyncState.serializer(), state),
                        revision =
                            (previous?.revision ?: 0) + 1,
                    ),
                )
                true
            }
        }

    private suspend fun owns(owner: OwnerRecord): Boolean {
        val auth = current.value
        val stored = database.local().owner()
        return auth?.user?.userId == owner.userId && auth?.session?.sessionId == owner.sessionId && stored == owner
    }

    suspend fun forgetIf(owner: OwnerRecord) {
        val captured = current.value ?: return
        if (captured.user.userId == owner.userId && captured.session.sessionId == owner.sessionId) invalidate(captured)
    }

    suspend fun download(
        media: MediaObject,
        owner: OwnerRecord? = null,
    ): ByteArray {
        val captured = capture(owner) ?: throw ApiFailure("unauthenticated", 401)
        val bytes = api.download(media, expectedSession = captured)
        return lock.withLock {
            if (current.value !== captured) throw ApiFailure("session_changed", 0)
            bytes
        }
    }

    suspend fun updateUser(
        user: CurrentUser,
        owner: OwnerRecord? = null,
    ) = lock.withLock {
        val before = capture(owner) ?: throw ApiFailure("unauthenticated", 401)
        require(before.user.userId == user.userId)
        // StateFlow retains the existing object for an equal value; keep the HTTP identity aligned.
        val next = if (before.user == user) before else before.copy(user = user)
        withContext(Dispatchers.IO) { vault.save(next) }
        api.authenticate(next)
        current.value = next
    }
}
