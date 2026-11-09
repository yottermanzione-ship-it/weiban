package app.weiban.shell

import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.Executors

/** Separate narrow bridge; neither the audio bridge nor notification registration is changed. */
internal class ShellLegacyFavoritesBridge(
    private val activity: ComponentActivity,
    private val currentUrl: () -> String?,
) {
    private val session by lazy {
        ShellLegacyFavoritesSession(
            ShellLegacyFavoritesStore(activity),
            ShellLegacyFavoritesHttp()::source,
            media = ShellLegacyFavoriteMedia(activity),
        )
    }
    private val executor = Executors.newSingleThreadExecutor()

    fun attach(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(
            webView,
            "weibanLegacyFavorites",
            setOf(ShellPolicy.ORIGIN),
        ) { _, message, origin, mainFrame, reply ->
            val call = session.prepare(message.data, origin.toString(), mainFrame, currentUrl()) ?: return@addWebMessageListener
            executor.execute {
                val result = session.execute(call)
                activity.runOnUiThread {
                    if (!activity.isDestroyed && ShellPolicy.trusted(currentUrl()) && session.current(call)) {
                        runCatching { reply.postMessage(result.toString()) }
                    }
                }
            }
        }
    }

    fun reset() {
        session.reset()
    }

    fun close() {
        reset()
        executor.shutdown()
    }
}
