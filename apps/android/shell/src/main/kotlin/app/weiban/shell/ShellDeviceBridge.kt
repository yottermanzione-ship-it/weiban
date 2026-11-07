package app.weiban.shell

import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** A narrow origin-checked bridge; subframes and external pages cannot control device audio. */
internal class ShellDeviceBridge(
    activity: ComponentActivity,
    private val currentUrl: () -> String?,
    private val theme: (Boolean, String) -> Unit,
) {
    private val audio = ShellCallAudio(activity)

    fun attach(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "weibanDevice", setOf(ShellPolicy.ORIGIN)) { _, message, origin, mainFrame, reply ->
            if (!mainFrame || !ShellPolicy.trusted(origin.toString()) || !ShellPolicy.trusted(currentUrl())) return@addWebMessageListener
            val response = receive(message.data) ?: return@addWebMessageListener
            runCatching { reply.postMessage(response.toString()) }
        }
    }

    internal fun receive(raw: String?): JSONObject? {
        val data = parse(raw) ?: return null
        return JSONObject()
            .put("id", data.optString("id"))
            .put("accepted", perform(data))
            .put("route", audio.route())
            .put("canSwitch", audio.switchAvailable())
    }

    private fun parse(raw: String?): JSONObject? {
        if (raw == null || raw.length > 512) return null
        return runCatching { JSONObject(raw) }.getOrNull()?.takeIf { validCall(it.optString("id")) }
    }

    private fun perform(data: JSONObject): Boolean {
        val callId = data.optString("callId")
        return when (data.optString("type")) {
            "theme" -> {
                val surface = data.optString("surface", if (data.optBoolean("dark")) "call" else "page")
                if (data.opt("dark") !is Boolean || surface !in setOf("page", "white", "call")) {
                    false
                } else {
                    theme(data.getBoolean("dark"), surface)
                    true
                }
            }
            "begin-call" -> validCall(callId) && audio.begin(callId)
            "speaker" -> validCall(callId) && data.opt("enabled") is Boolean && audio.select(callId, data.getBoolean("enabled"))
            "end-call" -> {
                if (validCall(callId)) audio.end(callId)
                true
            }
            "status" -> true
            else -> false
        }
    }

    fun reset() {
        audio.end()
        theme(false, "page")
    }

    private fun validCall(id: String): Boolean = id.matches(Regex("[a-zA-Z0-9-]{1,64}"))
}
