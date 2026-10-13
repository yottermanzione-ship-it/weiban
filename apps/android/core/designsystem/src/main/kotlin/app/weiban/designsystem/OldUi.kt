package app.weiban.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R
import app.weiban.designsystem.tokens.WbMotion

/*
 * 旧版界面基础部件（docs/refactor/06-old-ui-spec.md 第 2、3 节）：图标、细线、按下态、分组标题、
 * iOS 胶囊开关、勾选圈、空状态、文字切换、按钮、角标。网页对照 apps/web/src/features/shell-kit.tsx。
 */

/** 1 物理像素细线（规格 1「hairline」）。 */
val hairline: Dp
    @Composable get() = (1f / LocalDensity.current.density).dp

/** 旧版文字样式：字号 / 字重 / 颜色一次给全（行高默认约 1.2）。 */
fun wbText(
    size: TextUnit,
    weight: Int = 400,
    color: Color = Color.Unspecified,
    lineHeight: Float = 1.2f,
): TextStyle = TextStyle(fontSize = size, fontWeight = FontWeight(weight), color = color, lineHeight = size * lineHeight)

/** 旧版素材图标。tint = null 时按原色显示（彩色图、位图）。 */
@Composable fun WbIcon(
    res: Int,
    size: Dp,
    tint: Color? = LocalWeibanColors.current.textPrimary,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    if (tint == null) {
        Image(painterResource(res), contentDescription, modifier.size(size))
    } else {
        Icon(painterResource(res), contentDescription, modifier.size(size), tint = tint)
    }
}

/** 旧版文字符号（各页面原来的 ✎ ☺ ⌕ 等）对应的素材图标；没有对应的返回 null，继续画文字。 */
fun glyphIcon(glyph: String): Int? =
    when (glyph) {
        "⌕", "🔍" -> R.drawable.wb_search
        "⊕", "＋", "+" -> R.drawable.wb_add
        "✎", "📝" -> R.drawable.wb_note
        "☺", "☻" -> R.drawable.wb_drawn_people
        "☰", "☷" -> R.drawable.wb_chat_pair
        "★", "☆" -> R.drawable.wb_star
        "♡", "❤", "♥" -> R.drawable.wb_heart
        "✓", "☑" -> R.drawable.wb_check
        "⚙" -> R.drawable.wb_color_settings
        "✉" -> R.drawable.wb_drawn_letter
        "⌛", "⏳" -> R.drawable.wb_drawn_hourglass
        "⏰", "🔔" -> R.drawable.wb_bell
        "◇", "◆" -> R.drawable.wb_discover_mini_program
        "✆", "☎" -> R.drawable.wb_voice_call
        "▦", "▣" -> R.drawable.wb_album
        "◉" -> R.drawable.wb_camera
        "✦", "✧" -> R.drawable.wb_drawn_scenario_sparkle
        "◈", "▤" -> R.drawable.wb_picture
        "🔒", "🔐" -> R.drawable.wb_info
        "⇩", "↧" -> R.drawable.wb_drawn_import
        "🐾" -> R.drawable.wb_drawn_paw
        "❀", "✿" -> R.drawable.wb_drawn_flower
        "▭", "🂠" -> R.drawable.wb_drawn_cards
        "¥" -> R.drawable.wb_transfer
        "#" -> R.drawable.wb_tag
        "i", "ⓘ" -> R.drawable.wb_info
        "✕", "×" -> R.drawable.wb_close
        else -> null
    }

/** 整行按下态：日间 5% 黑、夜间 5% 白（规格 3.3），不用水波纹。 */
fun Modifier.pressable(
    enabled: Boolean = true,
    onClick: () -> Unit,
): Modifier =
    composed {
        val source = remember { MutableInteractionSource() }
        val pressed by source.collectIsPressedAsState()
        val colors = LocalWeibanColors.current
        this
            .background(if (pressed) colors.bgPressed else Color.Transparent)
            .clickable(source, indication = null, enabled = enabled, onClick = onClick)
    }

/**
 * 点按 + 长按（长按把手指在窗口里的位置交给 onLongPress，用于在手指处弹出浅色长按菜单 3.7）。
 */
fun Modifier.pressMenu(
    onClick: () -> Unit,
    onLongPress: (Offset) -> Unit,
    onDoubleClick: (() -> Unit)? = null,
    pressedColor: Boolean = true,
): Modifier =
    composed {
        var origin by remember { mutableStateOf(Offset.Zero) }
        var pressed by remember { mutableStateOf(false) }
        val colors = LocalWeibanColors.current
        val click by rememberUpdatedState(onClick)
        val long by rememberUpdatedState(onLongPress)
        val double by rememberUpdatedState(onDoubleClick)
        this
            .onGloballyPositioned { origin = it.positionInWindow() }
            .background(if (pressed && pressedColor) colors.bgPressed else Color.Transparent)
            .pointerInput(onDoubleClick != null) {
                detectTapGestures(
                    onPress = {
                        pressed = true
                        tryAwaitRelease()
                        pressed = false
                    },
                    onDoubleTap = if (onDoubleClick != null) ({ double?.invoke() }) else null,
                    onLongPress = { long(origin + it) },
                    onTap = { click() },
                )
            }
    }

/** 分组标题（3.5）：高 35.7，页面灰底，14 次要色，左 17.4，贴底 7.4。 */
@Composable fun GroupHeader(
    title: String,
    trailing: String? = null,
    modifier: Modifier = Modifier,
) {
    val colors = LocalWeibanColors.current
    Row(
        modifier.fillMaxWidth().height(35.7.dp).background(colors.bgPage).padding(start = 17.4.dp, end = 16.dp, bottom = 7.4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(title, Modifier.weight(1f), style = wbText(14.sp, color = colors.textSecondary), maxLines = 1)
        trailing?.let { Text(it, style = wbText(12.sp, color = colors.textSecondary), maxLines = 1) }
    }
}

/** iOS 式胶囊开关（3.6）：51×31，开 brand、关 rgba(120,120,128,0.16)，白色圆钮。 */
@Composable fun WbSwitch(
    checked: Boolean,
    onChange: ((Boolean) -> Unit)?,
    enabled: Boolean = true,
) {
    val colors = LocalWeibanColors.current
    val track by animateColorAsState(if (checked) colors.brandPrimary else Color(0x29787880), tween(WbMotion.FastMs), label = "开关轨道")
    val thumb by animateDpAsState(if (checked) 22.dp else 2.dp, tween(WbMotion.FastMs, easing = WbMotion.Standard), label = "开关圆钮")
    Box(
        Modifier
            .size(51.dp, 31.dp)
            .clip(CircleShape)
            .background(if (enabled) track else track.copy(alpha = track.alpha * 0.5f))
            .then(
                if (onChange != null) {
                    Modifier.clickable(enabled = enabled, indication = null, interactionSource = null) { onChange(!checked) }
                } else {
                    Modifier
                },
            ),
    ) {
        Box(
            Modifier
                .padding(start = thumb, top = 2.dp)
                .size(27.dp)
                .shadow(2.dp, CircleShape)
                .background(Color.White, CircleShape),
        )
    }
}

/** 勾选圈（3.15）：24 圆；未选 1.4 描边 chevron，选中 brand 实心 + 白 ✓。 */
@Composable fun CheckCircle(
    checked: Boolean,
    size: Dp = 24.dp,
    enabled: Boolean = true,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .then(
                if (checked) {
                    Modifier.background(if (enabled) colors.brandPrimary else mode.uiBrandDisabled)
                } else {
                    Modifier.border(1.4.dp, mode.uiChevron, CircleShape)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) WbIcon(R.drawable.wb_check, size * 0.75f, Color.White)
    }
}

/** 空状态（3.16）：图标 72 → 14 → 主文案 14 → 8 → 说明 13 → 16 → 主按钮。 */
@Composable fun EmptyState(
    title: String,
    icon: Int = R.drawable.wb_chat,
    desc: String? = null,
    action: String? = null,
    modifier: Modifier = Modifier,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        WbIcon(icon, 72.dp, Color(0xFF999999))
        Spacer(Modifier.height(14.dp))
        Text(title, style = wbText(14.sp, color = Color(0xFF888888)), textAlign = TextAlign.Center)
        desc?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = wbText(13.sp, color = Color(0xFF888888)), textAlign = TextAlign.Center)
        }
        if (action != null && onAction != null) {
            Spacer(Modifier.height(16.dp))
            PrimaryButton(action, onClick = onAction, modifier = Modifier.widthIn(min = 160.dp))
        }
    }
}

/** 一排文字切换（第 5 节表）：选中 15/500 + 下方 2 高 brand 短线（宽 20）。 */
@Composable fun TextTabs(
    options: List<String>,
    selected: Int,
    modifier: Modifier = Modifier,
    onSelect: (Int) -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        modifier.fillMaxWidth().background(colors.bgSurface).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEachIndexed { index, label ->
            val on = index == selected
            Column(
                Modifier.clickable(indication = null, interactionSource = null) { onSelect(index) }.padding(horizontal = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    label,
                    Modifier.padding(top = 12.dp, bottom = 8.dp),
                    style = wbText(15.sp, if (on) 500 else 400, if (on) colors.textPrimary else colors.textSecondary),
                    maxLines = 1,
                )
                Box(Modifier.size(20.dp, 2.dp).background(if (on) colors.brandPrimary else Color.Transparent, RoundedCornerShape(1.dp)))
            }
        }
    }
}

/** 主按钮（3.17）：高 48、圆角 10、brand 底、白字 16/600；禁用底 #9BE6BD。 */
@Composable fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val base = if (danger) colors.textDanger else colors.brandPrimary
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) base else if (danger) base.copy(alpha = 0.4f) else mode.uiBrandDisabled)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = wbText(16.sp, 600, Color.White), maxLines = 1)
    }
}

/** 顶栏小按钮（完成 / 发送，3.17）：最小 56×36，圆角 6，brand 底白字；禁用 #E1E1E1 / #BBBBBB。 */
@Composable fun SmallBrandButton(
    text: String,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    Box(
        modifier
            .defaultMinSize(56.dp, 36.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (enabled) colors.brandPrimary else mode.uiButtonDisabledBg)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = wbText(16.sp, 500, if (enabled) Color.White else mode.uiButtonDisabledText), maxLines = 1)
    }
}

/** 行内小按钮（添加 / 等待，3.17）：圆角 4，brand 底；等待中 #FF8800；禁用 #E0E0E0。 */
@Composable fun InlineButton(
    text: String,
    enabled: Boolean = true,
    waiting: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val bg =
        when {
            waiting -> Color(0xFFFF8800)
            enabled -> colors.brandPrimary
            else -> Color(0xFFE0E0E0)
        }
    Box(
        Modifier
            .defaultMinSize(52.dp, 30.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(bg)
            .clickable(enabled = enabled && !waiting, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = wbText(14.sp, 500, Color.White), maxLines = 1)
    }
}

/** 数字角标（3.13）：最小 18，圆角 9，danger 底，1.5 白描边，字 11 白；> 99 显示 99+。 */
@Composable fun CountBadge(
    count: Int,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    stroke: Color = Color.White,
) {
    val mode = LocalWeibanModeColors.current
    val min = if (small) 17.dp else 18.dp
    Box(
        modifier
            .defaultMinSize(min, min)
            .border(if (small) 1.dp else 1.5.dp, stroke, CircleShape)
            .padding(if (small) 1.dp else 1.5.dp)
            .background(mode.badgeUnread, CircleShape)
            .padding(horizontal = if (small) 3.dp else 3.5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            style = wbText(if (small) 10.sp else 11.sp, 400, Color.White, 1f),
            maxLines = 1,
            overflow = TextOverflow.Clip,
        )
    }
}

/** 红点（静音会话 10，标签栏 / 菜单 8）。 */
@Composable fun DotBadge(
    size: Dp = 10.dp,
    stroke: Color? = Color.White,
    modifier: Modifier = Modifier,
) {
    val mode = LocalWeibanModeColors.current
    Box(
        modifier
            .size(size)
            .then(if (stroke != null) Modifier.border(1.5.dp, stroke, CircleShape) else Modifier)
            .padding(if (stroke != null) 1.5.dp else 0.dp)
            .background(mode.badgeUnread, CircleShape),
    )
}

/** 「@我」式小标签（3.13）：内距 4×1，圆角 3，11 字。 */
@Composable fun SmallTag(
    text: String,
    background: Color = LocalWeibanModeColors.current.uiMentionBg,
    color: Color = LocalWeibanModeColors.current.uiMentionText,
) {
    Text(
        text,
        Modifier.background(background, RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 1.dp),
        style = wbText(11.sp, 400, color),
        maxLines = 1,
    )
}

/** 小程序图标（5.1）：点缀色方块 + 白色线框图标；48 圆角 12，40 圆角 10。 */
@Composable fun MiniAppIcon(
    icon: Int,
    background: Color,
    size: Dp = 48.dp,
    original: Boolean = false,
) {
    val radius = if (size >= 48.dp) 12.dp else if (size >= 40.dp) 10.dp else 6.dp
    if (original) {
        WbIcon(icon, size, null, Modifier.clip(RoundedCornerShape(radius)))
        return
    }
    Box(Modifier.size(size).clip(RoundedCornerShape(radius)).background(background), contentAlignment = Alignment.Center) {
        WbIcon(icon, size * 0.54f, Color.White)
    }
}
