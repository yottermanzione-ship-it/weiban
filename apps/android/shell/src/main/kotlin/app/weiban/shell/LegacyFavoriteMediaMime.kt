package app.weiban.shell

import java.util.Locale

/** A transport allow-list; the existing upload service remains the decoder/format validation boundary. */
internal object LegacyFavoriteMediaMime {
    fun detect(
        extension: String,
        voice: Boolean,
        bytes: ByteArray,
    ): String {
        val header = MediaHeader(bytes)
        val ext = extension.lowercase(Locale.ROOT)
        val result = if (voice) audio(ext, header) else image(ext, header)
        return result ?: rejectLegacyFavorites("unsupported_media", blocked = true)
    }

    private fun image(
        extension: String,
        header: MediaHeader,
    ): String? =
        when (extension) {
            "jpg", "jpeg" -> if (header.starts(255, 216, 255)) "image/jpeg" else null
            "png" -> if (header.starts(137, 80, 78, 71, 13, 10, 26, 10)) "image/png" else null
            "gif" -> if (header.ascii(0, "GIF87a") || header.ascii(0, "GIF89a")) "image/gif" else null
            "webp" -> if (header.ascii(0, "RIFF") && header.ascii(8, "WEBP")) "image/webp" else null
            else -> null
        }

    private fun audio(
        extension: String,
        header: MediaHeader,
    ): String? =
        when (extension) {
            "wav" -> if (header.ascii(0, "RIFF") && header.ascii(8, "WAVE")) "audio/wav" else null
            "ogg" -> if (header.ascii(0, "OggS")) "audio/ogg" else null
            "m4a" -> if (header.ascii(4, "ftyp")) "audio/mp4" else null
            "mp3" -> if (header.ascii(0, "ID3") || header.frame(224, 224)) "audio/mpeg" else null
            "aac" -> if (header.frame(246, 240)) "audio/aac" else null
            else -> null
        }
}

private class MediaHeader(
    private val bytes: ByteArray,
) {
    fun starts(vararg prefix: Int): Boolean = bytes.size >= prefix.size && prefix.indices.all { (bytes[it].toInt() and 255) == prefix[it] }

    fun ascii(
        offset: Int,
        text: String,
    ): Boolean = bytes.size >= offset + text.length && String(bytes, offset, text.length, Charsets.US_ASCII) == text

    fun frame(
        mask: Int,
        expected: Int,
    ): Boolean = bytes.size >= 2 && starts(255) && (bytes[1].toInt() and mask) == expected
}
