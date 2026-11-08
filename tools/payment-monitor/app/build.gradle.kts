import java.util.Properties
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
val signingFile = providers.environmentVariable("WEIBAN_ANDROID_SIGNING_PROPERTIES_FILE").orNull?.let { file(it) }
val signing = Properties().apply { if (signingFile?.isFile == true) signingFile.inputStream().use { load(it) } }
val signingStore = signing.getProperty("storeFile")?.let { signingFile!!.parentFile.resolve(it).canonicalFile }
android {
    namespace = "app.weiban.paymentmonitor"
    compileSdk = 36
    defaultConfig { applicationId = "app.weiban.paymentmonitor"; minSdk = 26; targetSdk = 36; versionCode = 7; versionName = "1.0.6" }
    signingConfigs { create("formal") {
        if (signingStore?.isFile == true) {
            storeFile = signingStore; storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias"); keyPassword = signing.getProperty("keyPassword")
        }
    } }
    buildTypes { release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("formal") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}
tasks.configureEach {
    if (name == "validateSigningRelease") doFirst {
        check(signingFile?.isFile == true && signingStore?.isFile == true) { "Protected release signing is required; no debug fallback" }
        check(!signingStore!!.toPath().startsWith(rootProject.projectDir.canonicalFile.toPath())) { "Signing store must remain outside source" }
    }
}
dependencies { testImplementation("junit:junit:4.13.2"); testImplementation("org.json:json:20250517"); testImplementation("org.robolectric:robolectric:4.16.1") }
