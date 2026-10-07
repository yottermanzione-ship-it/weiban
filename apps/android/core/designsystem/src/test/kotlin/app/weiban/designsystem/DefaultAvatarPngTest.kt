package app.weiban.designsystem

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DefaultAvatarPngTest {
    @Test fun exportedPngUsesActual96PixelsRoundedCornersPaletteLettersAndSharedPatternShapes() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val masks = mutableSetOf<List<Boolean>>()
        for (pattern in listOf("none", "star", "heart", "note", "moon", "flower")) {
            val style = defaultAvatarStyle("same-role", "A", listOf("#E8608C", "#00FF00"), pattern = pattern)
            val bytes = defaultAvatarPng(context, style)
            assertArrayEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10), bytes.copyOfRange(0, 8))
            java.io.File(System.getProperty("java.io.tmpdir"), "weiban-notification-avatar-$pattern.png").writeBytes(bytes)
            val image = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)!!
            try {
                assertEquals(96, image.width)
                assertEquals(96, image.height)
                assertEquals(0, Color.alpha(image.getPixel(0, 0)))
                assertEquals(0, Color.alpha(image.getPixel(95, 95)))
                assertEquals(style.background.toArgb(), image.getPixel(48, 5))
                assertEquals(style.background.toArgb(), image.getPixel(5, 48))
                val ink = (30..65).sumOf { x -> (25..70).count { y -> image.getPixel(x, y) == style.foreground.toArgb() } }
                assertTrue("The exported name has actual readable glyph pixels", ink > 40)
                val badge = (63..83).flatMap { x -> (11..32).map { y -> image.getPixel(x, y) == Color.GREEN } }
                if (pattern == "none") assertFalse(badge.any { it }) else assertTrue(badge.count { it } > 15)
                assertTrue("Each badge has its own actual shape", masks.add(badge))
            } finally {
                image.recycle()
            }
        }
    }
}
