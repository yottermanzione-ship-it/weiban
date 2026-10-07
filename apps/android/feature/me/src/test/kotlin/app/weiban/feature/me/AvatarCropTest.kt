package app.weiban.feature.me

import android.graphics.Bitmap
import android.graphics.Color
import app.weiban.designsystem.cropAvatar
import app.weiban.designsystem.decodeAvatar
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AvatarCropTest {
    @Test fun squareOutputReflectsSelectedCropRatherThanStretchingOriginal() {
        val image = Bitmap.createBitmap(200, 100, Bitmap.Config.ARGB_8888)
        for (x in 0 until 200)for (y in 0 until 100)image.setPixel(x, y, if (x < 100)Color.RED else Color.BLUE)
        val left = cropAvatar(image, 1f, -1f, 0f)
        val right = cropAvatar(image, 1f, 1f, 0f)
        assertEquals(512, left.width)
        assertEquals(512, left.height)
        assertEquals(Color.RED, left.getPixel(256, 256))
        assertEquals(Color.BLUE, right.getPixel(256, 256))
        left.recycle()
        right.recycle()
        image.recycle()
    }

    @Test fun realPngDecodeKeepsGeometryAndRejectsInvalidInput() {
        val image = Bitmap.createBitmap(20, 10, Bitmap.Config.ARGB_8888)
        val bytes =
            ByteArrayOutputStream().use { out ->
                image.compress(Bitmap.CompressFormat.PNG, 100, out)
                out.toByteArray()
            }
        val decoded = decodeAvatar(bytes)
        assertEquals(20, decoded.width)
        assertEquals(10, decoded.height)
        assertTrue(runCatching { decodeAvatar("not an image".toByteArray()) }.isFailure)
        decoded.recycle()
        image.recycle()
    }
}
