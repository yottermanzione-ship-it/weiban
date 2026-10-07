package app.weiban.designsystem

import java.text.Normalizer
import java.util.Locale
import kotlin.math.pow

/** Same canonical-name, unsigned UTF-16 hash and contrast rules as client-core/avatar.ts. */
object AvatarDefaults {
    fun paletteIndex(characterId: String): Int {
        var hash = 0
        for (character in characterId) hash = 31 * hash + character.code
        return (Integer.toUnsignedLong(hash) % 12).toInt() + 1
    }

    fun letters(
        name: String,
        override: String? = null,
    ): String {
        val normalized = Normalizer.normalize(override?.takeIf { it.isNotEmpty() } ?: name, Normalizer.Form.NFC)
        val han = normalized.codePoints().toArray().filter { Character.UnicodeScript.of(it) == Character.UnicodeScript.HAN }
        val words = Regex("[\\p{L}\\p{N}]+").findAll(normalized).map { it.value.codePointAt(0) }.toList()
        val selected =
            when {
                !override.isNullOrEmpty() -> normalized.codePoints().toArray().take(2)
                han.isNotEmpty() -> if (han.size == 3) han.takeLast(2) else han.take(2)
                else -> words
            }
        val text = selected.joinToString("") { String(Character.toChars(it)) }
        val rendered = if (!override.isNullOrEmpty() || han.isNotEmpty()) text else text.uppercase(Locale.ROOT)
        return rendered
            .codePoints()
            .toArray()
            .take(2)
            .joinToString("") { String(Character.toChars(it)) }
            .ifEmpty { "?" }
    }

    fun foreground(background: String): String {
        val level = luminance(background)
        val ink = luminance("#1F1A1D")
        val whiteContrast = 1.05 / (level + 0.05)
        val inkContrast = (maxOf(level, ink) + 0.05) / (minOf(level, ink) + 0.05)
        return if (whiteContrast >= inkContrast) "#FFFFFF" else "#1F1A1D"
    }

    private fun luminance(hex: String): Double {
        require(Regex("#[0-9a-fA-F]{6}").matches(hex))
        val channels = listOf(1, 3, 5).map { hex.substring(it, it + 2).toInt(16) / 255.0 }
        val linear = channels.map { if (it <= 0.04045) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
}
