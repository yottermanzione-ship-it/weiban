package app.weiban.shell

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

internal class ShellUpdateProvider : FileProvider()

private const val APK_MIME = "application/vnd.android.package-archive"
private const val UPDATE_CACHE = "weiban-updates"
private const val MAX_APK_BYTES = 64L * 1024 * 1024

internal class ShellAppUpdates(
    private val activity: ComponentActivity,
    private val currentUrl: () -> String?,
) {
    private data class Pending(
        val id: String,
        val versionCode: Int,
        val url: String,
        val reply: JavaScriptReplyProxy,
        var call: Call? = null,
        var file: File? = null,
    )

    private val http =
        OkHttpClient
            .Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(120, TimeUnit.SECONDS)
            .build()
    private var active: Pending? = null
    private var awaitingPermission: Pending? = null
    private val permission =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            val pending = awaitingPermission
            awaitingPermission = null
            if (pending != null && active === pending) {
                if (mayInstall() && ShellPolicy.trusted(currentUrl())) {
                    download(pending)
                } else {
                    finish(pending, "permission_denied")
                }
            }
        }

    init {
        activity.lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) installReadyUpdate()
            },
        )
    }

    fun attach(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "weibanAppUpdate", setOf(ShellPolicy.ORIGIN)) { _, message, origin, mainFrame, reply ->
            if (mainFrame && ShellPolicy.trusted(origin.toString()) && ShellPolicy.trusted(currentUrl())) {
                receive(message.data, reply)
            }
        }
    }

    private fun receive(
        raw: String?,
        reply: JavaScriptReplyProxy,
    ) {
        val input = raw?.takeIf { it.length <= 1024 }?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        val id = input.optString("id")
        if (!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))) return
        val version = input.opt("versionCode") as? Int ?: 0
        val url = input.optString("url")
        when {
            version <= BuildConfig.VERSION_CODE || !ShellPolicy.appUpdate(url) -> respond(reply, id, "failed")
            active != null || awaitingPermission != null -> respond(reply, id, "busy")
            !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) -> respond(reply, id, "cancelled")
            else -> requestUpdate(Pending(id, version, url, reply))
        }
    }

    private fun requestUpdate(pending: Pending) {
        active = pending
        if (mayInstall()) {
            download(pending)
        } else {
            awaitingPermission = pending
            respond(pending.reply, pending.id, "permission")
            try {
                permission.launch(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts("package", activity.packageName, null)),
                )
            } catch (_: RuntimeException) {
                awaitingPermission = null
                finish(pending, "permission_denied")
            }
        }
    }

    private fun mayInstall(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()

    private fun download(pending: Pending) {
        respond(pending.reply, pending.id, "downloading")
        val call =
            http.newCall(
                Request
                    .Builder()
                    .url(pending.url)
                    .header("Accept", APK_MIME)
                    .build(),
            )
        pending.call = call
        call.enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) = received(pending, null)

                override fun onResponse(
                    call: Call,
                    response: Response,
                ) {
                    val file = response.use { runCatching { saveUpdate(it, pending.versionCode) }.getOrNull() }
                    received(pending, file)
                }
            },
        )
    }

    private fun received(
        pending: Pending,
        file: File?,
    ) {
        activity.runOnUiThread {
            if (active !== pending) {
                file?.delete()
                return@runOnUiThread
            }
            if (file == null) {
                finish(pending, "failed")
            } else {
                pending.file = file
                installReadyUpdate()
            }
        }
    }

    private fun saveUpdate(
        response: Response,
        versionCode: Int,
    ): File {
        val body = checkNotNull(response.body)
        check(response.code == 200 && response.header("Content-Type")?.substringBefore(';') == APK_MIME)
        val expectedSize = body.contentLength()
        check(expectedSize == -1L || expectedSize in 1..MAX_APK_BYTES)
        val directory = File(activity.cacheDir, UPDATE_CACHE)
        check(directory.isDirectory || directory.mkdirs())
        directory.listFiles()?.filter { it.name.startsWith("weiban-update-") }?.forEach { it.delete() }
        val file = File.createTempFile("weiban-update-", ".apk", directory)
        var verified = false
        try {
            var bytes = 0L
            val input = body.byteStream()
            file.outputStream().use { output ->
                val buffer = ByteArray(8192)
                var count = input.read(buffer)
                while (count != -1) {
                    bytes += count
                    check(bytes <= MAX_APK_BYTES)
                    output.write(buffer, 0, count)
                    count = input.read(buffer)
                }
            }
            check(bytes > 0 && (expectedSize == -1L || expectedSize == bytes))
            check(matchesInstalledApp(file, versionCode))
            verified = true
            return file
        } finally {
            if (!verified) file.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun matchesInstalledApp(
        file: File,
        versionCode: Int,
    ): Boolean {
        // Updates keep the original signing key, including on Android 7.
        val manager = activity.packageManager
        val archive = manager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNATURES) ?: return false
        val installed = manager.getPackageInfo(activity.packageName, PackageManager.GET_SIGNATURES)
        return matchesUpdatePackage(archive, installed, versionCode)
    }

    private fun installReadyUpdate() {
        val pending = active?.takeIf { activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) } ?: return
        val file = pending.file ?: return
        val status =
            when {
                !ShellPolicy.trusted(currentUrl()) -> "cancelled"
                !mayInstall() -> "permission_denied"
                openInstaller(file) -> {
                    // The system installer reads the file after launch. Keep it until the next download.
                    pending.file = null
                    "installer_opened"
                }
                else -> "failed"
            }
        finish(pending, status)
    }

    private fun openInstaller(file: File): Boolean =
        runCatching {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
            activity.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, APK_MIME)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            )
        }.isSuccess

    private fun finish(
        pending: Pending,
        status: String,
    ) {
        if (active !== pending) return
        active = null
        pending.file?.delete()
        respond(pending.reply, pending.id, status)
    }

    private fun respond(
        reply: JavaScriptReplyProxy,
        id: String,
        status: String,
    ) {
        runCatching { reply.postMessage(JSONObject().put("id", id).put("status", status).toString()) }
    }

    fun cancel() {
        active?.let { pending ->
            pending.call?.cancel()
            finish(pending, "cancelled")
        }
    }
}

@Suppress("DEPRECATION")
internal fun matchesUpdatePackage(
    archive: PackageInfo,
    installed: PackageInfo,
    expectedVersion: Int,
): Boolean {
    val version = PackageInfoCompat.getLongVersionCode(archive)
    val signers = archive.signatures?.toSet().orEmpty()
    return archive.packageName == installed.packageName &&
        version == expectedVersion.toLong() &&
        version > PackageInfoCompat.getLongVersionCode(installed) &&
        signers.isNotEmpty() && signers == installed.signatures?.toSet()
}
