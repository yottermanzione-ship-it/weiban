package app.weiban.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellPolicyTest {
    @Test
    fun onlyTheProductionHttpsOriginIsTrusted() {
        assertTrue(ShellPolicy.trusted("https://app.weiban.online/chat/123?from=list#end"))
        assertTrue(ShellPolicy.trusted("https://app.weiban.online:443/"))
        for (url in listOf(
            "http://app.weiban.online/",
            "https://app.weiban.online:444/",
            "https://app.weiban.online.evil.example/",
            "https://app.weiban.online@evil.example/",
            "https://evil.example@app.weiban.online/",
            "https://admin.weiban.online/",
            "file:///data/data/com.weiban.webshell/",
            "content://provider/private",
            "javascript:alert(1)",
            "https://app.weiban.online\\@evil.example/",
            "https://app.weiban.online/\nother",
            "//app.weiban.online/",
        )) {
            assertFalse(url, ShellPolicy.trusted(url))
        }
        assertFalse(ShellPolicy.trusted(null))
    }

    @Test
    fun externalNavigationCannotDispatchArbitraryAndroidIntentsOrCredentials() {
        assertTrue(ShellPolicy.external("https://example.com/help?q=1"))
        for (url in listOf(
            "intent://example/#Intent;end",
            "file:///sdcard/a",
            "https://name:secret@example.com/",
            "data:text/html,hello",
        )) {
            assertFalse(ShellPolicy.external(url))
        }
    }

    @Test
    fun imageNamesCannotEscapeTheChosenDestinationOrMasqueradeAsApps() {
        assertEquals("______payload.jpg", ShellPolicy.fileName("../../payload.apk", "image/jpeg"))
        assertEquals("微伴分享.png", ShellPolicy.fileName("微伴分享.exe", "image/png"))
        assertTrue(ShellPolicy.fileName("a".repeat(200), "image/webp").length <= 85)
        assertEquals("weiban.gif", ShellPolicy.fileName("", "image/gif"))
    }
}
