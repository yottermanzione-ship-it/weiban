package app.weiban.designsystem

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import app.weiban.core.designsystem.R

/*
 * 旧版通用部件（docs/refactor/06-old-ui-spec.md 第 3 节；网页 features/shell-kit.tsx 为参照）：
 * 顶栏、菜单分组与菜单行、图标方块、开关行、二级页骨架、沉浸式状态栏。
 */

/** 页面自己画到状态栏下（「我」页头卡、朋友圈封面、通话页）；根布局据此不再留出状态栏。 */
val LocalImmersive = staticCompositionLocalOf<MutableState<Int>> { mutableIntStateOf(0) }

/** 声明本页沉浸到状态栏；lightIcons = 状态栏用白色图标（深色背景时）。 */
@Composable fun ImmersiveStatusBar(lightIcons: Boolean = false) {
    val counter = LocalImmersive.current
    val view = LocalView.current
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    DisposableEffect(counter, lightIcons) {
        counter.value += 1
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        if (lightIcons) controller?.isAppearanceLightStatusBars = false
        onDispose {
            counter.value -= 1
            if (lightIcons) controller?.isAppearanceLightStatusBars = !dark
        }
    }
}

/**
 * 顶栏（3.1）：高 56，日间页面灰 / 夜间 #202020，标题 17/500 居中，左返回箭头（裁掉留白后的 9.4×17.7，左距 17.4），
 * 右侧图标按钮。subtitle 显示在标题下方（聊天页情景预设）；leading 替换返回键（聊天页未读药丸、多选「取消」）。
 */
@Composable fun WbNavBar(
    title: String,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    onSubtitle: (() -> Unit)? = null,
    background: Color? = null,
    contentColor: Color? = null,
    leading: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = LocalWeibanColors.current
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val tint = contentColor ?: colors.textPrimary
    Box(Modifier.fillMaxWidth().height(56.dp).background(background ?: colors.bgNavBar)) {
        Column(
            Modifier.align(Alignment.Center).padding(horizontal = 96.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                title,
                style = wbText(17.sp, if (dark) 600 else 500, tint),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            subtitle?.let {
                Text(
                    it,
                    Modifier.then(if (onSubtitle != null) Modifier.clickable(onClick = onSubtitle) else Modifier),
                    style = wbText(12.sp, color = colors.textSecondary),
                    maxLines = 1,
                )
            }
        }
        Row(Modifier.align(Alignment.CenterStart).fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
            when {
                leading != null -> leading()
                onBack != null -> BackArrow(onBack, tint)
            }
        }
        Row(
            Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = actions,
        )
    }
}

/** 返回箭头按钮：可见箭头 9.4×17.7，左距 17.4。 */
@Composable fun BackArrow(
    onBack: () -> Unit,
    tint: Color = LocalWeibanColors.current.textPrimary,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier.fillMaxHeight().clickable(indication = null, interactionSource = null, onClick = onBack).padding(start = 17.4.dp, end = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(R.drawable.wb_back_crop),
            "返回",
            Modifier.size(9.4.dp, 17.7.dp),
            tint = tint,
        )
    }
}

/** 顶栏右侧图标按钮：图标 26，按钮最小 40×48。 */
@Composable fun NavIcon(
    res: Int,
    contentDescription: String,
    tint: Color = LocalWeibanColors.current.textPrimary,
    size: Dp = 26.dp,
    onClick: () -> Unit,
) {
    Box(
        Modifier.size(42.dp, 48.dp).clickable(indication = null, interactionSource = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        WbIcon(res, size, tint, contentDescription = contentDescription)
    }
}

/** 标题栏右侧操作：常见符号换成旧版图标；文字按钮 16 brand（如「保存」）。 */
@Composable fun NavAction(
    text: String,
    onClick: () -> Unit,
) {
    when (text) {
        "⊕", "＋", "+" -> NavIcon(R.drawable.wb_add_circle, "更多", onClick = onClick)
        "⋯", "···", "…" -> NavIcon(R.drawable.wb_more, "更多", size = 24.dp, onClick = onClick)
        "⌕" -> NavIcon(R.drawable.wb_search, "搜索", onClick = onClick)
        "✕" -> NavIcon(R.drawable.wb_close, "关闭", size = 22.dp, onClick = onClick)
        else ->
            Text(
                text,
                Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp),
                style = wbText(16.sp, 400, LocalWeibanColors.current.brandPrimary),
            )
    }
}

/**
 * 彩色方块 + 白色图标（旧版「彩底白图」）：24 圆角 6（菜单行）；40 圆角 4（通讯录固定行）；48 圆角 12（小程序）。
 * glyph 是原来的文字符号，能对上旧版素材的换成素材，否则仍画文字。
 */
@Composable fun IconTile(
    glyph: String,
    tint: Tint,
    size: Dp = 24.dp,
    icon: Int? = null,
) {
    val radius =
        when {
            size >= 48.dp -> 12.dp
            size >= 40.dp -> 4.dp
            else -> 6.dp
        }
    Box(
        Modifier.size(size).clip(RoundedCornerShape(radius)).background(tintColor(tint)),
        contentAlignment = Alignment.Center,
    ) {
        val res = icon ?: glyphIcon(glyph)
        if (res != null) {
            WbIcon(res, size * if (size >= 40.dp) 0.55f else 0.7f, Color.White)
        } else {
            Text(glyph, style = wbText((size.value * 0.55f).sp, 500, Color.White, 1f))
        }
    }
}

/** 菜单分组（3.4）：组前 8 灰缝或分组标题（3.5）；组内白底通栏，最后一行不画分割线。 */
@Composable fun MenuGroup(
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalWeibanColors.current
    if (title != null) GroupHeader(title) else Spacer(Modifier.height(8.dp))
    val line = hairline
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.bgSurface)
            .drawWithContent {
                drawContent()
                // 盖住最后一行的分割线（组与组之间只靠灰缝分隔）。
                drawRect(colors.bgSurface, Offset(0f, size.height - line.toPx()), Size(size.width, line.toPx()))
            },
        content = content,
    )
}

/**
 * 菜单行（3.3）：高 56（有副标题 72），左右 16；左图标槽 24（glyph = 彩底白图；icon = 透明底彩色线图），
 * 与标题间距 16；标题 17；右侧值 14 次要色；行尾 chevron_right 18。分割线缩进：有图标 56，无图标 16。
 */
@Composable fun MenuRow(
    label: String,
    glyph: String? = null,
    tint: Tint = Tint.Gray,
    value: String? = null,
    dot: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
    subtitle: String? = null,
    icon: Int? = null,
    iconTint: Color? = null,
    iconSize: Dp = 22.dp,
    badge: Int = 0,
    leading: (@Composable () -> Unit)? = null,
    dividerStart: Dp? = null,
    onClick: (() -> Unit)? = null,
) {
    val colors = LocalWeibanColors.current
    val hasIcon = glyph != null || icon != null || leading != null
    val centered = danger && !hasIcon && value == null && trailing == null
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = if (subtitle != null) 72.dp else 56.dp)
            .then(if (onClick != null) Modifier.pressable(enabled, onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            leading != null -> leading()
            glyph != null -> IconTile(glyph, tint, icon = icon)
            icon != null -> Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { WbIcon(icon, iconSize, iconTint) }
        }
        if (hasIcon) Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    label,
                    Modifier.weight(1f, fill = centered),
                    color =
                        when {
                            danger -> colors.textDanger
                            !enabled -> colors.textPlaceholder
                            else -> colors.textPrimary
                        },
                    textAlign = if (centered) TextAlign.Center else TextAlign.Start,
                    style = wbText(17.sp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (badge > 0) {
                    Spacer(Modifier.width(8.dp))
                    CountBadge(badge, stroke = Color.Transparent)
                }
            }
            subtitle?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, style = wbText(14.sp, color = colors.textSecondary), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        value?.let {
            Spacer(Modifier.width(8.dp))
            Text(
                it,
                Modifier.widthIn(max = 180.dp),
                style = wbText(14.sp, color = colors.textSecondary),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (dot) {
            Spacer(Modifier.width(8.dp))
            DotBadge(8.dp, null)
        }
        trailing?.let {
            Spacer(Modifier.width(8.dp))
            it()
        }
        if (onClick != null && trailing == null && !centered) {
            Spacer(Modifier.width(6.dp))
            WbIcon(R.drawable.wb_chevron_right, 18.dp, LocalWeibanModeColors.current.uiChevron)
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = dividerStart ?: if (hasIcon) 56.dp else 16.dp)
            .height(hairline)
            .background(colors.borderHairline),
    )
}

/** 开关行（3.6）：标题 16，副标题 13 次要色；iOS 式胶囊开关。 */
@Composable fun MenuSwitchRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    subtitle: String? = null,
    onChange: (Boolean) -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = if (subtitle != null) 10.dp else 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = wbText(16.sp, color = if (enabled) colors.textPrimary else colors.textPlaceholder))
            subtitle?.let {
                Spacer(Modifier.height(2.dp))
                Text(it, style = wbText(13.sp, color = colors.textSecondary, lineHeight = 1.25f))
            }
        }
        Spacer(Modifier.width(12.dp))
        WbSwitch(checked, onChange, enabled)
    }
    Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(hairline).background(colors.borderHairline))
}

/** 未读红点。 */
@Composable fun RedDotMark() {
    DotBadge(8.dp, null)
}

/** 带标题栏、可滚动的二级页骨架（系统返回 = onBack）。 */
@Composable fun ShellPage(
    title: String,
    onBack: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(LocalWeibanColors.current.bgPage)) {
        WbNavBar(title, onBack, actions = actions)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp), content = content)
    }
}
