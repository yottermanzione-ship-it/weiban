package app.weiban.shell

import app.weiban.contracts.AuthResponse
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

internal data class LegacyFavoriteBinding(
    val owner: String,
    val auth: AuthResponse,
    val source: LegacyFavoriteSource,
)

internal data class LegacyFavoritesCall(
    val request: JSONObject,
    val generation: Long,
    val binding: LegacyFavoriteBinding? = null,
    val auth: AuthResponse? = null,
    val immediate: JSONObject? = null,
) {
    val owner: String get() = request.getString("owner")
}

/** prepare runs on the UI thread so logout/navigation supersedes an in-flight disk/network read. */
internal class ShellLegacyFavoritesSession(
    private val store: ShellLegacyFavoritesStore,
    private val source: (AuthResponse) -> LegacyFavoriteSource,
    private val now: () -> Long = System::currentTimeMillis,
    private val media: ShellLegacyFavoriteMedia? = null,
) {
    private var generation = 0L
    private var binding: LegacyFavoriteBinding? = null
    private var candidateOwner: String? = null
    private val uuid = Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")

    @Synchronized
    fun prepare(
        raw: String?,
        origin: String?,
        mainFrame: Boolean,
        currentUrl: String?,
    ): LegacyFavoritesCall? {
        val request = if (mainFrame && ShellPolicy.trusted(origin) && ShellPolicy.trusted(currentUrl)) parse(raw) else null
        return request?.let {
            try {
                prepareAccepted(it)
            } catch (error: LegacyFavoritesFailure) {
                LegacyFavoritesCall(it, generation, immediate = failure(it, error))
            } catch (_: Exception) {
                LegacyFavoritesCall(it, generation, immediate = failure(it, LegacyFavoritesFailure("invalid_request")))
            }
        }
    }

    private fun prepareAccepted(request: JSONObject): LegacyFavoritesCall {
        val owner = request.getString("owner")
        return when (request.getString("type")) {
            "bind" -> {
                val auth = parseNoticeAuth(request.getJSONObject("auth").toString())
                if (!uuid.matches(auth.user.userId) || !uuid.matches(auth.session.sessionId) ||
                    owner != "${auth.user.userId}:${auth.session.sessionId}"
                ) {
                    rejectLegacyFavorites("owner_mismatch")
                }
                requireUnexpired(auth)
                generation++
                binding = null
                candidateOwner = owner
                media?.reset()
                LegacyFavoritesCall(request, generation, auth = auth)
            }
            "clear" -> {
                if (owner != binding?.owner && owner != candidateOwner) rejectLegacyFavorites("owner_mismatch")
                reset()
                LegacyFavoritesCall(request, generation, immediate = response(request).put("cleared", true))
            }
            "read", "ack", "media" -> {
                val current = binding ?: rejectLegacyFavorites("not_bound", retryable = true)
                if (owner != current.owner) rejectLegacyFavorites("owner_mismatch")
                requireUnexpired(current.auth)
                LegacyFavoritesCall(request, generation, binding = current)
            }
            else -> rejectLegacyFavorites("unsupported")
        }
    }

    fun execute(call: LegacyFavoritesCall): JSONObject =
        when {
            !current(call) -> failure(call.request, LegacyFavoritesFailure("changed", retryable = true))
            call.immediate != null -> call.immediate
            else -> executeCurrent(call)
        }

    private fun executeCurrent(call: LegacyFavoritesCall): JSONObject {
        val result =
            try {
                if (call.auth != null) bind(call) else readOrAcknowledge(call)
            } catch (error: LegacyFavoritesFailure) {
                failure(call.request, error)
            } catch (_: Exception) {
                // Provider exception text can include a token, path, preference value or user content.
                failure(call.request, LegacyFavoritesFailure("source_unavailable", retryable = true))
            }
        return if (current(call)) result else failure(call.request, LegacyFavoritesFailure("changed", retryable = true))
    }

    @Synchronized
    fun current(call: LegacyFavoritesCall): Boolean = call.generation == generation

    @Synchronized
    fun reset() {
        generation++
        binding = null
        candidateOwner = null
        media?.reset()
    }

    private fun bind(call: LegacyFavoritesCall): JSONObject {
        val auth = checkNotNull(call.auth)
        val verified = verifySource(auth)
        synchronized(this) {
            if (!current(call)) rejectLegacyFavorites("changed", retryable = true)
            requireUnexpired(auth)
            binding = LegacyFavoriteBinding(call.owner, auth, verified)
            candidateOwner = null
        }
        return response(call.request).put("userId", auth.user.userId).put("available", verified.available)
    }

    private fun readOrAcknowledge(call: LegacyFavoritesCall): JSONObject {
        val bound = checkNotNull(call.binding)
        requireUnexpired(bound.auth)
        val verified = verifySource(bound.auth)
        if (verified != bound.source) rejectLegacyFavorites("source_changed", retryable = true)
        if (!current(call)) rejectLegacyFavorites("changed", retryable = true)
        if (!verified.available) return unavailable(call.request, verified.userId)
        val snapshot = store.snapshot(verified.userId, verified.accountKeys)
        if (!current(call)) rejectLegacyFavorites("changed", retryable = true)
        val expected = call.request.opt("snapshotDigest")
        if (expected != null && expected != JSONObject.NULL && expected != snapshot.digest) {
            rejectLegacyFavorites("snapshot_changed", retryable = true)
        }
        return when (call.request.getString("type")) {
            "ack" -> acknowledge(call, verified.userId, snapshot)
            "media" -> mediaPage(call, verified.userId, snapshot)
            else -> page(call.request, verified.userId, snapshot)
        }
    }

    private fun acknowledge(
        call: LegacyFavoritesCall,
        userId: String,
        snapshot: LegacyFavoriteSnapshot,
    ): JSONObject {
        if (call.request.opt("snapshotDigest") != snapshot.digest) rejectLegacyFavorites("invalid_request")
        synchronized(this) {
            if (!current(call)) rejectLegacyFavorites("changed", retryable = true)
            store.acknowledge(userId, snapshot.digest)
        }
        return response(call.request).put("userId", userId).put("snapshotDigest", snapshot.digest).put("acknowledged", true)
    }

    private fun mediaPage(
        call: LegacyFavoritesCall,
        userId: String,
        snapshot: LegacyFavoriteSnapshot,
    ): JSONObject {
        if (call.request.opt("snapshotDigest") != snapshot.digest) rejectLegacyFavorites("invalid_request")
        val result = (media ?: rejectLegacyFavorites("media_unavailable", blocked = true)).read(snapshot, call.request)
        return result
            .put("v", 1)
            .put("id", call.request.getString("id"))
            .put("owner", call.owner)
            .put("ok", true)
            .put("userId", userId)
            .put("snapshotDigest", snapshot.digest)
            .put("accountKey", call.request.getString("accountKey"))
            .put("itemKey", call.request.getString("itemKey"))
    }

    private fun page(
        request: JSONObject,
        userId: String,
        snapshot: LegacyFavoriteSnapshot,
    ): JSONObject {
        val offset = request.opt("offset") as? Int ?: rejectLegacyFavorites("cursor_invalid")
        val limit = request.opt("limit") as? Int ?: rejectLegacyFavorites("cursor_invalid")
        if (offset !in 0..snapshot.items.size ||
            limit !in 1..LegacyFavoritesLimits.MAX_BATCH
        ) {
            rejectLegacyFavorites("cursor_invalid")
        }
        val items = JSONArray()
        val result =
            response(request)
                .put("userId", userId)
                .put("available", true)
                .put("snapshotDigest", snapshot.digest)
                .put("total", snapshot.items.size)
                .put("offset", offset)
                .put("items", items)
                .put("unscopedPresent", snapshot.unscopedPresent)
                .put("acknowledged", store.acknowledged(userId, snapshot.digest))
        var next = offset
        while (next < snapshot.items.size && next - offset < limit) {
            items.put(snapshot.items[next])
            result.put("nextOffset", next + 1)
            if (result.toString().toByteArray(Charsets.UTF_8).size > LegacyFavoritesLimits.MAX_REPLY_BYTES - 32) {
                items.remove(items.length() - 1)
                if (next == offset) rejectLegacyFavorites("item_too_large", blocked = true)
                break
            }
            next++
        }
        return result.put("nextOffset", if (next < snapshot.items.size) next else JSONObject.NULL)
    }

    private fun verifySource(auth: AuthResponse): LegacyFavoriteSource {
        val verified = source(auth)
        if (verified.userId != auth.user.userId) rejectLegacyFavorites("owner_mismatch")
        val keys = verified.accountKeys
        val validKeys =
            keys.size <= LegacyFavoritesLimits.MAX_KEYS && keys.distinct().size == keys.size &&
                keys.all { LegacyFavoritesLimits.accountKey.matches(it) }
        if (verified.available != keys.isNotEmpty() || !validKeys) {
            rejectLegacyFavorites("source_invalid", blocked = true)
        }
        return verified.copy(accountKeys = verified.accountKeys.sorted())
    }

    private fun requireUnexpired(auth: AuthResponse) {
        if (Instant.parse(auth.session.expiresAt).toEpochMilli() <= now()) rejectLegacyFavorites("session_expired")
    }

    private fun parse(raw: String?): JSONObject? =
        runCatching {
            raw?.takeIf { it.length <= 20000 }?.let(::JSONObject)?.takeIf {
                it.optInt("v") == 1 && it.optString("id").matches(Regex("[a-zA-Z0-9-]{1,64}")) &&
                    it.optString("owner").length <= 80 && it.opt("type") is String && it.opt("owner") is String
            }
        }.getOrNull()

    private fun response(request: JSONObject): JSONObject =
        JSONObject()
            .put("v", 1)
            .put("id", request.getString("id"))
            .put("owner", request.getString("owner"))
            .put("ok", true)

    private fun failure(
        request: JSONObject,
        error: LegacyFavoritesFailure,
    ): JSONObject =
        response(request)
            .put("ok", false)
            .put("reason", error.reason)
            .put("blocked", error.blocked)
            .put("retryable", error.retryable)

    private fun unavailable(
        request: JSONObject,
        userId: String,
    ): JSONObject =
        response(request)
            .put("userId", userId)
            .put("available", false)
            .put("snapshotDigest", JSONObject.NULL)
            .put("total", 0)
            .put("offset", 0)
            .put("nextOffset", JSONObject.NULL)
            .put("items", JSONArray())
            .put("unscopedPresent", false)
            .put("acknowledged", false)
}
