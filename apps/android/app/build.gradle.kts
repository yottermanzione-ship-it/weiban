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
        buildConfigField(
            "String",
            "API_BASE_URL",
            "\"${providers.environmentVariable("WEIBAN_API_BASE_URL").getOrElse("http://10.0.2.2:3000")}\"",
        )
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
    implementation(project(":core:contracts-generated"))
    implementation(project(":core:network"))
    implementation(project(":core:data"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:me"))
    implementation(project(":platform"))
}
