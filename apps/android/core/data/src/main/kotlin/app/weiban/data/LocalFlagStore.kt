package app.weiban.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Small per-account UI markers kept in Room (cache table, "flag:" prefix).
 * Cleared together with the account cache when the owner changes, so markers never leak across accounts.
 * Used by L3: "while away" card last-active/dismissed markers and the period diary first-use notice.
 */
class LocalFlagStore internal constructor(
    private val database: LocalDatabase,
    private val lock: Mutex,
    private val owns: suspend (OwnerRecord) -> Boolean,
) {
    suspend fun get(
        owner: OwnerRecord,
        key: String,
    ): String? = lock.withLock { if (owns(owner)) database.local().cache(PREFIX + key) else null }

    suspend fun set(
        owner: OwnerRecord,
        key: String,
        value: String,
    ): Boolean =
        lock.withLock {
            if (!owns(owner)) return@withLock false
            database.local().cache(CacheRecord(PREFIX + key, value))
            true
        }

    private companion object {
        const val PREFIX = "flag:"
    }
}
