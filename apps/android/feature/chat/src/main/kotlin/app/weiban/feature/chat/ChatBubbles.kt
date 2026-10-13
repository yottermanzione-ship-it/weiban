package app.weiban.feature.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.WbTime
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.wbText
import kotlinx.coroutines.delay

/*
 * 聊天页气泡部件（规格 4.4）：带尖角的气泡、时间条、系统提示、发送状态、气泡长按深色菜单。
 */

internal val TAIL_WIDTH = 6.dp
private val TAIL_HEIGHT = 9.dp
private val TAIL_TOP = 11.dp
private val BUBBLE_RADIUS = 8.dp

/** 气泡外形：圆角 8 的矩形 + 外侧 6×9 三角尖角（距顶 11）。mine = 尖角朝右。 */
internal class BubbleShape(
    private val mine: Boolean,
    private val tail: Boolean = true,
) : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        val tw = with(density) { TAIL_WIDTH.toPx() }
        val th = with(density) { TAIL_HEIGHT.toPx() }
        val top = with(density) { TAIL_TOP.toPx() }
        val r = with(density) { BUBBLE_RADIUS.toPx() }
        val body = if (mine) Rect(0f, 0f, size.width - tw, size.height) else Rect(tw, 0f, size.width, size.height)
        val path = Path().apply { addRoundRect(RoundRect(body, CornerRadius(r))) }
        if (tail) {
            if (mine) {
                path.moveTo(body.right - 1f, top)
                path.lineTo(size.width, top + th / 2)
                path.lineTo(body.right - 1f, top + th)
            } else {
                path.moveTo(body.left + 1f, top)
                path.lineTo(0f, top + th / 2)
                path.lineTo(body.left + 1f, top + th)
            }
            path.close()
        }
        return Outline.Generic(path)
    }
}

/**
 * 气泡（4.4.4）：内距 12×9（加尖角宽度），他人 bg.card、我 bubble.mine；@我 mention.bg + 0.8 描边。
 * 正文默认 17 / 行高 1.35。
 */
@Composable internal fun Bubble(
    mine: Boolean,
    modifier: Modifier = Modifier,
    mention: Boolean = false,
    color: Color? = null,
    padding: PaddingValues = PaddingValues(horizontal = 12.dp, vertical = 9.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val shape = remember(mine) { BubbleShape(mine) }
    val bg =
        color ?: when {
            mention -> mode.uiMentionBg
            mine -> colors.bubbleSelfBg
            else -> colors.bubbleOtherBg
        }
    val text = if (mine && color == null) colors.bubbleSelfText else colors.textPrimary
    Column(
        modifier
            .background(bg, shape)
            .then(if (mention) Modifier.border(0.8.dp, mode.uiMentionBorder, shape) else Modifier)
            .padding(start = if (mine) 0.dp else TAIL_WIDTH, end = if (mine) TAIL_WIDTH else 0.dp)
            .padding(padding),
    ) {
        CompositionLocalProvider(LocalContentColor provides text, LocalTextStyle provides wbText(17.sp, 400, text, 1.35f)) {
            content()
        }
    }
}

/** 时间条（4.4.2）：12 / 行高 1.15，time.divider，居中，上 11 下 6。 */
@Composable internal fun TimeDivider(iso: String) {
    Text(
        WbTime.divider(iso),
        Modifier.fillMaxWidth().padding(top = 11.dp, bottom = 6.dp),
        style = wbText(12.sp, 400, LocalWeibanModeColors.current.uiTimeDivider, 1.15f),
        textAlign = TextAlign.Center,
    )
}

/** 系统提示（4.4.2）：无底色，14 灰字居中，内距 12 / 6 / 12 / 7。 */
@Composable internal fun SystemLine(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = LocalWeibanModeColors.current.uiSystemText,
) {
    Text(
        text,
        modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, end = 12.dp, bottom = 7.dp),
        style = wbText(14.sp, 400, color, 1.3f),
        textAlign = TextAlign.Center,
    )
}

/** 发送中：超过 2 秒仍未确认才显示 16 转圈；失败：红色实心感叹号圆 18，点 → 重发（4.4.6）。 */
@Composable internal fun SendStatus(
    failed: Boolean,
    onRetry: () -> Unit,
) {
    if (failed) {
        Box(
            Modifier.size(18.dp).background(Color(0xFFFA5151), CircleShape).clickableNoRipple(onRetry),
            contentAlignment = Alignment.Center,
        ) {
            Text("!", style = wbText(13.sp, 700, Color.White, 1f))
        }
        Spacer(Modifier.width(6.dp))
        return
    }
    var slow by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(SLOW_SEND_MS)
        slow = true
    }
    if (slow) {
        CircularProgressIndicator(Modifier.size(16.dp), color = Color(0xFFB2B2B2), strokeWidth = 2.dp)
        Spacer(Modifier.width(6.dp))
    }
}

private const val SLOW_SEND_MS = 2_000L

/** 气泡菜单的一格。 */
internal data class BubbleItem(
    val label: String,
    val icon: Int,
    val onClick: () -> Unit,
)

private val CELL_W = 58.dp
private val CELL_H = 50.dp
private const val PER_ROW = 5

/**
 * 气泡长按菜单（3.8）：深色块圆角 8，每格 58×50（白色图标 22 + 4 + 白字 12），格间 0.5×26 竖线，一行最多 5 个；
 * 默认在气泡上方 6，放不下在下方 4；三角 12×7 横向跟着手指，离菜单两端至少 12。点空白处关闭。
 */
@Composable internal fun BubbleMenu(
    bubble: Rect,
    fingerX: Float,
    items: List<BubbleItem>,
    onDismiss: () -> Unit,
) {
    if (items.isEmpty()) return
    val density = LocalDensity.current
    val window = LocalWindowInfo.current.containerSize
    val mode = LocalWeibanModeColors.current
    val rows = items.chunked(PER_ROW)
    val columns = rows.first().size
    val widthPx = with(density) { (CELL_W * columns + 0.5.dp * (columns - 1)).toPx() }
    val heightPx = with(density) { (CELL_H * rows.size + 0.5.dp * (rows.size - 1)).toPx() }
    val margin = with(density) { 12.dp.toPx() }
    val arrowH = with(density) { 7.dp.toPx() }
    val topLimit = with(density) { 100.dp.toPx() }
    val left = (fingerX - widthPx / 2).coerceIn(margin, (window.width - widthPx - margin).coerceAtLeast(margin))
    val above = bubble.top - with(density) { 6.dp.toPx() } - arrowH - heightPx
    val showAbove = above >= topLimit
    val top = if (showAbove) above else bubble.bottom + with(density) { 4.dp.toPx() }
    val arrowX = (fingerX - left).coerceIn(margin + with(density) { 6.dp.toPx() }, widthPx - margin - with(density) { 6.dp.toPx() })
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) { alpha.animateTo(1f, tween(WbMotion.MenuMs)) }
    val provider =
        remember(left, top) {
            object : PopupPositionProvider {
                override fun calculatePosition(
                    anchorBounds: IntRect,
                    windowSize: IntSize,
                    layoutDirection: LayoutDirection,
                    popupContentSize: IntSize,
                ): IntOffset = IntOffset(left.toInt(), top.toInt())
            }
        }
    val dark = mode.overlayMenu
    Popup(popupPositionProvider = provider, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Column(Modifier.alpha(alpha.value)) {
            if (!showAbove) Arrow(arrowX, up = true, color = dark)
            Column(
                Modifier
                    .shadow(8.dp, androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                    .background(dark, androidx.compose.foundation.shape.RoundedCornerShape(8.dp)),
            ) {
                rows.forEachIndexed { index, row ->
                    if (index > 0) Box(Modifier.width(with(density) { widthPx.toDp() }).height(0.5.dp).background(mode.uiMenuLine))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        row.forEachIndexed { i, item ->
                            if (i > 0) Box(Modifier.size(0.5.dp, 26.dp).background(mode.uiMenuLine))
                            Column(
                                Modifier
                                    .size(CELL_W, CELL_H)
                                    .clickableNoRipple {
                                        onDismiss()
                                        item.onClick()
                                    },
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                            ) {
                                WbIcon(item.icon, 22.dp, Color.White)
                                Spacer(Modifier.height(4.dp))
                                Text(item.label, style = wbText(12.sp, 400, Color.White, 1f), maxLines = 1)
                            }
                        }
                    }
                }
            }
            if (showAbove) Arrow(arrowX, up = false, color = dark)
        }
    }
}

@Composable private fun Arrow(
    x: Float,
    up: Boolean,
    color: Color,
) {
    val density = LocalDensity.current
    Canvas(Modifier.fillMaxWidth().height(7.dp)) {
        val half = with(density) { 6.dp.toPx() }
        val path =
            Path().apply {
                if (up) {
                    moveTo(x - half, size.height)
                    lineTo(x, 0f)
                    lineTo(x + half, size.height)
                } else {
                    moveTo(x - half, 0f)
                    lineTo(x, size.height)
                    lineTo(x + half, 0f)
                }
                close()
            }
        drawPath(path, color)
    }
}

/** 语音波纹（4.4.5）：三道弧（线宽 1.8），播放时依次亮起 900ms 循环；mirrored = 我发的（朝左）。 */
@Composable internal fun VoiceWaves(
    playing: Boolean,
    color: Color,
    mirrored: Boolean,
) {
    var step by remember { mutableIntStateOf(3) }
    LaunchedEffect(playing) {
        if (!playing) {
            step = 3
            return@LaunchedEffect
        }
        while (true) {
            for (s in 1..3) {
                step = s
                delay(WbMotion.VoiceWaveMs / 3L)
            }
        }
    }
    Canvas(Modifier.size(22.dp, 18.dp)) {
        val stroke = 1.8.dp.toPx()
        val cx = if (mirrored) size.width - 4.dp.toPx() else 4.dp.toPx()
        val cy = size.height / 2
        drawCircle(color, 1.8.dp.toPx(), Offset(cx, cy))
        for (i in 1..2) {
            val radius = (5 + i * 5).dp.toPx() * 0.6f + 2.dp.toPx()
            val start = if (mirrored) 135f else -45f
            drawArc(
                color.copy(alpha = if (i < step) 1f else 0.25f),
                start,
                90f,
                false,
                Offset(cx - radius, cy - radius),
                Size(radius * 2, radius * 2),
                style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round),
            )
        }
    }
}
