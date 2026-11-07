package app.weiban.shell

import android.media.AudioDeviceInfo
import android.media.AudioManager
import androidx.activity.ComponentActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.AudioDeviceInfoBuilder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ShellCallAudioTest {
    @Test
    @Config(sdk = [31])
    fun speakerAndEarpieceSelectRealDevicesAndRestoreThePreviousRoute() {
        val context = RuntimeEnvironment.getApplication()
        val audio = context.getSystemService(AudioManager::class.java)
        val earpiece = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE).build()
        val speaker = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER).build()
        shadowOf(audio).setAvailableCommunicationDevices(listOf(earpiece, speaker))
        audio.setCommunicationDevice(earpiece)
        val route = ShellCallAudio(context)
        assertTrue(route.begin("call"))
        assertTrue(route.switchAvailable())
        assertTrue(route.select("call", true))
        assertEquals(speaker, audio.communicationDevice)
        assertEquals("speaker", route.route())
        assertTrue(route.select("call", false))
        assertEquals(earpiece, audio.communicationDevice)
        shadowOf(audio).lockCommunicationDevice(true)
        assertFalse(route.select("call", true))
        assertEquals("earpiece", route.route())
        shadowOf(audio).lockCommunicationDevice(false)
        route.end()
        assertEquals(earpiece, audio.communicationDevice)
    }

    @Test
    fun callOwnershipRestoresModeAndDoesNotTouchGlobalMicrophoneOrVolume() {
        val context = RuntimeEnvironment.getApplication()
        val audio = context.getSystemService(AudioManager::class.java)
        audio.mode = AudioManager.MODE_NORMAL
        val volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        val muted = audio.isMicrophoneMute
        val route = ShellCallAudio(context)
        assertFalse(route.select("stale", true))
        assertTrue(route.begin("current"))
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, audio.mode)
        assertFalse(route.begin("other"))
        route.end("stale")
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, audio.mode)
        route.end("current")
        assertEquals(AudioManager.MODE_NORMAL, audio.mode)
        assertEquals(volume, audio.getStreamVolume(AudioManager.STREAM_MUSIC))
        assertEquals(muted, audio.isMicrophoneMute)
    }

    @Test
    fun cellularCallCannotBeTakenOver() {
        val context = RuntimeEnvironment.getApplication()
        val audio = context.getSystemService(AudioManager::class.java)
        audio.mode = AudioManager.MODE_IN_CALL
        assertFalse(ShellCallAudio(context).begin("call"))
        assertEquals(AudioManager.MODE_IN_CALL, audio.mode)
        audio.mode = AudioManager.MODE_NORMAL
    }

    @Test
    @Config(sdk = [31])
    fun cellularInterruptionKeepsItsDeviceAndModeWhenTheAppEnds() {
        val context = RuntimeEnvironment.getApplication()
        val audio = context.getSystemService(AudioManager::class.java)
        val speaker = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER).build()
        shadowOf(audio).setAvailableCommunicationDevices(listOf(speaker))
        val route = ShellCallAudio(context)
        assertEquals("system", route.route())
        assertTrue(route.begin("call"))
        audio.mode = AudioManager.MODE_IN_CALL
        audio.setCommunicationDevice(speaker)
        assertFalse(route.begin("call"))
        assertFalse(route.select("call", false))
        route.end("call")
        assertEquals(AudioManager.MODE_IN_CALL, audio.mode)
        assertEquals(speaker, audio.communicationDevice)
        audio.mode = AudioManager.MODE_NORMAL
    }

    @Test
    fun malformedBridgeRequestsCannotControlAudioAndResetRestoresTheme() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        var dark = false
        var surface = "page"
        val bridge =
            ShellDeviceBridge(activity, { ShellPolicy.ORIGIN }, { nextDark, nextSurface ->
                dark = nextDark
                surface = nextSurface
            })
        assertNull(bridge.receive("x".repeat(513)))
        assertNull(bridge.receive("not json"))
        assertNull(bridge.receive("{\"id\":\"bad id\",\"type\":\"begin-call\"}"))
        assertFalse(bridge.receive("{\"id\":\"r\",\"type\":\"begin-call\"}")!!.getBoolean("accepted"))
        assertFalse(bridge.receive("{\"id\":\"r\",\"type\":\"arbitrary-command\"}")!!.getBoolean("accepted"))
        assertTrue(bridge.receive("{\"id\":\"r\",\"type\":\"theme\",\"dark\":true}")!!.getBoolean("accepted"))
        assertTrue(dark)
        assertEquals("call", surface)
        assertTrue(bridge.receive("{\"id\":\"r\",\"type\":\"theme\",\"dark\":false,\"surface\":\"white\"}")!!.getBoolean("accepted"))
        assertEquals("white", surface)
        assertFalse(bridge.receive("{\"id\":\"r\",\"type\":\"theme\",\"dark\":false,\"surface\":\"arbitrary\"}")!!.getBoolean("accepted"))
        assertEquals("white", surface)
        bridge.reset()
        assertFalse(dark)
        assertEquals("page", surface)
    }
}
