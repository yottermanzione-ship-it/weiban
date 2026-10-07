package app.weiban.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSupportPalette
import kotlin.math.*

data class DefaultAvatarStyle(
    val letters: String,
    val background: Color,
    val foreground: Color,
    val patternColor: Color,
    val pattern: String,
)

fun defaultAvatarStyle(
    id: String,
    name: String,
    colors: List<String> = emptyList(),
    text: String? = null,
    pattern: String = "star",
): DefaultAvatarStyle {
    val palette = WbSupportPalette.all[AvatarDefaults.paletteIndex(id) - 1]
    val supplied = colors.firstOrNull()
    val foreground = supplied?.let { avatarColor(AvatarDefaults.foreground(it)) } ?: palette.on
    return DefaultAvatarStyle(
        AvatarDefaults.letters(name, text),
        supplied?.let(::avatarColor) ?: palette.bg,
        foreground,
        colors.getOrNull(1)?.let(::avatarColor) ?: foreground.copy(alpha = 0.55f),
        pattern,
    )
}

private fun avatarColor(hex: String) = Color(0xFF000000 or hex.substring(1).toLong(16))

@Composable fun DefaultAvatar(
    style: DefaultAvatarStyle,
    size: Dp = 48.dp,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(size * WbRadius.AvatarRatio)
    Box(modifier.size(size).clip(shape).background(style.background), contentAlignment = Alignment.Center) {
        val count = style.letters.codePointCount(0, style.letters.length)
        Text(
            style.letters,
            color = style.foreground,
            fontSize = (size.value * if (count == 1) 0.44f else 0.34f).sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        if (size >= 40.dp && style.pattern != "none") {
            Canvas(Modifier.align(Alignment.TopEnd).padding(top = size * 0.12f, end = size * 0.12f).size(size * 0.22f)) {
                avatarPattern(style)
            }
        }
    }
}

private fun DrawScope.avatarPattern(style: DefaultAvatarStyle) {
    val unit = this.size.width
    when (style.pattern) {
        "heart" -> drawPath(heart(unit), style.patternColor)
        "note" -> {
            drawRect(style.patternColor, Offset(unit * 0.65f, 0f), Size(unit * 0.14f, unit * 0.75f))
            drawRect(style.patternColor, Offset(unit * 0.65f, 0f), Size(unit * 0.35f, unit * 0.18f))
            drawOval(style.patternColor, Offset(unit * 0.2f, unit * 0.65f), Size(unit * 0.58f, unit * 0.35f))
        }
        "moon" -> {
            drawCircle(style.patternColor)
            drawCircle(style.background, radius = unit * 0.48f, center = Offset(unit * 0.75f, unit * 0.3f))
        }
        "flower" -> {
            repeat(5) { petal ->
                val angle = 2 * PI * petal / 5
                drawCircle(
                    style.patternColor,
                    radius = unit * 0.23f,
                    center = center + Offset((cos(angle) * unit * 0.27).toFloat(), (sin(angle) * unit * 0.27).toFloat()),
                )
            }
            drawCircle(style.patternColor, radius = unit * 0.22f)
        }
        else -> drawPath(star(unit), style.patternColor)
    }
}

private fun heart(unit: Float) =
    Path().apply {
        moveTo(unit * 0.5f, unit * 0.92f)
        cubicTo(-unit * 0.15f, unit * 0.45f, 0f, -unit * 0.15f, unit * 0.5f, unit * 0.25f)
        cubicTo(unit, -unit * 0.15f, unit * 1.15f, unit * 0.45f, unit * 0.5f, unit * 0.92f)
        close()
    }

private fun star(unit: Float) =
    Path().apply {
        repeat(10) { point ->
            val angle = point * PI / 5 - PI / 2
            val radius = if (point % 2 == 0) unit * 0.5 else unit * 0.22
            val x = (unit / 2 + cos(angle) * radius).toFloat()
            val y = (unit / 2 + sin(angle) * radius).toFloat()
            if (point == 0) moveTo(x, y) else lineTo(x, y)
        }
        close()
    }
