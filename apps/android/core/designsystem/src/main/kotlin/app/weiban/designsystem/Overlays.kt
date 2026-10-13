package app.weiban.designsystem

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import app.weiban.core.designsystem.R
import app.weiban.designsystem.tokens.WbMotion
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/*
 * 旧版浮层（规格 3.7–3.11）：轻提示、确认框、底部操作列表、浅色长按菜单、⊕ 深色菜单、底部弹层。
 * 动画只用 transform / opacity。
 */

enum class ToastKind { None, Success, Warning, Error, Info }

data class ToastMessage(
    val text: String,
    val kind: ToastKind,
    val nonce: Long,
)

/** 轻提示（3.11）：屏幕正中，停留 2 秒。任何地方都可以调用，由根布局的 ToastHost 显示。 */
object WbToast {
    val current = MutableStateFlow<ToastMessage?>(null)
    private var counter = 0L

    fun show(
        text: String,
        kind: ToastKind = ToastKind.None,
    ) {
        counter += 1
        current.value = ToastMessage(text, kind, counter)
    }
}

/** 放在根布局最上层。 */
@Composable fun ToastHost() {
    val message by WbToast.current.collectAsState()
    val shown = message ?: return
    val scale = remember(shown.nonce) { Animatable(0.92f) }
    val alpha = remember(shown.nonce) { Animatable(0f) }
    LaunchedEffect(shown.nonce) {
        launch { scale.animateTo(1f, tween(WbMotion.FastMs, easing = WbMotion.Standard)) }
        alpha.animateTo(1f, tween(WbMotion.FastMs))
        delay(TOAST_MS)
        alpha.animateTo(0f, tween(WbMotion.FastMs))
        if (WbToast.current.value?.nonce == shown.nonce) WbToast.current.value = null
    }
    val short = shown.text.length <= 8 && shown.kind != ToastKind.None
    val maxWidth = (LocalConfiguration.current.screenWidthDp * 0.82f).coerceAtMost(360f).dp
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                    this.alpha = alpha.value
                }.widthIn(min = if (short) 108.dp else 120.dp, max = maxWidth)
                .defaultMinSize(minHeight = if (short) 96.dp else 0.dp)
                .shadow(12.dp, RoundedCornerShape(14.dp))
                .background(LocalWeibanModeColors.current.uiToastBg, RoundedCornerShape(14.dp))
                .padding(horizontal = if (short) 18.dp else 20.dp, vertical = if (short) 16.dp else 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            if (shown.kind != ToastKind.None) {
                ToastGlyph(shown.kind, if (short) 32 else 30)
                Spacer(Modifier.height(if (short) 10.dp else 9.dp))
            }
            Text(shown.text, style = wbText(15.sp, 500, Color.White, 1.36f), textAlign = TextAlign.Center)
        }
    }
}

private const val TOAST_MS = 2_000L

@Composable private fun ToastGlyph(
    kind: ToastKind,
    size: Int,
) {
    if (kind == ToastKind.Success) {
        WbIcon(R.drawable.wb_check, size.dp, Color.White)
        return
    }
    val glyph =
        when (kind) {
            ToastKind.Warning -> "!"
            ToastKind.Error -> "✕"
            else -> "i"
        }
    Box(Modifier.size(size.dp).border(2.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
        Text(glyph, style = wbText((size * 0.5f).sp, 600, Color.White, 1f))
    }
}

/**
 * 确认框（3.9）：白底圆角 12，左右离屏 40；无标题时正文 17 居中；有标题时标题 17/600 + 正文 15 次要色；
 * 底部两个等宽按钮 52 高（cancel = null 时只有一个按钮）。
 */
@Composable fun WbConfirm(
    text: String,
    confirm: String = "确定",
    title: String? = null,
    danger: Boolean = false,
    cancel: String? = "取消",
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val mode = LocalWeibanModeColors.current
    val colors = LocalWeibanColors.current
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(horizontal = 40.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(mode.uiPopupBg),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = if (title != null) 22.dp else 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (title != null) {
                    Text(title, style = wbText(17.sp, 600, mode.uiPopupText), textAlign = TextAlign.Center)
                    Spacer(Modifier.height(10.dp))
                    Text(text, style = wbText(15.sp, 400, colors.textSecondary, 1.45f), textAlign = TextAlign.Center)
                } else {
                    Text(text, style = wbText(17.sp, 400, mode.uiPopupText, 1.4f), textAlign = TextAlign.Center)
                }
            }
            Box(Modifier.fillMaxWidth().height(0.5.dp).background(mode.uiPopupLine))
            Row(Modifier.fillMaxWidth().height(52.dp)) {
                if (cancel != null) {
                    Box(Modifier.weight(1f).fillMaxHeight().clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                        Text(cancel, style = wbText(17.sp, 400, mode.uiPopupText))
                    }
                    Box(Modifier.width(0.5.dp).fillMaxHeight().background(mode.uiPopupLine))
                }
                Box(Modifier.weight(1f).fillMaxHeight().clickable(onClick = onConfirm), contentAlignment = Alignment.Center) {
                    Text(confirm, style = wbText(17.sp, 500, if (danger) colors.textDanger else colors.textLink))
                }
            }
        }
    }
}

/** 操作列表的一项。 */
data class SheetAction(
    val label: String,
    val danger: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * 底部操作列表（3.10）：左右下留 10，选项组白底圆角 12，每项 56，文字 17 居中；与「取消」之间 8 透明空隙。
 * title 显示在选项组顶部（13 次要色）。
 */
@Composable fun ActionSheet(
    actions: List<SheetAction>,
    title: String? = null,
    onDismiss: () -> Unit,
) {
    val mode = LocalWeibanModeColors.current
    val colors = LocalWeibanColors.current
    val rise = remember { Animatable(1f) }
    LaunchedEffect(Unit) { rise.animateTo(0f, tween(WbMotion.BaseMs, easing = WbMotion.Standard)) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().clickable(indication = null, interactionSource = null, onClick = onDismiss)) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .graphicsLayer { translationY = size.height * rise.value }
                    .navigationBarsPadding()
                    .padding(start = 10.dp, end = 10.dp, bottom = 10.dp)
                    .fillMaxWidth(),
            ) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(mode.uiPopupBg)) {
                    title?.let {
                        Text(
                            it,
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                            style = wbText(13.sp, 400, colors.textSecondary, 1.4f),
                            textAlign = TextAlign.Center,
                        )
                        Box(Modifier.fillMaxWidth().height(0.5.dp).background(mode.uiPopupLine))
                    }
                    actions.forEachIndexed { index, action ->
                        if (index > 0) Box(Modifier.fillMaxWidth().height(0.5.dp).background(mode.uiPopupLine))
                        Box(
                            Modifier.fillMaxWidth().height(56.dp).clickable {
                                onDismiss()
                                action.onClick()
                            },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(action.label, style = wbText(17.sp, 400, if (action.danger) colors.textDanger else mode.uiPopupText))
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(12.dp)).background(mode.uiPopupBg).clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("取消", style = wbText(17.sp, 400, mode.uiPopupText))
                }
            }
        }
    }
}

/** 菜单项。 */
data class MenuItem(
    val label: String,
    val danger: Boolean = false,
    val icon: Int? = null,
    val onClick: () -> Unit,
)

/**
 * 浅色长按菜单（3.7）：在手指位置弹出，宽 168，每项 52，文字 16 左对齐；离屏幕边缘至少 12；不压暗背景。
 * at = 手指在窗口里的位置（Modifier.pressMenu 给出）。
 */
@Composable fun LongPressMenu(
    at: Offset,
    items: List<MenuItem>,
    onDismiss: () -> Unit,
) {
    val mode = LocalWeibanModeColors.current
    val colors = LocalWeibanColors.current
    val margin = with(LocalDensity.current) { 12.dp.roundToPx() }
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) { alpha.animateTo(1f, tween(WbMotion.MenuMs)) }
    val provider =
        remember(at, margin) {
            object : PopupPositionProvider {
                override fun calculatePosition(
                    anchorBounds: IntRect,
                    windowSize: IntSize,
                    layoutDirection: LayoutDirection,
                    popupContentSize: IntSize,
                ): IntOffset {
                    val x = at.x.toInt().coerceIn(margin, (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin))
                    val below = at.y.toInt()
                    val y =
                        if (below + popupContentSize.height > windowSize.height - margin * 4) {
                            (below - popupContentSize.height).coerceAtLeast(margin * 4)
                        } else {
                            below
                        }
                    return IntOffset(x, y)
                }
            }
        }
    Popup(popupPositionProvider = provider, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier
                .alpha(alpha.value)
                .width(168.dp)
                .shadow(8.dp, RoundedCornerShape(8.dp))
                .background(mode.uiPopupBg, RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp)),
        ) {
            items.forEach { item ->
                Box(
                    Modifier.fillMaxWidth().height(52.dp).pressable {
                        onDismiss()
                        item.onClick()
                    }.padding(horizontal = 18.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(
                        item.label,
                        style = wbText(16.sp, 400, if (item.danger) colors.textDanger else mode.uiPopupText),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/**
 * ⊕ 深色菜单（4.2）：深灰 #4C4C4C、圆角 8，每项宽 168、高 46：左 15 + 白色图标 19 + 12 + 白字 15.5；项间 0.5 线。
 * 放在按钮所在的 Box 里。
 */
@Composable fun DarkMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    items: List<MenuItem>,
) {
    val mode = LocalWeibanModeColors.current
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        offset = DpOffset((-6).dp, 0.dp),
        shape = RoundedCornerShape(8.dp),
        containerColor = if (dark) Color(0xFF2C2C2E) else mode.overlayMenu,
        tonalElevation = 0.dp,
        shadowElevation = 6.dp,
    ) {
        items.forEachIndexed { index, item ->
            if (index > 0) Box(Modifier.width(168.dp).height(0.5.dp).background(Color(0x1AFFFFFF)))
            Row(
                Modifier
                    .width(168.dp)
                    .height(46.dp)
                    .clickable {
                        onDismiss()
                        item.onClick()
                    }.padding(start = 15.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                item.icon?.let {
                    WbIcon(it, 19.dp, Color.White)
                    Spacer(Modifier.width(12.dp))
                }
                Text(item.label, style = wbText(15.5.sp, 400, Color.White), maxLines = 1)
            }
        }
    }
}

/** 旧接口：名字 to 点击 → 深色菜单。 */
@Composable fun PopMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    items: List<Pair<String, () -> Unit>>,
) {
    DarkMenu(expanded, onDismiss, items.map { (label, action) -> MenuItem(label, onClick = action) })
}

/**
 * 底部弹层（第 5 节表）：白底、顶部圆角 12、无把手；标题栏高 56：中间标题 17/500；
 * action 不为空时左「取消」右操作，否则右侧 close.svg。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WbSheet(
    title: String?,
    onDismiss: () -> Unit,
    action: Pair<String, () -> Unit>? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalWeibanColors.current
    BackHandler(onBack = onDismiss)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = colors.bgPage,
        dragHandle = null,
        shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp),
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 16.dp)) {
            if (title != null) {
                Box(Modifier.fillMaxWidth().height(56.dp).background(colors.bgSurface)) {
                    Text(title, Modifier.align(Alignment.Center), style = wbText(17.sp, 500, colors.textPrimary))
                    if (action != null) {
                        Text(
                            "取消",
                            Modifier.align(Alignment.CenterStart).clickable(onClick = onDismiss).padding(16.dp),
                            style = wbText(16.sp, 400, colors.textPrimary),
                        )
                        Text(
                            action.first,
                            Modifier.align(Alignment.CenterEnd).clickable(onClick = action.second).padding(16.dp),
                            style = wbText(16.sp, 500, colors.brandPrimary),
                        )
                    } else {
                        Box(Modifier.align(Alignment.CenterEnd).padding(end = 6.dp)) {
                            NavIcon(R.drawable.wb_close, "关闭", size = 22.dp, onClick = onDismiss)
                        }
                    }
                }
            }
            content()
        }
    }
}
