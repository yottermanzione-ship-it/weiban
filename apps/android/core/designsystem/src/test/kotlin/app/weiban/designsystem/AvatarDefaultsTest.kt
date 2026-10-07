package app.weiban.designsystem

import androidx.compose.ui.graphics.toArgb
import app.weiban.designsystem.tokens.WbColorSets
import app.weiban.designsystem.tokens.WbSupportPalette
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class AvatarDefaultsTest {
    private val samples =
        Json
            .parseToJsonElement(
                javaClass.getResourceAsStream("/avatars.json")!!.bufferedReader().use {
                    it.readText()
                },
            ).jsonObject

    @Test fun namesAndUnsignedHashMatchTheWebSharedSamples() {
        for (sample in samples.getValue("names").jsonArray) {
            val row = sample.jsonObject
            assertEquals(
                row.getValue("text").jsonPrimitive.content,
                AvatarDefaults.letters(row.getValue("name").jsonPrimitive.content, row.getValue("override").jsonPrimitive.contentOrNull),
            )
            assertEquals(
                row.getValue("paletteIndex").jsonPrimitive.int,
                AvatarDefaults.paletteIndex(row.getValue("characterId").jsonPrimitive.content),
            )
        }
    }

    @Test fun suppliedColorContrastMatchesWebAndRejectsMalformedColor() {
        for (sample in samples.getValue("colors").jsonArray) {
            val row = sample.jsonObject
            assertEquals(
                row.getValue("foreground").jsonPrimitive.content,
                AvatarDefaults.foreground(row.getValue("background").jsonPrimitive.content),
            )
        }
        assertTrue(runCatching { AvatarDefaults.foreground("red") }.isFailure)
    }

    @Test fun generatedNumberedPaletteStartsAtSupport01AndEndsAtSupport12() {
        assertEquals(12, WbSupportPalette.all.size)
        assertEquals(
            0xFFE8608C.toInt(),
            WbSupportPalette.all
                .first()
                .bg
                .toArgb(),
        )
        assertEquals(
            0xFF8E6A58.toInt(),
            WbSupportPalette.all
                .last()
                .bg
                .toArgb(),
        )
    }

    @Test fun generatedUserColorsKeepTheFixedNeutralBackgroundInBothModes() {
        for (colors in listOf(WbColorSets.GreenLight, WbColorSets.GreenDark)) {
            assertEquals(0xFFD9D9D9.toInt(), colors.bgUserAvatar.toArgb())
            assertEquals(0xFF1A1A1A.toInt(), colors.textUserAvatar.toArgb())
        }
        for (colors in listOf(WbColorSets.PinkLight, WbColorSets.PinkDark)) {
            assertEquals(0xFFE2DDE0.toInt(), colors.bgUserAvatar.toArgb())
            assertEquals(0xFF1F1A1D.toInt(), colors.textUserAvatar.toArgb())
        }
    }
}
