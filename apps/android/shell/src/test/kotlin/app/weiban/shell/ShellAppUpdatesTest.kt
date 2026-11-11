package app.weiban.shell

import android.content.pm.PackageInfo
import android.content.pm.Signature
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ShellAppUpdatesTest {
    @Suppress("DEPRECATION")
    private fun installedPackage(
        version: Long,
        signer: Byte = 1,
        name: String = "com.weiban.weiban",
    ) = PackageInfo().apply {
        packageName = name
        setLongVersionCode(version)
        signatures = arrayOf(Signature(byteArrayOf(signer)))
    }

    @Test
    fun onlyTheExpectedNewerPackageWithTheSameAppAndSignerCanReachTheInstaller() {
        val installed = installedPackage(128)
        assertTrue(matchesUpdatePackage(installedPackage(129), installed, 129))
        assertFalse(matchesUpdatePackage(installedPackage(130), installed, 129))
        assertFalse(matchesUpdatePackage(installedPackage(128), installed, 128))
        assertFalse(matchesUpdatePackage(installedPackage(129, signer = 2), installed, 129))
        assertFalse(matchesUpdatePackage(installedPackage(129, name = "another.app"), installed, 129))
    }

    @Test
    fun acceptsOnlyOfficialHttpsPackageFiles() {
        val path = "/download-assets/weiban-3.0.0-129-abcd.apk"
        assertTrue(ShellPolicy.appUpdate("https://app.weiban.online$path"))
        assertTrue(ShellPolicy.appUpdate("https://weiban.online$path"))
        for (url in listOf(
            "http://weiban.online$path",
            "https://weiban.online.example$path",
            "https://example@weiban.online$path",
            "https://weiban.online:444$path",
            "https://weiban.online$path?file=other",
            "https://weiban.online/download-assets/%2Fweiban-other.apk",
            "https://weiban.online/download-assets/weiban-3.0.0.html",
        )) {
            assertFalse(url, ShellPolicy.appUpdate(url))
        }
    }
}
