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

/** Session changes and all cache writes share one lock; responses never cross an account epoch. */
class SessionRepository(
    val api: ApiClient,
    private val database: LocalDatabase,
    private val vault: SessionVault,
) {
    private val lock = Mutex()
    private val current = MutableStateFlow<AuthResponse?>(null)
    val auth: StateFlow<AuthResponse?> = current

    suspend fun restore() =
        lock.withLock {
            val saved = withContext(Dispatchers.IO) { vault.load() }
            val owner = database.local().owner()
            if (saved == null || owner?.sessionId != saved.session.sessionId || owner?.userId != saved.user.userId) {
                database.withTransaction { database.local().replaceOwner(null) }
                withContext(Dispatchers.IO) { vault.clear() }
                current.value = null
                api.authenticate(null)
            } else {
                current.value = saved
                api.authenticate(saved)
            }
        }

    suspend fun authenticate(auth: AuthResponse) =
        lock.withLock {
            current.value = null
            api.authenticate(null)
            database.withTransaction {
                database.local().replaceOwner(
                    OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId),
                )
            }
            withContext(Dispatchers.IO) { vault.save(auth) }
            current.value = auth
            api.authenticate(auth)
        }

    suspend fun forget() =
        lock.withLock {
            current.value = null
            api.authenticate(null)
            database.withTransaction { database.local().replaceOwner(null) }
            withContext(Dispatchers.IO) { vault.clear() }
        }

    private suspend fun invalidate(expected: AuthResponse) =
        lock.withLock {
            if (current.value !== expected)return@withLock
            current.value = null
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
    ): T {
        val captured = current.value
        val key = endpoint.id + ":" + params.toSortedMap() + ":" + query.toSortedMap()
        val value =
            try {
                api.call(endpoint, body, params, query, idempotencyKey, multipart)
            } catch (error: ApiFailure) {
                if (error.code == "unauthenticated" && captured != null) invalidate(captured)
                throw error
            } catch (error: IOException) {
                return cached(endpoint, captured, key, error)
            }
        return if (endpoint.auth == "none") value else commit(endpoint, captured, key, value)
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
    ): T =
        lock.withLock {
            if (current.value !== captured || captured == null) throw ApiFailure("session_changed", 0)
            if (endpoint.method == "GET") {
                database.withTransaction { database.local().cache(CacheRecord(key, api.json.encodeToString(endpoint.response, value))) }
                // First display also reads the committed representation.
                api.json.decodeFromString(endpoint.response, database.local().cache(key)!!)
            } else {
                value
            }
        }

    suspend fun download(media: MediaObject): ByteArray {
        val captured = current.value ?: throw ApiFailure("unauthenticated", 401)
        val bytes = api.download(media)
        return lock.withLock {
            if (current.value !== captured) throw ApiFailure("session_changed", 0)
            bytes
        }
    }

    suspend fun updateUser(user: CurrentUser) =
        lock.withLock {
            val before = current.value ?: throw ApiFailure("unauthenticated", 401)
            require(before.user.userId == user.userId)
            val next = before.copy(user = user)
            withContext(Dispatchers.IO) { vault.save(next) }
            current.value = next
            api.authenticate(next)
        }
}
