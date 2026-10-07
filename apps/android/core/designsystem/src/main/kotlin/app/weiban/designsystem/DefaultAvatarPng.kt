package app.weiban.designsystem

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.inset
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.createFontFamilyResolver
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import java.io.ByteArrayOutputStream

/** Notification systems need pixels: export the same style and shape as the UI at exactly 96px. */
fun defaultAvatarPng(
    context: Context,
    style: DefaultAvatarStyle,
): ByteArray {
    val size = WbSize.AvatarXxl.value
    val bitmap = Bitmap.createBitmap(size.toInt(), size.toInt(), Bitmap.Config.ARGB_8888)
    try {
        val letters =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = style.foreground.toArgb()
                textAlign = Paint.Align.CENTER
                textSize = size * if (style.letters.codePointCount(0, style.letters.length) == 1) 0.44f else 0.34f
                typeface = createFontFamilyResolver(context).resolve(FontFamily.Default, FontWeight.SemiBold).value as Typeface
            }
        val clip =
            Path().apply {
                addRoundRect(RoundRect(Rect(0f, 0f, size, size), CornerRadius(size * WbRadius.AvatarRatio)))
            }
        CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, Canvas(bitmap.asImageBitmap()), Size(size, size)) {
            clipPath(clip) {
                drawRect(style.background)
                drawContext.canvas.nativeCanvas.drawText(
                    style.letters,
                    size / 2,
                    (size - letters.ascent() - letters.descent()) / 2,
                    letters,
                )
                if (style.pattern != "none") {
                    inset(left = size * 0.66f, top = size * 0.12f, right = size * 0.12f, bottom = size * 0.66f) {
                        avatarPattern(style)
                    }
                }
            }
        }
        return ByteArrayOutputStream().use { output ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            output.toByteArray()
        }
    } finally {
        bitmap.recycle()
    }
}
