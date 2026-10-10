package app.weiban.feature.chat

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.delay

private val CALL_BUTTON = 64.dp

/** 麦克风权限：有权限直接执行；没有先申请，拒绝后弹说明 +「去设置」（design/pages/call.md 第 3 节）。 */
internal class MicrophoneGate(
    val request: (() -> Unit) -> Unit,
)

@Composable internal fun rememberMicrophoneGate(onDenied: () -> Unit = {}): MicrophoneGate {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    var explaining by remember { mutableStateOf(false) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val action = pending
            pending = null
            if (granted) {
                action?.invoke()
            } else {
                explaining = true
                onDenied()
            }
        }
    if (explaining) {
        AlertDialog(
            onDismissRequest = { explaining = false },
            title = { Text("需要麦克风权限才能通话") },
            text = { Text("请在系统设置中允许微伴使用麦克风") },
            confirmButton = {
                TextButton(onClick = {
                    explaining = false
                    openAppSettings(context)
                }) { Text("去设置") }
            },
            dismissButton = { TextButton(onClick = { explaining = false }) { Text("取消") } },
        )
    }
    return remember(launcher) {
        MicrophoneGate { action ->
            if (hasMicrophone(context)) {
                action()
            } else {
                pending = action
                launcher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
}

/** 入口是否显示（MED-06 第 11 条）：平台未开通语音服务、查询失败时不显示。 */
@Composable internal fun rememberCallEntry(characterId: String?): Boolean {
    val calls = LocalCalls.current ?: return false
    var visible by remember(characterId) { mutableStateOf(false) }
    LaunchedEffect(calls, characterId) {
        if (characterId == null) return@LaunchedEffect
        val availability = calls.availability(characterId)
        visible = availability != null && availability.reason != "service_disabled"
    }
    return visible
}

/** 拨打：先要麦克风权限；余额不足等由 CallController.notices 弹窗。 */
@Composable internal fun rememberDial(): (String, String) -> Unit {
    val calls = LocalCalls.current
    val gate = rememberMicrophoneGate()
    return remember(calls, gate) {
        val dial: (String, String) -> Unit = { characterId, name -> gate.request { calls?.dial(characterId, name) } }
        dial
    }
}

/**
 * 通话页覆盖层（design/pages/call.md）：盖在所有页面上（zIndex.call）；缩小后顶部显示绿色胶囊「通话中 03:12 · 点击返回」。
 * 由宿主放在页面最外层。
 */
@Composable fun CallOverlay(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val calls = LocalCalls.current ?: return
    val view by calls.state.collectAsState()
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(calls) { calls.notices.collect { notice = it } }
    notice?.let { text ->
        AlertDialog(
            onDismissRequest = { notice = null },
            title = { Text(text) },
            confirmButton = { TextButton(onClick = { notice = null }) { Text("知道了") } },
        )
    }
    val current = view ?: return
    if (current.minimized) {
        CallCapsule(current) { calls.minimize(false) }
    } else {
        CallPage(repository, owner, calls, current)
    }
}

@Composable private fun CallCapsule(
    view: CallView,
    onOpen: () -> Unit,
) {
    val modes = LocalWeibanModeColors.current
    val seconds = rememberCallSeconds(view)
    Box(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = WbSpace.S5, vertical = WbSpace.S2)
            .height(28.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(modes.callAccept)
            .clickable(onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        Text("通话中 ${clock(seconds)} · 点击返回", color = modes.callText, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun rememberCallSeconds(view: CallView): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(view.connectedAtMs, view.phase) {
        while (view.connectedAtMs != null && view.phase != CallPhase.Ended) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    return view.connectedAtMs?.let { ((now - it) / 1000).coerceAtLeast(0) } ?: 0L
}

private fun clock(seconds: Long): String = "%02d:%02d".format(seconds / 60, seconds % 60)

@Composable private fun CallPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    calls: CallController,
    view: CallView,
) {
    val modes = LocalWeibanModeColors.current
    val gate = rememberMicrophoneGate { calls.decline() }
    val seconds = rememberCallSeconds(view)
    LaunchedEffect(view.autoAnswer, view.callId) {
        if (view.autoAnswer && view.phase == CallPhase.Incoming) gate.request { calls.answer() }
    }
    // 返回键：通话中缩小；来电 / 拨出中不响应（避免误操作）。
    BackHandler { if (view.phase == CallPhase.Active || view.phase == CallPhase.Reconnecting) calls.minimize(true) }
    val profiles = characterProfiles(repository, listOf(view.characterId))
    val status =
        when (view.phase) {
            CallPhase.Dialing, CallPhase.Connecting -> if (view.direction == "incoming") "正在接通…" else "正在呼叫…"
            CallPhase.Incoming -> "邀请你语音通话"
            CallPhase.Active -> clock(seconds)
            CallPhase.Reconnecting -> "网络不佳，正在重连…"
            CallPhase.Ended -> view.endText.orEmpty()
        }
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(modes.callBgTop, modes.callBgBottom)))
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } },
    ) {
        Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth()) {
                if (view.phase == CallPhase.Active || view.phase == CallPhase.Reconnecting) {
                    TextButton(onClick = { calls.minimize(true) }) { Text("⌄", color = modes.callText, style = MaterialTheme.typography.titleLarge) }
                }
            }
            Spacer(Modifier.fillMaxHeight(0.14f))
            Box(contentAlignment = Alignment.Center) {
                val ringing = view.phase == CallPhase.Dialing || view.phase == CallPhase.Incoming
                if (ringing) CallRings()
                RoleAvatar(
                    repository,
                    owner,
                    RoleAvatarIdentity(view.characterId, view.name, profiles[view.characterId]?.avatar),
                    WbSize.AvatarXxl,
                )
            }
            Spacer(Modifier.height(WbSpace.S5))
            Text(view.name, color = modes.callText, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(WbSpace.S3))
            Text(
                status,
                color = modes.callTextSecondary,
                style = MaterialTheme.typography.bodyLarge,
                fontFamily = if (view.phase == CallPhase.Active) FontFamily.Monospace else null,
            )
            if (view.phase == CallPhase.Active && view.agentSpeaking) SpeakingWave()
            Spacer(Modifier.weight(1f))
            CallButtons(calls, view, gate)
            Spacer(Modifier.height(WbSpace.S10))
        }
    }
}

@Composable private fun CallButtons(
    calls: CallController,
    view: CallView,
    gate: MicrophoneGate,
) {
    val modes = LocalWeibanModeColors.current
    when (view.phase) {
        CallPhase.Incoming ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallButton("拒绝", "✕", modes.callDecline) { calls.decline() }
                CallButton("接听", "✆", modes.callAccept) { gate.request { calls.answer() } }
            }
        CallPhase.Dialing, CallPhase.Connecting ->
            CallButton(if (view.direction == "incoming") "挂断" else "取消", "✕", modes.callDecline) { calls.hangUp() }
        CallPhase.Active, CallPhase.Reconnecting ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallButton("静音", "∅", if (view.muted) modes.callControlActive else modes.callControl, active = view.muted) { calls.toggleMute() }
                CallButton("挂断", "✕", modes.callDecline) { calls.hangUp() }
                CallButton("扬声器", "◖))", if (view.speaker) modes.callControlActive else modes.callControl, active = view.speaker) {
                    calls.toggleSpeaker()
                }
            }
        CallPhase.Ended -> Spacer(Modifier.height(CALL_BUTTON))
    }
}

@Composable private fun CallButton(
    label: String,
    glyph: String,
    color: androidx.compose.ui.graphics.Color,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    val modes = LocalWeibanModeColors.current
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(CALL_BUTTON).clip(CircleShape).background(color).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(glyph, color = if (active) modes.callBgBottom else modes.callText, style = MaterialTheme.typography.headlineSmall)
        }
        Spacer(Modifier.height(WbSpace.S2))
        Text(label, color = modes.callTextSecondary, style = MaterialTheme.typography.bodySmall)
    }
}

/** 拨出中 / 来电中头像外 3 圈光圈（motion M-15），接通后停止。 */
@Composable private fun CallRings() {
    val modes = LocalWeibanModeColors.current
    val transition = rememberInfiniteTransition(label = "光圈")
    val progress by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(WbMotion.RingCycleMs)), label = "光圈扩散")
    repeat(3) { index ->
        val phase = (progress + index / 3f) % 1f
        Box(
            Modifier
                .size(WbSize.AvatarXxl)
                .scale(1f + phase * 0.8f)
                .alpha(1f - phase)
                .border(1.dp, modes.callTextSecondary, CircleShape),
        )
    }
}

/** 角色正在说话：头像下方 3 段声波，透明度轮流变化。 */
@Composable private fun SpeakingWave() {
    val modes = LocalWeibanModeColors.current
    val transition = rememberInfiniteTransition(label = "声波")
    val progress by transition.animateFloat(0f, 3f, infiniteRepeatable(tween(WbMotion.TypingCycleMs), RepeatMode.Restart), label = "声波轮换")
    Row(Modifier.padding(top = WbSpace.S3), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        repeat(3) { index ->
            Box(
                Modifier
                    .size(width = 4.dp, height = (10 + index % 2 * 6).dp)
                    .clip(RoundedCornerShape(2.dp))
                    .alpha(if (progress.toInt() == index) 1f else 0.35f)
                    .background(modes.callText),
            )
        }
    }
}

// ---------- 开启来电时的权限（media-l5.md 7.4） ----------

internal fun canUseFullScreen(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
        context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

internal fun openFullScreenSettings(context: Context) {
    val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.fromParts("package", context.packageName, null))
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        }
    try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: android.content.ActivityNotFoundException) {
        openAppSettings(context)
    }
}

/**
 * 打开「TA 给我打电话」或点来电询问的「可以」之后：先要通知权限，再检查全屏通知权限（安卓 14 起单独授予），
 * 没有时弹「需要允许全屏通知…」+「去设置」「以后再说」。返回一个触发函数。
 */
@Composable internal fun rememberCallPermissionFlow(): () -> Unit {
    val context = LocalContext.current
    var asking by remember { mutableStateOf(false) }
    val notifications =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
            if (!canUseFullScreen(context)) asking = true
        }
    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            text = { Text("需要允许全屏通知，TA 打来时才能在锁屏上显示") },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    openFullScreenSettings(context)
                }) { Text("去设置") }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text("以后再说") } },
        )
    }
    return remember(notifications) {
        {
            val needsNotice =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            if (needsNotice) {
                notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else if (!canUseFullScreen(context)) {
                asking = true
            }
        }
    }
}
