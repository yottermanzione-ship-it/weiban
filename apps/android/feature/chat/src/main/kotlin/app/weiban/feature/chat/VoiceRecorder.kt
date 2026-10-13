package app.weiban.feature.chat

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.delay
import java.io.File

private const val MIN_VOICE_MS = 1_000L
private const val MAX_VOICE_MS = 60_000L
private const val COUNTDOWN_FROM_MS = 50_000L
private const val SAMPLE_RATE = 16_000
private const val BIT_RATE = 32_000

/** 录一段语音（AAC / MP4 容器，服务器按文件头识别为 audio/mp4）。 */
internal class VoiceRecorder(
    private val context: Context,
) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L

    @Suppress("TooGenericExceptionCaught", "InstanceOfCheckForException") // Busy microphone / device quirks: report false and clean up.
    fun start(): Boolean {
        cancel()
        return try {
            val directory = File(context.cacheDir, "voice-record").apply { mkdirs() }
            val output = File.createTempFile("voice-", ".m4a", directory)
            val next = newRecorder()
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioChannels(1)
            next.setAudioSamplingRate(SAMPLE_RATE)
            next.setAudioEncodingBitRate(BIT_RATE)
            next.setMaxDuration(MAX_VOICE_MS.toInt())
            next.setOutputFile(output.absolutePath)
            next.prepare()
            next.start()
            recorder = next
            file = output
            startedAt = System.currentTimeMillis()
            true
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            cancel()
            false
        }
    }

    private fun newRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else legacyRecorder()

    @Suppress("DEPRECATION") // The context constructor exists only from Android 12.
    private fun legacyRecorder(): MediaRecorder = MediaRecorder()

    /** 结束录音：返回文件与时长（毫秒）；太短或失败返回时长但文件为 null。 */
    @Suppress("TooGenericExceptionCaught", "ReturnCount") // stop() throws when nothing valid was recorded (too short).
    fun finish(): Pair<File?, Long> {
        val duration = (System.currentTimeMillis() - startedAt).coerceAtMost(MAX_VOICE_MS)
        val current = recorder ?: return null to 0L
        val output = file
        recorder = null
        file = null
        val ok =
            try {
                current.stop()
                true
            } catch (_: RuntimeException) {
                false
            } finally {
                current.release()
            }
        if (!ok || duration < MIN_VOICE_MS || output == null) {
            output?.delete()
            return null to duration
        }
        return output to duration
    }

    @Suppress("TooGenericExceptionCaught") // stop() throws when the recording was too short to be valid.
    fun cancel() {
        recorder?.let {
            try {
                it.stop()
            } catch (_: RuntimeException) {
                Unit
            }
            it.release()
        }
        recorder = null
        file?.delete()
        file = null
    }

    fun elapsed(): Long = if (recorder == null) 0L else System.currentTimeMillis() - startedAt
}

internal fun hasMicrophone(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

internal fun openAppSettings(context: Context) {
    try {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    } catch (_: android.content.ActivityNotFoundException) {
        Unit
    }
}

/**
 * 「按住 说话」（设计 C 5.4、media-l5.md 3.1）：上滑取消，不到 1 秒提示太短，满 60 秒自动发出；
 * 首次要麦克风权限，拒绝后再按弹说明 +「去设置」。
 */
@Suppress("LoopWithTooManyJumpStatements") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
@Composable
internal fun HoldToTalk(
    enabled: Boolean,
    onStart: () -> Unit,
    onVoice: (File, Long) -> Unit,
    onNotice: (String) -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val recorder = remember { VoiceRecorder(context.applicationContext) }
    var recording by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var elapsed by remember { mutableLongStateOf(0L) }
    var asked by rememberSaveable { mutableStateOf(false) }
    var explaining by remember { mutableStateOf(false) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) explaining = true
        }
    // 手指离开屏幕底部 150 以上进入取消态（规格 4.4.9）。
    val cancelDistance = with(LocalDensity.current) { 150.dp.toPx() }
    val screenHeight = with(LocalDensity.current) { androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.height.toFloat() }
    var origin by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    val dark = app.weiban.designsystem.LocalWbDark.current
    val send by rememberUpdatedState(onVoice)
    val notice by rememberUpdatedState(onNotice)
    val started by rememberUpdatedState(onStart)
    DisposableEffect(Unit) { onDispose { recorder.cancel() } }
    LaunchedEffect(recording) {
        while (recording) {
            elapsed = recorder.elapsed()
            if (elapsed >= MAX_VOICE_MS) {
                // 满 60 秒自动发出；松手时不再处理。
                recording = false
                val (file, duration) = recorder.finish()
                if (file != null) send(file, duration)
            }
            delay(200)
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .onGloballyPositioned { origin = it.positionInWindow() }
            .background(
                when {
                    !recording -> colors.bgInputField
                    dark -> androidx.compose.ui.graphics.Color(0xFF2C2C2E)
                    else -> androidx.compose.ui.graphics.Color(0xFFE0E0E0)
                },
                RoundedCornerShape(8.dp),
            ).pointerInput(enabled) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown()
                    if (!hasMicrophone(context)) {
                        if (asked) explaining = true else permission.launch(Manifest.permission.RECORD_AUDIO)
                        asked = true
                        return@awaitEachGesture
                    }
                    started()
                    if (!recorder.start()) {
                        notice("麦克风暂时不可用")
                        return@awaitEachGesture
                    }
                    recording = true
                    cancelling = false
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        cancelling = screenHeight - (origin.y + change.position.y) > cancelDistance
                        if (!change.pressed) break
                        change.consume()
                    }
                    if (recording) {
                        recording = false
                        if (cancelling) {
                            recorder.cancel()
                        } else {
                            val (file, duration) = recorder.finish()
                            if (file != null) {
                                send(file, duration)
                            } else if (duration < MIN_VOICE_MS) {
                                notice("说话时间太短")
                            }
                        }
                    }
                    cancelling = false
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (recording) "松开发送" else "按住说话",
            style = app.weiban.designsystem.wbText(15.sp, 500, if (recording) colors.brandPrimary else colors.textSecondary),
        )
    }
    if (recording) RecordingOverlay(cancelling, elapsed)
    if (explaining) {
        AlertDialog(
            onDismissRequest = { explaining = false },
            title = { Text("需要麦克风权限才能发语音") },
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
}

/** 录音文件读成字节（上传用）；读完删除临时文件。 */
internal fun consumeRecording(file: File): ByteArray {
    try {
        return file.readBytes()
    } finally {
        file.delete()
    }
}

/**
 * 录音遮罩（规格 4.4.9）：全屏 record.mask；中间偏上录音气泡 210×86、圆角 22（取消态变灰）+ 下方旋转小方块尖角；
 * 气泡内 28 根柱子正弦起伏（760ms 循环，只改 scaleY）；气泡下方 24 提示文字 14/500。
 */
@Composable private fun RecordingOverlay(
    cancelling: Boolean,
    elapsed: Long,
) {
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "录音波形")
    val phase by transition.animateFloat(
        0f,
        (2 * Math.PI).toFloat(),
        androidx.compose.animation.core.infiniteRepeatable(
            androidx.compose.animation.core.tween(app.weiban.designsystem.tokens.WbMotion.RecordWaveMs, easing = androidx.compose.animation.core.LinearEasing),
        ),
        label = "波形相位",
    )
    val bubble = if (cancelling) mode.uiRecordBubbleCancel else mode.uiRecordBubble
    Popup(popupPositionProvider = FullScreenPopup, properties = androidx.compose.ui.window.PopupProperties(focusable = false)) {
        Box(Modifier.fillMaxSize().background(mode.uiRecordMask)) {
            Column(
                Modifier.align(androidx.compose.ui.BiasAlignment(0f, -0.04f)),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(contentAlignment = Alignment.TopCenter) {
                    Box(
                        Modifier
                            .padding(top = 75.dp)
                            .size(24.dp)
                            .graphicsLayer { rotationZ = 45f }
                            .background(bubble, RoundedCornerShape(4.dp)),
                    )
                    Box(
                        Modifier
                            .size(210.dp, 86.dp)
                            .shadow(12.dp, RoundedCornerShape(22.dp))
                            .background(bubble, RoundedCornerShape(22.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(Modifier.size(126.dp, 34.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            repeat(WAVE_BARS) { i ->
                                val scale = 0.25f + 0.75f * ((kotlin.math.sin(phase + i * 0.55f) + 1f) / 2f)
                                Box(
                                    Modifier
                                        .width(3.3.dp)
                                        .fillMaxHeight()
                                        .graphicsLayer { scaleY = scale }
                                        .background(mode.uiRecordWave, RoundedCornerShape(2.dp)),
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    when {
                        cancelling -> "松开手指，取消发送"
                        elapsed >= COUNTDOWN_FROM_MS -> "还可以说 ${(MAX_VOICE_MS - elapsed) / 1000} 秒"
                        else -> "手指上滑，取消发送"
                    },
                    style = app.weiban.designsystem.wbText(14.sp, 500, if (cancelling) mode.uiRecordCancelText else androidx.compose.ui.graphics.Color(0xB3FFFFFF)),
                )
            }
        }
    }
}

private const val WAVE_BARS = 28

/** 铺满窗口的浮层位置（左上角对齐窗口）。 */
private object FullScreenPopup : androidx.compose.ui.window.PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: androidx.compose.ui.unit.IntRect,
        windowSize: androidx.compose.ui.unit.IntSize,
        layoutDirection: androidx.compose.ui.unit.LayoutDirection,
        popupContentSize: androidx.compose.ui.unit.IntSize,
    ): androidx.compose.ui.unit.IntOffset = androidx.compose.ui.unit.IntOffset.Zero
}
