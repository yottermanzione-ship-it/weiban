package app.weiban.shell

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.webkit.PermissionRequest
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

internal class ShellPermissions(
    private val activity: ComponentActivity,
    private val currentUrl: () -> String?,
) {
    private var pending: PermissionRequest? = null
    private var requesting = false
    private val launcher =
        activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            requesting = false
            val request = pending
            pending = null
            if (request != null) {
                if (granted && trusted(request)) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    request.deny()
                    if (!granted && !activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
                        showSettings()
                    }
                }
            }
        }

    fun request(request: PermissionRequest) {
        if (requesting) {
            request.deny()
            return
        }
        if (!trusted(request) || !request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            request.deny()
            return
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            pending = request
            requesting = true
            launcher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun canceled(request: PermissionRequest) {
        if (pending === request) pending = null
    }

    fun cancel() {
        pending?.deny()
        pending = null
    }

    private fun trusted(request: PermissionRequest): Boolean =
        ShellPolicy.trusted(request.origin.toString()) && ShellPolicy.trusted(currentUrl())

    private fun showSettings() {
        if (activity.isFinishing || activity.isDestroyed) return
        AlertDialog
            .Builder(activity)
            .setTitle("麦克风尚未允许")
            .setMessage("请在应用权限里允许微伴使用麦克风，再返回重新录音。文字聊天仍可使用。")
            .setNegativeButton("稍后", null)
            .setPositiveButton("打开设置") { _, _ ->
                activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${activity.packageName}".toUri()))
            }.show()
    }
}
