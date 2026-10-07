pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "Weiban"
include(
    ":app",
    ":core:contracts-generated",
    ":core:network",
    ":core:data",
    ":core:designsystem",
    ":core:testvectors",
    ":feature:auth",
    ":feature:me",
    ":feature:chat",
    ":platform",
)
