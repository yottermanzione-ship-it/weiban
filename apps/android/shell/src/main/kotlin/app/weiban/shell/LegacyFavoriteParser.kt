package app.weiban.shell

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Preserve the original message JSON and extensions; invalid entries stay in the old store. */
internal object LegacyFavoriteParser {
    private val textFields =
        mapOf(
            "author" to 200,
            "avatar" to 4096,
            "content" to 200000,
            "type" to 64,
            "imageUrl" to 4096,
            "quotedAuthor" to 200,
            "quotedContent" to 200000,
            "audioPath" to 4096,
            "clientMessageId" to 200,
            "sendState" to 64,
        )
    private val identifierFields = listOf("serverJobId", "serverSeq", "stickerId")
    private val credentialFields =
        setOf("password", "authtoken", "accesstoken", "refreshtoken", "authorization", "auth", "session", "token")

    fun parse(
        accountKey: String,
        raw: String,
    ): List<JSONObject> {
        boundedDepth(raw)
        val array =
            try {
                JSONArray(raw)
            } catch (_: Exception) {
                rejectLegacyFavorites("snapshot_malformed", blocked = true)
            }
        if (array.length() > LegacyFavoritesLimits.MAX_ITEMS_PER_KEY) rejectLegacyFavorites("snapshot_too_large", blocked = true)
        return (0 until array.length()).map { index -> item(accountKey, array.opt(index)) }
    }

    private fun item(
        accountKey: String,
        input: Any?,
    ): JSONObject {
        val raw = input as? JSONObject ?: invalid()
        if (raw.keys().asSequence().any { it !in setOf("chatKey", "chatTitle", "savedAt", "message") }) invalid()
        val chatKey = raw.opt("chatKey") as? String ?: invalid()
        val chatTitle = raw.opt("chatTitle") as? String ?: invalid()
        if (chatKey.isEmpty() || chatKey.length > 200 || chatTitle.length > 200) invalid()
        val savedAt = integer(raw.opt("savedAt"))
        if (savedAt !in 0..253402300799999L) invalid()
        val message = raw.optJSONObject("message") ?: invalid()
        validateMessage(message)
        rejectCredentialFields(message)
        // Dart interpolates a missing/null timestamp as the literal "null". savedAt is not identity.
        val identity = "$chatKey|${value(
            message,
            "timestamp",
        ) ?: "null"}|${value(message, "type") ?: "text"}|${value(message, "content") ?: ""}"
        val result = JSONObject().put("accountKey", accountKey).put("itemKey", legacyFavoritesDigest(identity)).put("favorite", raw)
        if (result.toString().toByteArray(Charsets.UTF_8).size > LegacyFavoritesLimits.MAX_REPLY_BYTES - 1024) {
            rejectLegacyFavorites("item_too_large", blocked = true)
        }
        return result
    }

    private fun validateMessage(raw: JSONObject) {
        validateText(raw)
        validateIdentifiers(raw)
        validateBooleans(raw)
        validateTimestamp(raw)
        validateDuration(raw)
    }

    private fun validateText(raw: JSONObject) {
        for ((key, max) in textFields) {
            val field = value(raw, key) ?: continue
            if (field !is String || field.length > max) invalid()
        }
    }

    private fun validateIdentifiers(raw: JSONObject) {
        for (key in identifierFields) {
            val field = value(raw, key) ?: continue
            if (field is String) {
                if (field.length > 200) invalid()
            } else {
                integer(field)
            }
        }
    }

    private fun validateBooleans(raw: JSONObject) {
        for (key in listOf("isMine", "isLocal", "mentionMe")) {
            if (raw.has(key) && key != "isMine" && raw.isNull(key)) invalid()
            val field = value(raw, key) ?: continue
            if (field !is Boolean) invalid()
        }
    }

    private fun validateTimestamp(raw: JSONObject) {
        value(raw, "timestamp")?.let {
            if (it is String) {
                if (it.length > 80) invalid()
            } else {
                integer(it)
            }
        }
    }

    private fun validateDuration(raw: JSONObject) {
        value(raw, "duration")?.let {
            val duration = (it as? Number)?.toDouble() ?: invalid()
            if (!duration.isFinite() || duration < 0 || duration > 86400) invalid()
        }
    }

    private fun rejectCredentialFields(value: Any?) {
        when (value) {
            is JSONObject -> for (key in value.keys()) {
                if (key.lowercase(Locale.ROOT).replace("_", "") in credentialFields) invalid()
                rejectCredentialFields(value.opt(key))
            }
            is JSONArray -> for (index in 0 until value.length()) rejectCredentialFields(value.opt(index))
        }
    }

    private fun integer(value: Any?): Long {
        val result =
            when (value) {
                is Int -> value.toLong()
                is Long -> value
                else -> invalid()
            }
        if (result < -9007199254740991L || result > 9007199254740991L) invalid()
        return result
    }

    private fun value(
        raw: JSONObject,
        key: String,
    ): Any? = raw.opt(key).takeUnless { it == JSONObject.NULL }

    private fun boundedDepth(raw: String) {
        var depth = 0
        var quoted = false
        var escaped = false
        for (character in raw) {
            when {
                escaped -> escaped = false
                quoted && character == '\\' -> escaped = true
                character == '"' -> quoted = !quoted
                !quoted && character in "[{" -> depth++
                !quoted && character in "]}" -> depth--
            }
            if (depth > 32) rejectLegacyFavorites("snapshot_malformed", blocked = true)
        }
    }

    private fun invalid(): Nothing = rejectLegacyFavorites("item_invalid", blocked = true)
}
