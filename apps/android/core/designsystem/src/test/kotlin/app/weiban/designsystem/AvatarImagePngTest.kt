package app.weiban.designsystem

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AvatarImagePngTest {
    @Test fun rectangularPrivateImagesBecomeActualRounded96PixelCentreCrops() {
        val source = Bitmap.createBitmap(192, 96, Bitmap.Config.ARGB_8888)
        source.eraseColor(Color.RED)
        for (x in 48..143) for (y in 0..95) source.setPixel(x, y, Color.BLUE)
        val bytes = avatarImagePng(source)
        val result = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)!!
        try {
            assertEquals(96, result.width)
            assertEquals(96, result.height)
            assertEquals(Color.BLUE, result.getPixel(48, 48))
            assertEquals(Color.BLUE, result.getPixel(2, 48))
            assertEquals(0, Color.alpha(result.getPixel(0, 0)))
            assertEquals(0, Color.alpha(result.getPixel(95, 95)))
            assertFalse(source.isRecycled)
        } finally {
            result.recycle()
            source.recycle()
        }
    }
}
