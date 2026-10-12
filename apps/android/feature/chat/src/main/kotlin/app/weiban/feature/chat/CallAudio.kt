package app.weiban.feature.chat

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.PowerManager
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

private const val INPUT_RATE = 16_000
private const val FRAME_MS = 40
private const val FRAME_BYTES = INPUT_RATE * 2 * FRAME_MS / 1000
private const val VOICE_RMS = 1_400.0
private const val VOICE_FRAMES = 3

/**
 * 通话音频（ADR-0025 方案 B）：上行 PCM16 / 16 kHz / 单声道，每 40 ms 一帧；下行按 call.ready 的采样率播放。
 * 用通话音源（系统回声消除），检测到用户在角色说话时开口即回调 onBargeIn（MED-06 第 2 条，可打断）。
 * 默认听筒；贴近耳朵熄屏（扬声器打开时不熄屏，media-l5.md 7.3）。耳机 / 蓝牙由系统通话路由自动接管。
 */
internal class CallAudio(
    context: Context,
    private val onFrame: (ByteArray) -> Unit,
    private val onBargeIn: () -> Unit,
    private val onFocusLost: () -> Unit,
) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    private val queue = LinkedBlockingQueue<ByteArray>()

    @Volatile private var running = false

    @Volatile var muted = false

    @Volatile var agentSpeaking = false
    private var recorder: AudioRecord? = null
    private var track: AudioTrack? = null
    private var capture: Thread? = null
    private var playback: Thread? = null
    private var echo: AcousticEchoCanceler? = null
    private var noise: NoiseSuppressor? = null
    private var proximity: PowerManager.WakeLock? = null
    private var speaker = false
    private val focus =
        AudioFocusRequest
            .Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes())
            .setOnAudioFocusChangeListener { change ->
                // 系统电话打进来等：微伴通话自动挂断（media-l5.md 7.3）。
                if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) onFocusLost()
            }.build()

    private fun attributes(): AudioAttributes =
        AudioAttributes
            .Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

    /** 进入通话音频模式（拨出 / 接听时调用，比 call.ready 早，便于系统切换路由）。 */
    fun enter() {
        audio.requestAudioFocus(focus)
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        applySpeaker(false)
    }

    /** call.ready 后开始双向音频。重连时会再次调用：只重建播放（采样率可能变化）。 */
    @SuppressLint("MissingPermission") // The call UI requests RECORD_AUDIO before dialing / answering.
    // Device audio failures end in silence instead of crashing the call.
    @Suppress("TooGenericExceptionCaught", "InstanceOfCheckForException")
    fun start(outputRate: Int) {
        startPlayback(outputRate)
        if (running) return
        running = true
        try {
            val minimum = AudioRecord.getMinBufferSize(INPUT_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val next =
                AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    INPUT_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(minimum, FRAME_BYTES * 4),
                )
            if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(next.audioSessionId)?.apply { enabled = true }
            if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(next.audioSessionId)?.apply { enabled = true }
            next.startRecording()
            recorder = next
            capture = Thread({ captureLoop(next) }, "weiban-call-capture").apply { start() }
        } catch (error: Exception) {
            if (error is InterruptedException) Thread.currentThread().interrupt()
            running = false
        }
    }

    @Suppress("CyclomaticComplexMethod", "LoopWithTooManyJumpStatements") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
    private fun captureLoop(source: AudioRecord) {
        val buffer = ByteArray(FRAME_BYTES)
        var loud = 0
        var interrupted = false
        while (running) {
            var read = 0
            while (read < buffer.size && running) {
                val count = source.read(buffer, read, buffer.size - read)
                if (count <= 0) break
                read += count
            }
            if (read < buffer.size) continue
            if (muted) {
                loud = 0
                continue
            }
            onFrame(buffer.copyOf())
            if (agentSpeaking && rms(buffer) > VOICE_RMS) {
                loud++
                if (loud >= VOICE_FRAMES && !interrupted) {
                    interrupted = true
                    flushPlayback()
                    onBargeIn()
                }
            } else {
                loud = 0
                if (!agentSpeaking) interrupted = false
            }
        }
    }

    private fun rms(frame: ByteArray): Double {
        var sum = 0.0
        var index = 0
        while (index + 1 < frame.size) {
            val sample = (frame[index].toInt() and 0xff) or (frame[index + 1].toInt() shl 8)
            sum += sample.toDouble() * sample
            index += 2
        }
        return sqrt(sum / (frame.size / 2))
    }

    private fun startPlayback(rate: Int) {
        val current = track
        if (current != null && current.sampleRate == rate) return
        stopPlayback()
        val minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val next =
            AudioTrack
                .Builder()
                .setAudioAttributes(attributes())
                .setAudioFormat(
                    AudioFormat
                        .Builder()
                        .setSampleRate(rate)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                ).setBufferSizeInBytes(maxOf(minimum, rate / 5))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        next.play()
        track = next
        playback =
            Thread({
                try {
                    while (track === next) {
                        val chunk = queue.poll(200, TimeUnit.MILLISECONDS) ?: continue
                        next.write(chunk, 0, chunk.size)
                    }
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }, "weiban-call-playback").apply { start() }
    }

    fun play(chunk: ByteArray) {
        if (track != null) queue.offer(chunk)
    }

    /** 打断：丢掉还没播放的角色语音。 */
    fun flushPlayback() {
        queue.clear()
        track?.let {
            it.pause()
            it.flush()
            it.play()
        }
    }

    private fun stopPlayback() {
        val current = track ?: return
        track = null
        playback?.interrupt()
        playback = null
        queue.clear()
        current.stop()
        current.release()
    }

    fun setSpeaker(on: Boolean) {
        speaker = on
        applySpeaker(on)
    }

    val speakerOn: Boolean get() = speaker

    private fun applySpeaker(on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val type = if (on) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            val headset =
                audio.availableCommunicationDevices.firstOrNull {
                    it.type in
                        listOf(
                            AudioDeviceInfo.TYPE_WIRED_HEADSET,
                            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                            AudioDeviceInfo.TYPE_BLE_HEADSET,
                        )
                }
            val device = if (!on && headset != null) headset else audio.availableCommunicationDevices.firstOrNull { it.type == type }
            device?.let { audio.setCommunicationDevice(it) }
        } else {
            legacySpeaker(on)
        }
        updateProximity()
    }

    @Suppress("DEPRECATION") // Only below Android 12, where setCommunicationDevice is unavailable.
    private fun legacySpeaker(on: Boolean) {
        audio.isSpeakerphoneOn = on
    }

    @SuppressLint("WakelockTimeout") // Released when the call ends or the speaker turns on.
    private fun updateProximity() {
        if (!speaker && proximity == null && power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            proximity = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "weiban:call").apply { acquire() }
        } else if (speaker) {
            proximity?.let { if (it.isHeld) it.release() }
            proximity = null
        }
    }

    fun release() {
        running = false
        capture?.interrupt()
        capture = null
        recorder?.let {
            runCatching { it.stop() }
            it.release()
        }
        recorder = null
        echo?.release()
        echo = null
        noise?.release()
        noise = null
        stopPlayback()
        proximity?.let { if (it.isHeld) it.release() }
        proximity = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.clearCommunicationDevice() else legacySpeaker(false)
        audio.mode = AudioManager.MODE_NORMAL
        audio.abandonAudioFocusRequest(focus)
    }
}
