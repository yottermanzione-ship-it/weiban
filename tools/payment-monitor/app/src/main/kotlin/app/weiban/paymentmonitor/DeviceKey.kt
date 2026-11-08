package app.weiban.paymentmonitor

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

object DeviceKey {
    private const val alias = "weiban-receipt-signing-v1"
    @Synchronized private fun store(): KeyStore {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
            generator.generateKeyPair()
        }
        return store
    }
    fun publicKey(): String = Base64.encodeToString(store().getCertificate(alias).publicKey.encoded, Base64.NO_WRAP)
    fun sign(message: String): String {
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(store().getKey(alias, null) as PrivateKey); signer.update(message.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(signer.sign(), Base64.NO_WRAP)
    }
}
