import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}

val legacyIdentity = rootProject.extra["weibanLegacyIdentity"] as Properties
val previousVersionCode = legacyIdentity.getProperty("previousVersionCode").toInt()
val nextVersionCode =
    providers
        .environmentVariable("WEIBAN_ANDROID_VERSION_CODE")
        .getOrElse(legacyIdentity.getProperty("versionCode"))
        .toInt()
check(nextVersionCode > previousVersionCode) { "Android versionCode must advance beyond every distributed legacy APK" }
val repositoryDirectory =
    rootProject.projectDir
        .resolve("../..")
        .canonicalFile
        .toPath()
val signingPropertiesFile =
    providers
        .environmentVariable("WEIBAN_ANDROID_SIGNING_PROPERTIES_FILE")
        .orNull
        ?.takeIf { it.isNotBlank() }
        ?.let { file(it).canonicalFile }
val signingProperties = Properties()
if (signingPropertiesFile?.isFile == true) {
    check(!signingPropertiesFile.toPath().startsWith(repositoryDirectory)) { "Signing credentials must stay outside the source repository" }
    signingPropertiesFile.inputStream().use { signingProperties.load(it) }
}
val signingStore =
    providers
        .environmentVariable("WEIBAN_ANDROID_KEYSTORE_FILE")
        .orNull
        ?.takeIf { it.isNotBlank() }
        ?.let { file(it).canonicalFile }
        ?: signingProperties.getProperty("storeFile")?.takeIf { it.isNotBlank() }?.let {
            signingPropertiesFile?.parentFile?.resolve(it)?.canonicalFile
        }
val signingReady =
    signingPropertiesFile?.isFile == true && signingStore?.isFile == true &&
        listOf("keyAlias", "keyPassword", "storePassword").all { !signingProperties.getProperty(it).isNullOrBlank() }

fun verifyLegacyReleaseSigning() {
    check(signingReady) { "Release requires the protected legacy signing store and credential file; debug signing is never a fallback" }
    check(!signingStore!!.toPath().startsWith(repositoryDirectory)) { "The private signing store must stay outside the source repository" }
    val storePassword = signingProperties.getProperty("storePassword").toCharArray()
    val keyPassword = signingProperties.getProperty("keyPassword").toCharArray()
    try {
        val store = KeyStore.getInstance("JKS")
        signingStore.inputStream().use { store.load(it, storePassword) }
        val alias = signingProperties.getProperty("keyAlias")
        check(store.isKeyEntry(alias))
        val certificate = store.getCertificate(alias)
        val digest =
            MessageDigest
                .getInstance("SHA-256")
                .digest(certificate.encoded)
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        check(digest == legacyIdentity.getProperty("certificateSha256"))
        val key = store.getKey(alias, keyPassword) as PrivateKey
        val challenge = "weiban-legacy-upgrade-signing-check".toByteArray(Charsets.UTF_8)
        val signer = Signature.getInstance("SHA256withRSA")
        signer.initSign(key)
        signer.update(challenge)
        val proof = signer.sign()
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(certificate.publicKey)
        verifier.update(challenge)
        check(verifier.verify(proof))
    } catch (_: Exception) {
        // Never return provider exceptions, aliases or credential values in build logs.
        throw GradleException("Legacy release signing validation failed; check the protected configuration and original key")
    } finally {
        storePassword.fill('\u0000')
        keyPassword.fill('\u0000')
    }
}

android {
    namespace = "app.weiban"
    compileSdk = 36
    defaultConfig {
        minSdk = rootProject.extra["weibanMinimumSdk"] as Int
        applicationId = legacyIdentity.getProperty("applicationId")
        targetSdk = 36
        versionCode = nextVersionCode
        versionName = legacyIdentity.getProperty("versionName")
        for ((field, variable) in mapOf(
            "API_BASE_URL" to "WEIBAN_API_BASE_URL",
            "FCM_APP_ID" to "WEIBAN_FCM_APP_ID",
            "FCM_SENDER_ID" to "WEIBAN_FCM_SENDER_ID",
            "FCM_PROJECT_ID" to "WEIBAN_FCM_PROJECT_ID",
            "FCM_API_KEY" to "WEIBAN_FCM_API_KEY",
            "ADMIN_PUBLIC_ORIGIN" to "WEIBAN_ADMIN_PUBLIC_ORIGIN",
        )) {
            val value = providers.environmentVariable(variable).getOrElse(if (field == "API_BASE_URL") "http://10.0.2.2:3000" else "")
            check(value.none { it.code < 32 }) { "Client configuration must not contain control characters" }
            buildConfigField("String", field, "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
        }
    }
    signingConfigs {
        create("legacyRelease") {
            if (signingReady) {
                storeFile = signingStore
                storePassword = signingProperties.getProperty("storePassword")
                keyAlias = signingProperties.getProperty("keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        debug {
            // A developer's debug certificate must never collide with an installed legacy release.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            signingConfig = signingConfigs.getByName("legacyRelease")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        val address = URI(providers.environmentVariable("WEIBAN_API_BASE_URL").getOrElse(""))
        check(
            address.scheme == "https" && address.host != null && address.userInfo == null &&
                address.query == null && address.fragment == null,
        ) {
            "Release requires WEIBAN_API_BASE_URL with a valid HTTPS server address"
        }
        verifyLegacyReleaseSigning()
    }
}
kotlin {
    jvmToolchain(21)
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
dependencies {
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    testImplementation(libs.junit)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.preview)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.work.runtime)
    implementation(project(":core:contracts-generated"))
    implementation(project(":core:network"))
    implementation(project(":core:data"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:me"))
    implementation(project(":feature:chat"))
    implementation(project(":platform"))
}
