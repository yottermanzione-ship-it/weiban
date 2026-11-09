package app.weiban.shell

import app.weiban.contracts.AuthResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal data class LegacyFavoriteSource(
    val userId: String,
    val accountKeys: List<String>,
    val available: Boolean,
)

/** Fixed same-origin account mapping. Only the current session token is used, held in memory. */
internal class ShellLegacyFavoritesHttp(
    private val origin: String = ShellPolicy.ORIGIN,
) {
    private val client =
        OkHttpClient
            .Builder()
            .callTimeout(12, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

    fun source(auth: AuthResponse): LegacyFavoriteSource {
        val request =
            Request
                .Builder()
                .url(origin + "/api/v1/library/legacy-favorites/source")
                .header("Authorization", "Bearer ${auth.session.token}")
                .get()
                .build()
        return client.newCall(request).execute().use { response ->
            if (response.code == 401 || response.code == 403) rejectLegacyFavorites("authentication_failed")
            if (!response.isSuccessful) rejectLegacyFavorites("source_unavailable", retryable = true)
            val stream = response.body?.source() ?: rejectLegacyFavorites("source_unavailable", retryable = true)
            stream.request(16385)
            if (stream.buffer.size > 16384) rejectLegacyFavorites("source_invalid", blocked = true)
            parse(stream.readUtf8(), auth.user.userId)
        }
    }

    private fun parse(
        raw: String,
        expectedUser: String,
    ): LegacyFavoriteSource {
        val data = runCatching { JSONObject(raw) }.getOrNull() ?: rejectLegacyFavorites("source_invalid", blocked = true)
        if (data.optString("userId") != expectedUser) rejectLegacyFavorites("owner_mismatch")
        val keys = data.optJSONArray("legacyAccountKeys") ?: rejectLegacyFavorites("source_invalid", blocked = true)
        if (keys.length() > LegacyFavoritesLimits.MAX_KEYS || data.opt("available") !is Boolean) {
            rejectLegacyFavorites("source_invalid", blocked = true)
        }
        val values =
            (0 until keys.length()).map {
                keys.opt(
                    it,
                ) as? String ?: rejectLegacyFavorites("source_invalid", blocked = true)
            }
        if (values.distinct().size != values.size || values.any { !LegacyFavoritesLimits.accountKey.matches(it) }) {
            rejectLegacyFavorites("source_invalid", blocked = true)
        }
        val available = data.getBoolean("available")
        if (available != values.isNotEmpty()) rejectLegacyFavorites("source_invalid", blocked = true)
        return LegacyFavoriteSource(expectedUser, values.sorted(), available)
    }
}
