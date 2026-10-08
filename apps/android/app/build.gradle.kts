import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}
android {
    namespace = "app.weiban"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        applicationId = "app.weiban"
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
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
