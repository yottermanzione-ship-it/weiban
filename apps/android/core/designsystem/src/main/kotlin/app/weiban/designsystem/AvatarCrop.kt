package app.weiban.designsystem

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

fun decodeAvatar(bytes: ByteArray): Bitmap {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    require(options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 40_000_000)
    var sample = 1
    while (maxOf(options.outWidth, options.outHeight) / sample > 2048)sample *= 2
    val decoded =
        BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: error("Invalid image")
    val orientation =
        runCatching {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = orientationMatrix(orientation)
    return if (matrix.isIdentity) {
        decoded
    } else {
        Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also {
            if (it !==
                decoded
            ) {
                decoded.recycle()
            }
        }
    }
}

fun cropAvatar(
    original: Bitmap,
    zoom: Float,
    x: Float,
    y: Float,
): Bitmap {
    val side = (minOf(original.width, original.height) / zoom).roundToInt().coerceAtLeast(1)
    val left = ((original.width - side) * (x + 1f) / 2).roundToInt().coerceIn(0, original.width - side)
    val top = ((original.height - side) * (y + 1f) / 2).roundToInt().coerceIn(0, original.height - side)
    val cropped = Bitmap.createBitmap(original, left, top, side, side)
    return Bitmap.createScaledBitmap(cropped, 512, 512, true).also { if (cropped !== original && cropped !== it)cropped.recycle() }
}

private fun orientationMatrix(orientation: Int): Matrix {
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> {
            matrix.setRotate(90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> {
            matrix.setRotate(270f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
    }
    return matrix
}

internal fun readAvatar(
    context: android.content.Context,
    uri: Uri,
): Bitmap {
    val bytes =
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(out.size() + count <= 10_485_760)
                out.write(buffer, 0, count)
            }
            out.toByteArray()
        } ?: error("Cannot read selected image")
    return decodeAvatar(bytes)
}
