package app.weiban.shell

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.PermissionRequest
import androidx.activity.ComponentActivity
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ShellPermissionsTest {
    @Test
    fun packagedAppDeclaresBothPermissionsRequiredForCommunicationAudio() {
        val application = RuntimeEnvironment.getApplication()
        val declared =
            checkNotNull(
                application.packageManager.getPackageInfo(application.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions,
            )
        assertTrue(declared.contains(Manifest.permission.RECORD_AUDIO))
        assertTrue(declared.contains(Manifest.permission.MODIFY_AUDIO_SETTINGS))
    }

    private class Request(
        private val source: String = ShellPolicy.ORIGIN,
        private val requested: Array<String> = arrayOf(RESOURCE_AUDIO_CAPTURE),
    ) : PermissionRequest() {
        var allowed: Array<out String>? = null
        var denied = false

        override fun getOrigin(): Uri = Uri.parse(source)

        override fun getResources(): Array<String> = requested

        override fun grant(resources: Array<out String>) {
            allowed = resources
        }

        override fun deny() {
            denied = true
        }
    }

    @Test
    fun grantsOnlyMicrophoneEvenWhenThePageRequestsAdditionalCapabilities() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        val permissions = ShellPermissions(activity) { ShellPolicy.START_URL }
        shadowOf(activity.application).grantPermissions(Manifest.permission.RECORD_AUDIO)
        val request = Request(requested = arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE, PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        permissions.request(request)
        assertArrayEquals(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE), request.allowed)
        controller.destroy()
    }

    @Test
    fun refusesAnUntrustedFrameOrAnUntrustedCurrentPageEvenIfAndroidPreviouslyAllowedAudio() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        var page = ShellPolicy.START_URL
        val permissions = ShellPermissions(activity) { page }
        shadowOf(activity.application).grantPermissions(Manifest.permission.RECORD_AUDIO)
        val untrustedFrame = Request("https://example.com")
        permissions.request(untrustedFrame)
        assertTrue(untrustedFrame.denied)
        page = "https://example.com"
        val afterNavigation = Request()
        permissions.request(afterNavigation)
        assertTrue(afterNavigation.denied)
        assertNull(afterNavigation.allowed)
        controller.destroy()
    }

    @Test
    fun rejectsCameraOnlyAndUnknownResources() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val permissions = ShellPermissions(controller.get()) { ShellPolicy.START_URL }
        val request = Request(requested = arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE, "future-privileged-resource"))
        permissions.request(request)
        assertTrue(request.denied)
        assertNull(request.allowed)
        controller.destroy()
    }
}
