package app.weiban.shell

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal class LegacyFavoritesFailure(
    val reason: String,
    val blocked: Boolean = false,
    val retryable: Boolean = false,
) : Exception(reason)

/** One fixed-category error boundary; provider exceptions and private paths are never attached. */
internal fun rejectLegacyFavorites(
    reason: String,
    blocked: Boolean = false,
    retryable: Boolean = false,
): Nothing = throw LegacyFavoritesFailure(reason, blocked, retryable)

internal object LegacyFavoritesLimits {
    const val MAX_KEYS = 8
    const val MAX_ITEMS_PER_KEY = 500
    const val MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
    const val MAX_REPLY_BYTES = 256 * 1024
    const val MAX_BATCH = 25
    val accountKey = Regex("[a-z0-9]{4,20}")
    val digest = Regex("[a-f0-9]{64}")
}

internal fun legacyFavoritesDigest(value: String): String {
    val bytes = value.toByteArray(Charsets.UTF_8)
    return try {
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    } finally {
        bytes.fill(0)
    }
}

internal data class LegacyFavoriteSnapshot(
    val digest: String,
    val items: List<JSONObject>,
    val unscopedPresent: Boolean,
)

/** Reads only server-authorized legacy usernames. Never enumerates preferences or reads old auth/scope keys. */
internal class ShellLegacyFavoritesStore(
    legacyFactory: () -> SharedPreferences,
    receiptFactory: () -> SharedPreferences,
) {
    private val legacy by lazy(legacyFactory)
    private val receipts by lazy(receiptFactory)

    constructor(legacy: SharedPreferences, receipts: SharedPreferences) : this({ legacy }, { receipts })

    constructor(context: Context) : this(
        { context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE) },
        { context.getSharedPreferences("weiban_legacy_favorite_receipts_v1", Context.MODE_PRIVATE) },
    )

    fun snapshot(
        userId: String,
        accountKeys: List<String>,
    ): LegacyFavoriteSnapshot {
        require(accountKeys.isNotEmpty() && accountKeys.size <= LegacyFavoritesLimits.MAX_KEYS)
        require(accountKeys.distinct().size == accountKeys.size && accountKeys.all { LegacyFavoritesLimits.accountKey.matches(it) })
        val hashes = JSONArray()
        val items = mutableListOf<JSONObject>()
        var totalBytes = 0L
        for (key in accountKeys.sorted()) {
            val raw = readLegacy(key)
            if (raw.length > LegacyFavoritesLimits.MAX_SNAPSHOT_BYTES) throw LegacyFavoritesFailure("snapshot_too_large", blocked = true)
            totalBytes += raw.toByteArray(Charsets.UTF_8).size
            if (totalBytes > LegacyFavoritesLimits.MAX_SNAPSHOT_BYTES) throw LegacyFavoritesFailure("snapshot_too_large", blocked = true)
            hashes.put(JSONArray().put(key).put(legacyFavoritesDigest(raw)))
            items.addAll(LegacyFavoriteParser.parse(key, raw))
        }
        val digest =
            legacyFavoritesDigest(
                JSONArray()
                    .put(1)
                    .put(userId)
                    .put(hashes)
                    .toString(),
            )
        // An unscoped old key cannot establish ownership. Its value is never read or migrated.
        return LegacyFavoriteSnapshot(digest, items, legacy.contains("flutter.favorite_messages"))
    }

    fun acknowledged(
        userId: String,
        digest: String,
    ): Boolean = receipts.getString(receiptKey(userId), null) == digest

    fun acknowledge(
        userId: String,
        digest: String,
    ) {
        require(LegacyFavoritesLimits.digest.matches(digest))
        if (!receipts.edit().putString(receiptKey(userId), digest).commit()) {
            throw LegacyFavoritesFailure("storage_failed", retryable = true)
        }
    }

    private fun readLegacy(accountKey: String): String =
        try {
            legacy.getString("flutter.favorite_messages_$accountKey", null)?.takeUnless { it.isBlank() } ?: "[]"
        } catch (_: ClassCastException) {
            throw LegacyFavoritesFailure("snapshot_malformed", blocked = true)
        }

    private fun receiptKey(userId: String): String = "snapshot_" + legacyFavoritesDigest(userId)
}
