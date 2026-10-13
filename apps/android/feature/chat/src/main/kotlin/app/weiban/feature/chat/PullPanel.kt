package app.weiban.feature.chat

import android.app.ActivityManager
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.ImmersiveStatusBar
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.wbText
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** 面板是否打开（打开时底部标签栏收起，规格 4.3 打开动画第 3 步）。 */
object PullPanelState {
    var open by mutableStateOf(false)
}

private val PULL_DOTS = 24.dp
private val PULL_THRESHOLD = 80.dp
private val PEEK = 64.dp
private val CLOSE_SWIPE = 60.dp
private const val PULL_DAMPING = 0.5f
private const val SNAP_BACK_MS = 200
private const val OPEN_MS = 300
private const val OPEN_MS_LOW_RAM = 200
private const val CONTENT_MS = 250
private const val CONTENT_DELAY_MS = 50L

/**
 * 会话列表下拉小程序面板（规格 4.3，按微信）：列表在顶端继续下拉时，顶栏以下整块跟手（阻尼 0.5）；
 * ≥24 出现三个小圆点并逐渐张开，≥80 变实心并轻震；松手不到 80 在 200ms 内弹回，到 80 打开：
 * 整块（连顶栏）下移到只露出底部 64 高的「微伴」条，面板内容淡入下落，标签栏收起。只改 transform / opacity。
 */
@Composable internal fun PullToMiniApps(
    repository: SessionRepository,
    owner: OwnerRecord,
    title: String,
    header: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val view = LocalView.current
    val context = LocalContext.current
    val lowRam = remember { context.getSystemService(ActivityManager::class.java)?.isLowRamDevice == true }
    val threshold = with(density) { PULL_THRESHOLD.toPx() }
    val dotsAt = with(density) { PULL_DOTS.toPx() }
    val peek = with(density) { PEEK.toPx() }
    val pull = remember { Animatable(0f) }
    val sheet = remember { Animatable(0f) }
    val panelAlpha = remember { Animatable(0f) }
    var height by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf(false) }
    var ticked by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { PullPanelState.open = false } }
    val openPanel: () -> Unit = {
        open = true
        PullPanelState.open = true
        scope.launch {
            val duration = if (lowRam) OPEN_MS_LOW_RAM else OPEN_MS
            launch { pull.animateTo(0f, tween(duration, easing = WbMotion.Standard)) }
            launch {
                delay(CONTENT_DELAY_MS)
                panelAlpha.animateTo(1f, tween(CONTENT_MS, easing = WbMotion.Standard))
            }
            sheet.animateTo((height - peek).coerceAtLeast(0f), tween(duration, easing = WbMotion.Standard))
        }
    }
    val closePanel: () -> Unit = {
        scope.launch {
            launch { panelAlpha.animateTo(0f, tween(WbMotion.BaseMs)) }
            sheet.animateTo(0f, tween(WbMotion.BaseMs, easing = WbMotion.Standard))
            open = false
            PullPanelState.open = false
        }
    }
    val connection =
        remember(threshold) {
            object : NestedScrollConnection {
                override fun onPreScroll(
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    // 已经下移时，往上推先把列表收回。
                    if (available.y < 0 && pull.value > 0f) {
                        val next = (pull.value + available.y).coerceAtLeast(0f)
                        val used = next - pull.value
                        scope.launch { pull.snapTo(next) }
                        return Offset(0f, used)
                    }
                    return Offset.Zero
                }

                override fun onPostScroll(
                    consumed: Offset,
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    if (available.y > 0 && source == NestedScrollSource.UserInput && !open) {
                        val next = pull.value + available.y * PULL_DAMPING
                        if (next >= threshold && !ticked) {
                            ticked = true
                            view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        }
                        scope.launch { pull.snapTo(next) }
                        return Offset(0f, available.y)
                    }
                    return Offset.Zero
                }

                override suspend fun onPreFling(available: Velocity): Velocity {
                    if (pull.value <= 0f) return Velocity.Zero
                    ticked = false
                    if (pull.value >= threshold) {
                        openPanel()
                    } else {
                        pull.animateTo(0f, tween(SNAP_BACK_MS, easing = WbMotion.Standard))
                    }
                    return available
                }
            }
        }
    if (open) {
        ImmersiveStatusBar(lightIcons = true)
        BackHandler(onBack = closePanel)
    }
    Box(Modifier.fillMaxSize().onSizeChanged { height = it.height }) {
        if (open) MiniAppPanel(repository, owner, panelAlpha.value, closePanel)
        Column(
            Modifier
                .fillMaxSize()
                .graphicsLayer { translationY = sheet.value }
                .then(if (open) Modifier.clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)) else Modifier),
        ) {
            if (open) {
                PeekBar(title, closePanel)
            } else {
                header()
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                PullDots(pull.value, dotsAt, threshold)
                CompositionLocalProvider(LocalOverscrollFactory provides null) {
                    Box(Modifier.fillMaxSize().nestedScroll(connection).graphicsLayer { translationY = pull.value }) { content() }
                }
            }
        }
    }
}

/** 提示点：直径 6，间距从 0 张开到 12，透明度 0→1；到阈值变实心 text.secondary。 */
@Composable private fun BoxScope.PullDots(
    offset: Float,
    dotsAt: Float,
    threshold: Float,
) {
    if (offset < dotsAt) return
    val colors = LocalWeibanColors.current
    val progress = ((offset - dotsAt) / (threshold - dotsAt)).coerceIn(0f, 1f)
    val reached = offset >= threshold
    val density = LocalDensity.current
    val centerY = with(density) { (offset / 2).toDp() - 3.dp }
    Row(
        Modifier.align(Alignment.TopCenter).padding(top = centerY.coerceAtLeast(0.dp)).graphicsLayer { alpha = progress },
        horizontalArrangement = Arrangement.spacedBy((12 * progress).dp),
    ) {
        repeat(3) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(if (reached) colors.textSecondary else colors.textPlaceholder))
        }
    }
}

/** 底部露出条：高 64，白底，顶部圆角 12，中间「微伴(N)」；点一下或上滑收起。 */
@Composable private fun PeekBar(
    title: String,
    onClose: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Box(
        Modifier
            .fillMaxWidth()
            .height(PEEK)
            .background(colors.bgSurface)
            .clickableNoRipple(onClose)
            .pointerInput(Unit) { detectVerticalDragGestures { _, drag -> if (drag < -8f) onClose() } },
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = wbText(17.sp, 500, colors.textPrimary))
    }
}

/**
 * 面板（规格 4.3）：全屏深灰 #2C2C2E（不分日夜、不做模糊）；状态栏高 + 16 处标题「小程序」；
 * 搜索条、最近使用、我的小程序；内容区在顶部时继续上滑超过 60 收起。
 */
@Composable private fun MiniAppPanel(
    repository: SessionRepository,
    owner: OwnerRecord,
    alpha: Float,
    onClose: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val closeAt = with(LocalDensity.current) { CLOSE_SWIPE.toPx() }
    var swipe by remember { mutableFloatStateOf(0f) }
    val close by rememberUpdatedState(onClose)
    val connection =
        remember(closeAt) {
            object : NestedScrollConnection {
                override fun onPostScroll(
                    consumed: Offset,
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    if (available.y < 0 && source == NestedScrollSource.UserInput) {
                        swipe -= available.y
                        if (swipe > closeAt) {
                            swipe = 0f
                            close()
                        }
                    } else if (available.y > 0) {
                        swipe = 0f
                    }
                    return Offset.Zero
                }

                override suspend fun onPreFling(available: Velocity): Velocity {
                    swipe = 0f
                    return Velocity.Zero
                }
            }
        }
    Column(
        Modifier
            .fillMaxSize()
            .background(LocalWeibanModeColors.current.uiPullPanelBg)
            .statusBarsPadding()
            .padding(bottom = PEEK)
            .graphicsLayer {
                this.alpha = alpha
                translationY = (1f - alpha) * -24.dp.toPx()
            },
    ) {
        Text(
            "小程序",
            Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 12.dp),
            style = wbText(17.sp, 500, Color(0xE6FFFFFF)),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        CompositionLocalProvider(LocalOverscrollFactory provides null) {
            MiniAppBrowser(repository, owner, query, { query = it }, dark = true, modifier = Modifier.nestedScroll(connection)) { app ->
                onClose()
                MiniAppNavigation.open(app.id)
            }
        }
    }
}
