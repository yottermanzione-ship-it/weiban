package app.weiban.feature.chat

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.PowerManager
import androidx.compose.runtime.*
import app.weiban.contracts.Message
import app.weiban.contracts.ReceivedMessageContentVoice
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.data.downloadChatMedia
import kotlinx.coroutines.*
import java.io.File
import java.io.IOException

/**
 * 语音播放（media-l5.md 3.2）：同时只播一条；播完自动接着播紧挨着的角色未播放语音；
 * 离开聊天页 / 通话开始停止；默认扬声器，贴近耳朵（距离传感器）切到听筒并熄屏。
 * 「已播放」记在本机（Room 标记 voice:played:<messageId>），换设备后红点会重新出现（同网页）。
 */
internal class VoicePlayer(
    context: Context,
    private val repository: SessionRepository,
    private val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    private val app = context.applicationContext
    var playingId by mutableStateOf<String?>(null)
        private set
    var loadingId by mutableStateOf<String?>(null)
        private set
    val failed = mutableStateMapOf<String, Boolean>()
    val played = mutableStateMapOf<String, Boolean>()

    /** 由界面提供：某条消息之后紧挨着的那条（按 seq）。 */
    var nextOf: (String) -> Message? = { null }

    /** 失败时的提示（Toast）。 */
    var onFailure: (String) -> Unit = {}

    private var player: MediaPlayer? = null
    private var job: Job? = null
    private var currentFile: File? = null
    private var earpiece = false
    private val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val sensors = app.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val proximity: Sensor? = sensors.getDefaultSensor(Sensor.TYPE_PROXIMITY)
    private val power = app.getSystemService(Context.POWER_SERVICE) as PowerManager
    private var screenOff: PowerManager.WakeLock? = null
    private val listener =
        object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val sensor = proximity ?: return
                val near = event.values.firstOrNull()?.let { it < sensor.maximumRange && it < NEAR_CM } == true
                if (near != earpiece) route(near)
            }

            override fun onAccuracyChanged(
                sensor: Sensor?,
                accuracy: Int,
            ) = Unit
        }

    suspend fun loadPlayed(messageIds: List<String>) {
        for (id in messageIds) {
            if (played[id] == null) played[id] = repository.flags.get(owner, "voice:played:$id") != null
        }
    }

    fun toggle(message: Message) {
        if (playingId == message.messageId || loadingId == message.messageId) stop() else play(message)
    }

    fun play(message: Message) {
        val content = message.content as? ReceivedMessageContentVoice ?: return
        stop()
        failed.remove(message.messageId)
        loadingId = message.messageId
        markPlayed(message)
        job =
            scope.launch {
                val file = fetch(content.mediaId)
                if (loadingId != message.messageId) return@launch
                loadingId = null
                if (file == null) {
                    failed[message.messageId] = true
                    onFailure("语音加载失败，点击重试")
                    return@launch
                }
                start(message, file, 0)
            }
    }

    private fun markPlayed(message: Message) {
        if (message.senderKind == "user" || played[message.messageId] == true) return
        played[message.messageId] = true
        scope.launch { repository.flags.set(owner, "voice:played:${message.messageId}", "1") }
    }

    // A broken file or decoder shows the failure mark instead of crashing.
    @Suppress("TooGenericExceptionCaught", "InstanceOfCheckForException")
    private fun start(
        message: Message,
        file: File,
        position: Int,
    ) {
        release()
        currentFile = file
        try {
            val next = MediaPlayer()
            next.setAudioAttributes(
                AudioAttributes
                    .Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setUsage(if (earpiece) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA)
                    .build(),
            )
            next.setDataSource(file.absolutePath)
            next.setOnCompletionListener { finished(message) }
            next.setOnErrorListener { _, _, _ ->
                failed[message.messageId] = true
                onFailure("语音加载失败，点击重试")
                stop()
                true
            }
            next.prepare()
            if (position > 0) next.seekTo(position)
            next.start()
            player = next
            playingId = message.messageId
            playingMessage = message
            listenProximity(true)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            failed[message.messageId] = true
            onFailure("语音加载失败，点击重试")
            stop()
        }
    }

    /** 自动连播：紧接着的下一条也是角色的未播放语音才继续（MED-03 第 3 条）。 */
    @Suppress("ComplexCondition") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
    private fun finished(message: Message) {
        val following = nextOf(message.messageId)
        stop()
        if (following != null &&
            following.status == "normal" &&
            following.senderKind != "user" &&
            following.content is ReceivedMessageContentVoice &&
            played[following.messageId] != true
        ) {
            play(following)
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        loadingId = null
        playingId = null
        release()
        listenProximity(false)
        if (earpiece) route(false, restart = false)
    }

    private fun release() {
        player?.let {
            it.setOnCompletionListener(null)
            it.setOnErrorListener(null)
            it.release()
        }
        player = null
    }

    private fun listenProximity(active: Boolean) {
        val sensor = proximity ?: return
        if (active) {
            sensors.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
        } else {
            sensors.unregisterListener(listener)
        }
    }

    /** 听筒 / 扬声器切换：换播放用途并从当前位置继续；贴近耳朵时熄屏。 */
    @SuppressLint("WakelockTimeout") // Released as soon as the ear leaves the sensor or playback stops.
    @Suppress("ReturnCount") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
    private fun route(
        near: Boolean,
        restart: Boolean = true,
    ) {
        earpiece = near
        if (near) {
            audio.mode = AudioManager.MODE_IN_COMMUNICATION
            useEarpiece(true)
            if (screenOff == null && power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                screenOff = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "weiban:voice").apply { acquire() }
            }
        } else {
            useEarpiece(false)
            audio.mode = AudioManager.MODE_NORMAL
            screenOff?.let { if (it.isHeld) it.release() }
            screenOff = null
        }
        val current = player ?: return
        if (!restart) return
        val position = current.currentPosition
        val file = currentFile ?: return
        val message = playingMessage ?: return
        start(message, file, position)
    }

    private var playingMessage: Message? = null

    private fun useEarpiece(on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (on) {
                audio.availableCommunicationDevices
                    .find { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
                    ?.let { audio.setCommunicationDevice(it) }
            } else {
                audio.clearCommunicationDevice()
            }
        } else {
            legacySpeaker(!on)
        }
    }

    @Suppress("DEPRECATION") // Only used below Android 12, where setCommunicationDevice is unavailable.
    private fun legacySpeaker(on: Boolean) {
        audio.isSpeakerphoneOn = on
    }

    @Suppress("TooGenericExceptionCaught") // Download failures show the per-message failure mark.
    private suspend fun fetch(mediaId: String): File? =
        try {
            val directory = File(app.cacheDir, "voice").apply { mkdirs() }
            val file = File(directory, "$mediaId.audio")
            if (!file.isFile || file.length() == 0L) {
                val bytes = downloadChatMedia(repository, owner, mediaId, audio = true)
                withContext(Dispatchers.IO) {
                    val temp = File(directory, "$mediaId.part")
                    temp.writeBytes(bytes)
                    if (!temp.renameTo(file)) throw IOException("rename failed")
                }
            }
            file
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }

    private companion object {
        const val NEAR_CM = 3f
    }
}

/** 试听（TA 的声音）：一次只放一个，播完回调。 */
internal class SamplePlayer(
    context: Context,
    private val repository: SessionRepository,
    private val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    private val app = context.applicationContext
    var playing by mutableStateOf<String?>(null)
        private set
    private var player: MediaPlayer? = null
    private var job: Job? = null

    @Suppress("TooGenericExceptionCaught") // Missing sample: stop quietly and let the caller show a hint.
    fun toggle(
        key: String,
        mediaId: String,
        onFailure: () -> Unit,
    ) {
        if (playing == key) {
            stop()
            return
        }
        stop()
        playing = key
        job =
            scope.launch {
                try {
                    val bytes = downloadChatMedia(repository, owner, mediaId, audio = true)
                    val file = File(app.cacheDir, "voice-sample-$mediaId.audio")
                    withContext(Dispatchers.IO) { file.writeBytes(bytes) }
                    val next = MediaPlayer()
                    next.setDataSource(file.absolutePath)
                    next.setOnCompletionListener { stop() }
                    next.prepare()
                    next.start()
                    player = next
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    stop()
                    onFailure()
                }
            }
    }

    fun stop() {
        job?.cancel()
        job = null
        player?.release()
        player = null
        playing = null
    }
}
