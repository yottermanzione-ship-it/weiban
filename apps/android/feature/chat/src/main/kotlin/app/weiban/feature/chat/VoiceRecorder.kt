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
import androidx.compose.ui.unit.dp
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
    val cancelDistance = with(LocalDensity.current) { 80.dp.toPx() }
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
            .height(WbSize.InputBarMin - WbSpace.S3)
            .background(if (recording) colors.bgPressed else colors.bgInputField, RoundedCornerShape(WbRadius.Sm))
            .pointerInput(enabled) {
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
                        cancelling = down.position.y - change.position.y > cancelDistance
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
        Text(if (recording) "松开 发送" else "按住 说话", style = MaterialTheme.typography.titleSmall)
    }
    if (recording) {
        Popup(alignment = Alignment.Center) {
            Surface(color = colors.bgScrim, shape = RoundedCornerShape(WbRadius.Md)) {
                Column(Modifier.padding(WbSpace.S8), horizontalAlignment = Alignment.CenterHorizontally) {
                    val seconds = elapsed / 1000
                    Text(
                        if (elapsed >= COUNTDOWN_FROM_MS) "还可以说 ${(MAX_VOICE_MS - elapsed) / 1000} 秒" else "$seconds″",
                        color = colors.textOnBrand,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                    Text(
                        if (cancelling) "松开手指，取消发送" else "手指上滑，取消发送",
                        color = if (cancelling) colors.textDanger else colors.textOnBrand,
                    )
                }
            }
        }
    }
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
