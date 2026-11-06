package app.weiban.shell

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/** Owns only this app's call route; never changes the device volume or microphone switch. */
internal class ShellCallAudio(
    context: Context,
) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private var owner: String? = null
    private var previousMode = AudioManager.MODE_NORMAL
    private var previousSpeaker = false
    private var previousDevice: AudioDeviceInfo? = null

    fun begin(id: String): Boolean {
        if (owner != null || audio.mode == AudioManager.MODE_IN_CALL) {
            return owner == id && audio.mode != AudioManager.MODE_IN_CALL
        }
        previousMode = audio.mode
        previousSpeaker = legacySpeaker()
        if (Build.VERSION.SDK_INT >= 31) previousDevice = audio.communicationDevice
        owner = id
        return runCatching {
            audio.mode = AudioManager.MODE_IN_COMMUNICATION
            true
        }.getOrElse {
            end()
            false
        }
    }

    fun select(
        id: String,
        speaker: Boolean,
    ): Boolean {
        if (owner != id || audio.mode != AudioManager.MODE_IN_COMMUNICATION) return false
        return runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                val kind = if (speaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                audio.availableCommunicationDevices
                    .firstOrNull { it.type == kind }
                    ?.let { audio.setCommunicationDevice(it) } ?: false
            } else {
                if (switchAvailable()) {
                    setLegacySpeaker(speaker)
                    legacySpeaker() == speaker
                } else {
                    false
                }
            }
        }.getOrDefault(false)
    }

    fun route(): String =
        runCatching {
            if (owner == null || audio.mode != AudioManager.MODE_IN_COMMUNICATION) {
                "system"
            } else if (Build.VERSION.SDK_INT >= 31) {
                when (audio.communicationDevice?.type) {
                    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
                    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
                    null -> "system"
                    else -> "headset"
                }
            } else if (legacySpeaker()) {
                "speaker"
            } else if (audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in headsetTypes }) {
                "headset"
            } else {
                "earpiece"
            }
        }.getOrDefault("system")

    fun switchAvailable(): Boolean =
        runCatching {
            val types =
                if (Build.VERSION.SDK_INT >= 31) {
                    audio.availableCommunicationDevices.map { it.type }
                } else {
                    audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
                }
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER in types && AudioDeviceInfo.TYPE_BUILTIN_EARPIECE in types &&
                (Build.VERSION.SDK_INT >= 31 || types.none { it in headsetTypes })
        }.getOrDefault(false)

    fun end(id: String? = null) {
        if (owner == null || (id != null && id != owner)) return
        owner = null
        runCatching {
            if (audio.mode != AudioManager.MODE_IN_COMMUNICATION) return@runCatching
            if (Build.VERSION.SDK_INT >= 31) {
                audio.clearCommunicationDevice()
                previousDevice
                    ?.takeIf { old -> audio.availableCommunicationDevices.any { it.id == old.id } }
                    ?.let { audio.setCommunicationDevice(it) }
            } else {
                setLegacySpeaker(previousSpeaker)
            }
            audio.mode = previousMode
        }
        previousDevice = null
    }

    @Suppress("DEPRECATION")
    private fun legacySpeaker(): Boolean = audio.isSpeakerphoneOn

    @Suppress("DEPRECATION")
    private fun setLegacySpeaker(value: Boolean) {
        audio.isSpeakerphoneOn = value
    }

    private companion object {
        val headsetTypes =
            setOf(
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_USB_HEADSET,
            )
    }
}
