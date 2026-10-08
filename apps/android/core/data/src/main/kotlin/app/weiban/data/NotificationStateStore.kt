package app.weiban.data

import androidx.room.withTransaction
import app.weiban.contracts.NotificationEnvelope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** Device opt-in and inbox share the session lock; background jobs carry only IDs. */
class NotificationStateStore internal constructor(
    private val database: LocalDatabase,
    private val json: Json,
    private val lock: Mutex,
    private val owns: suspend (OwnerRecord) -> Boolean,
) {
    suspend fun enabled(owner: OwnerRecord): Boolean = lock.withLock { owns(owner) && enabledHere() }

    suspend fun setEnabled(
        owner: OwnerRecord,
        value: Boolean,
    ): Boolean =
        lock.withLock {
            if (!owns(owner)) return@withLock false
            database.withTransaction {
                database.local().cache(CacheRecord("notification:enabled", value.toString()))
                if (!value) {
                    for (id in savedIds("notification:pending")) database.local().deleteCache(payloadKey(id))
                    database.local().deleteCache("notification:pending")
                }
            }
            true
        }

    suspend fun deviceId(owner: OwnerRecord): String? =
        lock.withLock { if (owns(owner)) database.local().cache("notification:deviceId")?.takeUnless { it.isEmpty() } else null }

    suspend fun saveDevice(
        owner: OwnerRecord,
        id: String?,
    ): Boolean =
        lock.withLock {
            if (!owns(owner)) return@withLock false
            database.local().cache(CacheRecord("notification:deviceId", id.orEmpty()))
            true
        }

    suspend fun enqueue(
        owner: OwnerRecord,
        envelope: NotificationEnvelope,
    ): Boolean =
        lock.withLock {
            val recipient = envelope.recipientUserId == owner.userId && envelope.recipientSessionId == owner.sessionId
            val active = owns(owner) && enabledHere()
            if (!active || !recipient || envelope.notificationId in receipts()) {
                return@withLock false
            }
            database.withTransaction {
                val before = savedIds("notification:pending")
                val pending = (before.filter { it != envelope.notificationId } + envelope.notificationId).takeLast(128)
                for (id in before - pending.toSet()) database.local().deleteCache(payloadKey(id))
                database.local().cache(
                    CacheRecord(payloadKey(envelope.notificationId), json.encodeToString(NotificationEnvelope.serializer(), envelope)),
                )
                saveIds("notification:pending", pending)
            }
            true
        }

    suspend fun pending(
        owner: OwnerRecord,
        id: String,
    ): NotificationEnvelope? =
        lock.withLock {
            if (!owns(owner) || !enabledHere()) return@withLock null
            val saved = database.local().cache(payloadKey(id))?.takeUnless { it.isEmpty() } ?: return@withLock null
            json.decodeFromString(NotificationEnvelope.serializer(), saved)
        }

    suspend fun discard(
        owner: OwnerRecord,
        id: String,
    ) = lock.withLock {
        if (owns(owner)) removePending(id)
    }

    /** The synchronous OS publish is serialized with logout/account replacement. */
    suspend fun publish(
        owner: OwnerRecord,
        id: String,
        display: () -> Unit,
    ): Boolean =
        lock.withLock {
            if (!owns(owner) || !enabledHere()) return@withLock false
            val before = receipts()
            if (id in before || database.local().cache(payloadKey(id)) == null) return@withLock false
            display()
            database.withTransaction {
                saveIds("notification:receipts", (before + id).takeLast(128))
                removePending(id)
            }
            true
        }

    private suspend fun enabledHere() = database.local().cache("notification:enabled") == "true"

    private suspend fun receipts() = savedIds("notification:receipts")

    private suspend fun savedIds(key: String): List<String> =
        database.local().cache(key)?.let { json.decodeFromString(ListSerializer(String.serializer()), it) } ?: emptyList()

    private suspend fun saveIds(
        key: String,
        ids: List<String>,
    ) {
        database.local().cache(CacheRecord(key, json.encodeToString(ListSerializer(String.serializer()), ids)))
    }

    private suspend fun removePending(id: String) {
        database.local().deleteCache(payloadKey(id))
        saveIds("notification:pending", savedIds("notification:pending").filter { it != id })
    }

    private fun payloadKey(id: String) = "notification:payload:$id"
}
