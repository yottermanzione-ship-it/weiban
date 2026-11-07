package app.weiban.shell

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.weiban.contracts.AuthResponse
import app.weiban.network.ContractJson
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class ShellNoticeState(
    val auth: AuthResponse,
    val authJson: String,
    val deviceId: String,
    val enabled: Boolean,
    val seen: List<String> = emptyList(),
) {
    val owner: String get() = "${auth.user.userId}:${auth.session.sessionId}"
}

/** Credentials are encrypted with AndroidKeyStore; no bodies or credentials in WorkManager/PendingIntent. */
internal class ShellNoticeStore(
    context: Context,
    private val key: () -> SecretKey = ::noticeKey,
) {
    private val preferences = context.getSharedPreferences("weiban_native_notices", Context.MODE_PRIVATE)

    fun installation(): String =
        synchronized(lock) {
            preferences.getString("installation", null) ?: UUID.randomUUID().toString().also {
                check(preferences.edit().putString("installation", it).commit())
            }
        }

    fun read(): ShellNoticeState? =
        synchronized(lock) {
            val stored = preferences.getString("sealed", null) ?: return null
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            val plain = cipher.doFinal(bytes.copyOfRange(12, bytes.size))
            try {
                val data = JSONObject(String(plain, Charsets.UTF_8))
                val raw = data.getString("auth")
                val seen = data.optJSONArray("seen") ?: JSONArray()
                ShellNoticeState(
                    parseNoticeAuth(
                        raw,
                    ),
                    raw,
                    data.getString("deviceId"),
                    data.getBoolean("enabled"),
                    (0 until seen.length())
                        .map {
                            seen.getString(it)
                        }.takeLast(128),
                )
            } finally {
                plain.fill(0)
            }
        }

    fun write(state: ShellNoticeState) =
        synchronized(lock) {
            val plain =
                JSONObject()
                    .put(
                        "auth",
                        state.authJson,
                    ).put(
                        "deviceId",
                        state.deviceId,
                    ).put("enabled", state.enabled)
                    .put("seen", JSONArray(state.seen.takeLast(128)))
                    .toString()
                    .toByteArray()
            try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key())
                val sealed = cipher.iv + cipher.doFinal(plain)
                check(preferences.edit().putString("sealed", Base64.encodeToString(sealed, Base64.NO_WRAP)).commit())
            } finally {
                plain.fill(0)
            }
        }

    fun clear() = synchronized(lock) { check(preferences.edit().remove("sealed").commit()) }

    companion object {
        val lock = Any()
    }
}

internal val noticeJson = Json { ignoreUnknownKeys = true }

internal fun parseNoticeAuth(raw: String): AuthResponse {
    require(raw.length <= 16384)
    return noticeJson
        .decodeFromJsonElement(
            AuthResponse.serializer(),
            ContractJson.normalize("AuthResponse", noticeJson.parseToJsonElement(raw)),
        ).also {
            require(it.session.kind == "app")
        }
}

private fun noticeKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val alias = "weiban-shell-notifications-v1"
    return (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
        init(
            KeyGenParameterSpec
                .Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        generateKey()
    }
}
