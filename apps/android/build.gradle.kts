plugins {
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

subprojects {
    tasks.withType<Test>().configureEach {
        systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
        // Local managed-network settings propagate only when present; CI uses standard TLS verification.
        for (key in listOf(
            "https.proxyHost",
            "https.proxyPort",
            "http.proxyHost",
            "http.proxyPort",
            "http.nonProxyHosts",
            "javax.net.ssl.trustStore",
        )) {
            System.getProperty(key)?.let { systemProperty(key, it) }
        }
    }
}

allprojects {
    dependencyLocking { lockAllConfigurations() }
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        compilerOptions.allWarningsAsErrors.set(true)
    }
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    apply(plugin = "io.gitlab.arturbosch.detekt")
    extensions.configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.7.1")
        filter {
            exclude {
                it.file.invariantSeparatorsPath.contains("/contracts-generated/src/main/") ||
                    it.file.invariantSeparatorsPath.contains("/tokens/") ||
                    it.file.invariantSeparatorsPath.contains("/build/")
            }
        }
    }
    extensions.configure<io.gitlab.arturbosch.detekt.extensions.DetektExtension> {
        config.setFrom(rootProject.files("config/detekt.yml"))
        buildUponDefaultConfig = true
    }
    tasks.withType<io.gitlab.arturbosch.detekt.Detekt>().configureEach {
        exclude {
            it.file.invariantSeparatorsPath.contains("/contracts-generated/src/main/") ||
                it.file.invariantSeparatorsPath.contains("/tokens/") ||
                it.file.invariantSeparatorsPath.contains("/build/")
        }
    }
}
