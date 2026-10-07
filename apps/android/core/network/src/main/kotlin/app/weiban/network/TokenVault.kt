package app.weiban.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import app.weiban.contracts.AuthResponse
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SessionVault {
    fun save(auth: AuthResponse)

    fun load(): AuthResponse?

    fun clear()
}

/** Only ciphertext goes to disk. Keystore key is non-exportable and app-scoped. */
class TokenVault(
    context: Context,
    private val json: Json,
) : SessionVault {
    private val file = AtomicFile(File(context.noBackupFilesDir, "session.aesgcm"))
    private val alias = "weiban.session.v1"
    private val aad = "weiban-session-v1".toByteArray(Charsets.UTF_8)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec
                        .Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }.generateKey()
    }

    @Synchronized override fun save(auth: AuthResponse) {
        val plaintext = json.encodeToString(auth).toByteArray(Charsets.UTF_8)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(aad)
            val ciphertext = cipher.doFinal(plaintext)
            val stream = file.startWrite()
            try {
                stream.write(byteArrayOf(1, cipher.iv.size.toByte()))
                stream.write(cipher.iv)
                stream.write(ciphertext)
                file.finishWrite(stream)
            } catch (error: java.io.IOException) {
                file.failWrite(stream)
                throw error
            }
        } finally {
            plaintext.fill(0)
        }
    }

    // Missing/corrupt/unavailable Keystore data always fails closed; each outcome is terminal.
    @Suppress("ReturnCount", "TooGenericExceptionCaught")
    @Synchronized
    override fun load(): AuthResponse? {
        if (!file.baseFile.exists()) return null
        try {
            val data = file.openRead().use { it.readBounded(65_537) }
            require(data.size in 30..65_536 && data[0].toInt() == 1 && data[1].toInt() == 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(2, 14)))
            cipher.updateAAD(aad)
            val plaintext = cipher.doFinal(data.copyOfRange(14, data.size))
            try {
                return json.decodeFromString<AuthResponse>(plaintext.toString(Charsets.UTF_8))
            } finally {
                plaintext.fill(0)
            }
        } catch (_: Exception) {
            clear()
            return null
        }
    }

    @Synchronized override fun clear() {
        file.delete()
    }
}
