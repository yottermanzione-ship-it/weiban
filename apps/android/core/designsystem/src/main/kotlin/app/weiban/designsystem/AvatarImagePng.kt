package app.weiban.designsystem

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import java.io.ByteArrayOutputStream

/** Export a centred image crop with the same avatar corner ratio; leave source ownership to the caller. */
fun avatarImagePng(source: Bitmap): ByteArray {
    val size = WbSize.AvatarXxl.value
    val result = Bitmap.createBitmap(size.toInt(), size.toInt(), Bitmap.Config.ARGB_8888)
    try {
        val side = minOf(source.width, source.height)
        val left = (source.width - side) / 2
        val top = (source.height - side) / 2
        val canvas = Canvas(result)
        val target = RectF(0f, 0f, size, size)
        val path = Path().apply { addRoundRect(target, size * WbRadius.AvatarRatio, size * WbRadius.AvatarRatio, Path.Direction.CW) }
        canvas.clipPath(path)
        canvas.drawBitmap(
            source,
            Rect(left, top, left + side, top + side),
            target,
            Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
        )
        return ByteArrayOutputStream().use { output ->
            check(result.compress(Bitmap.CompressFormat.PNG, 100, output))
            output.toByteArray()
        }
    } finally {
        result.recycle()
    }
}
