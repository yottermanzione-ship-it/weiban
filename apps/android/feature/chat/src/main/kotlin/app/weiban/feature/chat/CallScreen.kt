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
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import app.weiban.designsystem.ImmersiveStatusBar
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.wbText
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
        app.weiban.designsystem.WbConfirm(text, "知道了", cancel = null, onDismiss = { notice = null }) { notice = null }
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

/**
 * 通话页（规格 4.13）：全屏，底 call.bg；背景 = 角色头像放大铺满 + 模糊（半径 32，只在进页时处理一次，安卓 12 起用 RenderEffect）
 * + 一层 55% 黑；自上而下：安全区 + 48 → 名字 28/600 → 10 → 状态行 16 → 弹性 → 头像 168 圆角 18 → 弹性 → 控制区 → 48。
 * 拨出时循环播放旧版回铃（res/raw/wb_call_ringback）。
 */
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
    val outgoingRinging = view.direction != "incoming" && (view.phase == CallPhase.Dialing || view.phase == CallPhase.Connecting)
    Ringback(outgoingRinging)
    val profiles = characterProfiles(repository, listOf(view.characterId))
    val identity = RoleAvatarIdentity(view.characterId, view.name, profiles[view.characterId]?.avatar)
    val status =
        when (view.phase) {
            CallPhase.Dialing, CallPhase.Connecting -> if (view.direction == "incoming") "正在接通…" else "等待对方接受邀请"
            CallPhase.Incoming -> "邀请你语音通话"
            CallPhase.Active -> "通话中 ${clock(seconds)}"
            CallPhase.Reconnecting -> "网络不佳，正在重连…"
            CallPhase.Ended -> view.endText.orEmpty()
        }
    ImmersiveStatusBar(lightIcons = true)
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(modes.callBgTop)
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } },
    ) {
        val edge = maxOf(maxWidth, maxHeight)
        Box(Modifier.requiredSize(edge).align(Alignment.Center).blur(32.dp)) {
            RoleAvatar(repository, owner, identity, edge, 0.dp)
        }
        Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0x8C000000)))
        Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.fillMaxWidth().height(48.dp)) {
                if (view.phase == CallPhase.Active || view.phase == CallPhase.Reconnecting) {
                    Box(Modifier.size(48.dp).clickableNoRipple { calls.minimize(true) }, contentAlignment = Alignment.Center) {
                        WbIcon(DsR.drawable.wb_chevron_down, 24.dp, androidx.compose.ui.graphics.Color.White, contentDescription = "缩小")
                    }
                }
            }
            Text(view.name, style = wbText(28.sp, 600, modes.callText))
            Spacer(Modifier.height(10.dp))
            Text(status, style = wbText(16.sp, 400, modes.callTextSecondary))
            if (view.phase == CallPhase.Active && view.agentSpeaking) SpeakingWave()
            Spacer(Modifier.weight(1f))
            Box(contentAlignment = Alignment.Center) {
                if (view.phase == CallPhase.Dialing || view.phase == CallPhase.Incoming) CallRings()
                RoleAvatar(repository, owner, identity, 168.dp, 18.dp)
            }
            Spacer(Modifier.weight(1f))
            CallButtons(calls, view, gate)
            Spacer(Modifier.height(48.dp))
        }
    }
}

/** 拨出时的回铃（循环）；离开拨出状态即停止。 */
@Composable private fun Ringback(playing: Boolean) {
    val context = LocalContext.current
    DisposableEffect(playing) {
        val player =
            if (playing) {
                runCatching { android.media.MediaPlayer.create(context, DsR.raw.wb_call_ringback)?.apply { isLooping = true } }.getOrNull()
            } else {
                null
            }
        player?.start()
        onDispose {
            player?.run {
                runCatching { stop() }
                release()
            }
        }
    }
}

/** 控制区（4.13）：左右 28，三键均分，每键宽 88：圆 64 + 8 + 白字 13。来电：拒绝 / 接听两键。 */
@Composable private fun CallButtons(
    calls: CallController,
    view: CallView,
    gate: MicrophoneGate,
) {
    val modes = LocalWeibanModeColors.current
    val white = androidx.compose.ui.graphics.Color.White
    val dark = androidx.compose.ui.graphics.Color(0xFF111111)
    when (view.phase) {
        CallPhase.Incoming ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallButton("拒绝", DsR.drawable.wb_drawn_hangup, modes.callDecline, white) { calls.decline() }
                CallButton("接听", DsR.drawable.wb_drawn_phone, modes.callAccept, white) { gate.request { calls.answer() } }
            }
        CallPhase.Ended -> Spacer(Modifier.height(CALL_BUTTON + 24.dp))
        else -> {
            val connected = view.phase == CallPhase.Active || view.phase == CallPhase.Reconnecting
            Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                val micOn = !view.muted
                CallButton(
                    if (micOn) "麦克风已开" else "麦克风已关",
                    if (micOn) DsR.drawable.wb_drawn_mic else DsR.drawable.wb_drawn_mic_off,
                    if (micOn) modes.callControlActive else modes.callControl,
                    if (micOn) dark else white,
                    enabled = connected,
                ) { calls.toggleMute() }
                CallButton(if (connected || view.direction == "incoming") "挂断" else "取消", DsR.drawable.wb_drawn_hangup, modes.callDecline, white) {
                    calls.hangUp()
                }
                CallButton(
                    if (view.speaker) "扬声器已开" else "扬声器已关",
                    if (view.speaker) DsR.drawable.wb_drawn_speaker else DsR.drawable.wb_drawn_speaker_off,
                    if (view.speaker) modes.callControlActive else modes.callControl,
                    if (view.speaker) dark else white,
                    enabled = connected,
                ) { calls.toggleSpeaker() }
            }
        }
    }
}

@Composable private fun CallButton(
    label: String,
    icon: Int,
    color: androidx.compose.ui.graphics.Color,
    iconColor: androidx.compose.ui.graphics.Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val modes = LocalWeibanModeColors.current
    Column(Modifier.width(88.dp).alpha(if (enabled) 1f else 0.5f), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(CALL_BUTTON)
                .clip(CircleShape)
                .background(color)
                .clickable(enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            WbIcon(icon, 28.dp, iconColor, contentDescription = label)
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = wbText(13.sp, 400, modes.callText), maxLines = 1)
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
                .size(168.dp)
                .scale(1f + phase * 0.3f)
                .alpha(1f - phase)
                .border(1.dp, modes.callTextSecondary, RoundedCornerShape(18.dp)),
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
