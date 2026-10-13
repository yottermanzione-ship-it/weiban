package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch

private val PULL_THRESHOLD = 80.dp
private const val PULL_DAMPING = 0.5f

/**
 * 会话列表下拉小程序面板（方案 4.3，P2）：列表在最顶端继续下拉，列表跟手下移（只改 transform，带阻尼）；
 * 超过约 80dp 松手 → 面板铺满（同一个小程序浏览部件），底部露出「微伴」一条；点那一条、上滑或返回收起。
 */
@Composable internal fun PullToMiniApps(
    repository: SessionRepository,
    owner: OwnerRecord,
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val threshold = with(LocalDensity.current) { PULL_THRESHOLD.toPx() }
    val offset = remember { Animatable(0f) }
    var open by remember { mutableStateOf(false) }
    val connection =
        remember(threshold) {
            object : NestedScrollConnection {
                override fun onPreScroll(
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    // 已经下移时，往上推先把列表收回。
                    if (available.y < 0 && offset.value > 0f) {
                        val next = (offset.value + available.y).coerceAtLeast(0f)
                        val used = next - offset.value
                        scope.launch { offset.snapTo(next) }
                        return Offset(0f, used)
                    }
                    return Offset.Zero
                }

                override fun onPostScroll(
                    consumed: Offset,
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    if (available.y > 0 && source == NestedScrollSource.UserInput) {
                        scope.launch { offset.snapTo(offset.value + available.y * PULL_DAMPING) }
                        return Offset(0f, available.y)
                    }
                    return Offset.Zero
                }

                override suspend fun onPreFling(available: Velocity): Velocity {
                    if (offset.value <= 0f) return Velocity.Zero
                    if (offset.value >= threshold) open = true
                    offset.animateTo(0f, tween(WbMotion.BaseMs, easing = WbMotion.Standard))
                    return available
                }
            }
        }
    Box(Modifier.fillMaxSize().nestedScroll(connection)) {
        if (offset.value > 0f) {
            Text(
                if (offset.value >= threshold) "松开打开小程序" else "下拉打开小程序",
                Modifier.align(Alignment.TopCenter).padding(top = WbSpace.S3),
                color = LocalWeibanColors.current.textTertiary,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Box(Modifier.fillMaxSize().graphicsLayer { translationY = offset.value }) { content() }
    }
    if (open) MiniAppPanel(repository, owner) { open = false }
}

/** 下拉面板：铺满，底部露出「微伴」一条（高 64）；点那一条、上滑或返回收起。不做模糊背景。 */
@Composable private fun MiniAppPanel(
    repository: SessionRepository,
    owner: OwnerRecord,
    onClose: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = onClose)
        val colors = LocalWeibanColors.current
        Column(
            Modifier
                .fillMaxSize()
                .background(colors.bgPage)
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            Text("小程序", Modifier.fillMaxWidth().padding(WbSpace.S5), style = MaterialTheme.typography.titleMedium)
            Box(Modifier.weight(1f)) {
                MiniAppBrowser(repository, owner, query, { query = it }) { app ->
                    onClose()
                    MiniAppNavigation.open(app.id)
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .background(colors.bgSurface)
                    .clickable(onClick = onClose)
                    .pointerInput(Unit) { detectVerticalDragGestures { _, drag -> if (drag < -8f) onClose() } },
                contentAlignment = Alignment.Center,
            ) {
                Text("微伴", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
