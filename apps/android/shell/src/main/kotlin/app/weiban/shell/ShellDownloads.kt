package app.weiban.shell

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Base64
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.Executors

internal class ShellDownloads(
    private val activity: ComponentActivity,
    private val currentUrl: () -> String?,
) {
    private data class Download(
        val id: String,
        val bytes: ByteArray,
        val reply: JavaScriptReplyProxy,
    )

    private var pending: Download? = null
    private val writer = Executors.newSingleThreadExecutor()
    private val launcher =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val download = pending
            pending = null
            if (download != null) {
                val uri = result.data?.data
                if (result.resultCode != Activity.RESULT_OK || uri?.scheme != "content") {
                    reply(download, "cancelled")
                } else {
                    writer.execute {
                        val status =
                            try {
                                checkNotNull(activity.contentResolver.openOutputStream(uri, "wt")).use { it.write(download.bytes) }
                                "saved"
                            } catch (_: Exception) {
                                "failed"
                            }
                        activity.runOnUiThread { reply(download, status) }
                    }
                }
            }
        }

    fun attach(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "weibanShell", setOf(ShellPolicy.ORIGIN)) { _, message, origin, mainFrame, reply ->
            if (mainFrame && ShellPolicy.trusted(origin.toString()) && ShellPolicy.trusted(currentUrl())) {
                receive(message.data, reply)
            }
        }
    }

    private fun receive(
        raw: String?,
        reply: JavaScriptReplyProxy,
    ) {
        val bounded = raw?.takeIf { it.length <= ShellPolicy.MAX_DOWNLOAD_BYTES * 4 / 3 + 4096 }
        val data = bounded?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        val id = data.optString("id")
        if (!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))) return
        val bytes = imageBytes(data)
        if (pending != null || data.optString("type") != "save-image" || bytes == null) {
            respond(reply, id, "failed")
        } else {
            pending = Download(id, bytes, reply)
            showSaveDialog(data)
        }
    }

    private fun imageBytes(data: JSONObject): ByteArray? =
        if (data.optString("mime") !in ShellPolicy.imageTypes) {
            null
        } else {
            runCatching { Base64.decode(data.getString("base64"), Base64.NO_WRAP) }
                .getOrNull()
                ?.takeIf { it.isNotEmpty() && it.size <= ShellPolicy.MAX_DOWNLOAD_BYTES }
        }

    private fun showSaveDialog(data: JSONObject) {
        val mime = data.optString("mime")
        val intent =
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_TITLE, ShellPolicy.fileName(data.optString("name"), mime))
            }
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            cancel()
        }
    }

    private fun respond(
        proxy: JavaScriptReplyProxy,
        id: String,
        status: String,
    ) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            runCatching { proxy.postMessage(JSONObject().put("id", id).put("status", status).toString()) }
        }
    }

    private fun reply(
        download: Download,
        status: String,
    ) {
        respond(download.reply, download.id, status)
        download.bytes.fill(0)
    }

    fun cancel() {
        pending?.let { reply(it, "cancelled") }
        pending = null
    }

    fun close() {
        cancel()
        writer.shutdown()
    }
}
