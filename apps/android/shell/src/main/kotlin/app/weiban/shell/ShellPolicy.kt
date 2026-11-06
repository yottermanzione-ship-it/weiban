package app.weiban.shell

import java.net.URI

internal object ShellPolicy {
    const val ORIGIN = "https://app.weiban.online"
    const val START_URL = "$ORIGIN/"
    const val MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024
    val imageTypes = setOf("image/png", "image/jpeg", "image/gif", "image/webp")

    fun trusted(url: String?): Boolean {
        val parsed = parse(url) ?: return false
        return parsed.scheme == "https" && parsed.host == "app.weiban.online" &&
            parsed.port in setOf(-1, 443) && parsed.rawUserInfo == null
    }

    fun external(url: String?): Boolean {
        val parsed = parse(url) ?: return false
        return parsed.scheme in setOf("https", "http") && !parsed.host.isNullOrEmpty() && parsed.rawUserInfo == null
    }

    fun fileName(
        name: String,
        mimeType: String,
    ): String {
        val extension =
            when (mimeType) {
                "image/jpeg" -> "jpg"
                "image/gif" -> "gif"
                "image/webp" -> "webp"
                else -> "png"
            }
        val base = name.substringBeforeLast('.', name).replace(Regex("[^\\p{L}\\p{N}_-]"), "_").take(80)
        return "${base.ifBlank { "weiban" }}.$extension"
    }

    private fun parse(url: String?): URI? =
        try {
            url?.takeIf { it.length <= 8192 && it.none { character -> character.code < 32 } }?.let(::URI)
        } catch (_: IllegalArgumentException) {
            null
        } catch (_: java.net.URISyntaxException) {
            null
        }
}
