package app.weiban.shell

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.Executors

private typealias NoticeAnswer = (Boolean, Boolean, String?) -> Unit

/** Origin-limited native notification bridge; late registration cannot revive a cleared account. */
internal class ShellNoticeBridge(
    private val activity: ComponentActivity,
    private val currentUrl: () -> String?,
) {
    // Activity construction precedes attachBaseContext; initialize storage only after attachment.
    private val store by lazy { ShellNoticeStore(activity) }
    private val executor = Executors.newSingleThreadExecutor()

    @Volatile private var generation = 0
    private var bindingOwner: String? = null
    private var permissionDone: ((Boolean) -> Unit)? = null
    private val permission =
        activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            permissionDone?.also { permissionDone = null }?.invoke(granted)
        }

    fun attach(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(
            webView,
            "weibanNotifications",
            setOf(ShellPolicy.ORIGIN),
        ) { _, message, origin, mainFrame, reply ->
            if (!mainFrame || !ShellPolicy.trusted(origin.toString()) || !ShellPolicy.trusted(currentUrl())) return@addWebMessageListener
            val data = parse(message.data) ?: return@addWebMessageListener
            val answer: NoticeAnswer = { ok, enabled, reason -> respond(reply, data, ok, enabled, reason) }
            try {
                dispatch(data, answer)
            } catch (_: Exception) {
                answer(false, false, "failed")
            }
        }
    }

    private fun parse(raw: String?): JSONObject? =
        runCatching {
            raw?.takeIf { it.length <= 20000 }?.let(::JSONObject)?.takeIf {
                it.optString("id").matches(Regex("[a-zA-Z0-9-]{1,64}"))
            }
        }.getOrNull()

    private fun respond(
        reply: JavaScriptReplyProxy,
        data: JSONObject,
        ok: Boolean,
        enabled: Boolean,
        reason: String?,
    ) {
        activity.runOnUiThread {
            if (!activity.isDestroyed && ShellPolicy.trusted(currentUrl())) {
                runCatching {
                    val result = JSONObject().put("id", data.getString("id")).put("ok", ok).put("enabled", enabled)
                    if (reason != null) result.put("reason", reason)
                    if (ok) consumeRoute(data)?.let { result.put("route", it) }
                    reply.postMessage(result.toString())
                }
            }
        }
    }

    private fun consumeRoute(data: JSONObject): String? {
        val owner = data.optString("owner")
        val eligible = data.optString("type") in setOf("resume", "enable") && owner.isNotEmpty()
        val matches = owner == activity.intent.getStringExtra("noticeOwner") && store.read()?.owner == owner
        return if (eligible && matches) {
            val route = activity.intent.getStringExtra("noticeRoute")?.let { ShellNotices.route(it) }
            activity.intent.removeExtra("noticeOwner")
            activity.intent.removeExtra("noticeRoute")
            route
        } else {
            null
        }
    }

    private fun dispatch(
        data: JSONObject,
        answer: NoticeAnswer,
    ) {
        val owner = data.optString("owner")
        when (data.optString("type")) {
            "enable" -> enable(data, answer)
            "resume" -> resume(data, answer)
            "status" -> answer(true, enabled(owner), null)
            "disable" -> {
                disable(owner)
                answer(true, false, null)
            }
            "check" -> {
                if (enabled(owner)) ShellNotices.checkSoon(activity)
                answer(true, false, null)
            }
            "settings" -> {
                openSettings()
                answer(true, false, null)
            }
            else -> answer(false, false, "unsupported")
        }
    }

    private fun enabled(owner: String): Boolean =
        store.read()?.let {
            it.owner == owner && it.enabled && ShellNotices.permitted(activity)
        } == true

    private fun resume(
        data: JSONObject,
        answer: NoticeAnswer,
    ) {
        val auth = parseNoticeAuth(data.getJSONObject("auth").toString())
        val owner = auth.user.userId + ":" + auth.session.sessionId
        require(data.getString("owner") == owner)
        bindingOwner?.takeIf { it != owner }?.let(::disable)
        store
            .read()
            ?.owner
            ?.takeIf { it != owner }
            ?.let(::disable)
        val enabled = enabled(owner)
        if (enabled) ShellNotices.schedule(activity)
        answer(true, enabled, null)
    }

    private fun openSettings() {
        val intent =
            if (Build.VERSION.SDK_INT >= 26) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + activity.packageName))
            }
        activity.startActivity(intent)
    }

    private fun enable(
        data: JSONObject,
        answer: NoticeAnswer,
    ) {
        if (bindingOwner != null) {
            answer(false, false, "busy")
            return
        }
        val raw = data.getJSONObject("auth").toString()
        val auth = parseNoticeAuth(raw)
        val owner = auth.user.userId + ":" + auth.session.sessionId
        require(data.getString("owner") == owner)
        val old = store.read()
        if (old != null && old.owner != owner) disable(old.owner)
        bindingOwner = owner
        val epoch = ++generation
        val seen = old?.takeIf { it.owner == owner }?.seen ?: emptyList()
        val start: (Boolean) -> Unit = { granted ->
            if (granted && ShellNotices.permitted(activity)) {
                executor.execute { register(ShellNoticeState(auth, raw, "", true, seen), epoch, answer) }
            } else {
                bindingOwner = null
                answer(false, false, "permission")
            }
        }
        if (Build.VERSION.SDK_INT >= 33 && !ShellNotices.permitted(activity)) {
            permissionDone = start
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            start(ShellNotices.permitted(activity))
        }
    }

    private fun register(
        candidate: ShellNoticeState,
        epoch: Int,
        answer: NoticeAnswer,
    ) {
        try {
            val http = ShellNoticeHttp()
            val bound = candidate.copy(deviceId = http.register(candidate.auth, store.installation()))
            val accepted =
                synchronized(ShellNoticeStore.lock) {
                    if (generation != epoch || activity.isDestroyed) {
                        false
                    } else {
                        store.write(bound)
                        ShellNotices.schedule(activity)
                        true
                    }
                }
            if (!accepted) runCatching { http.unregister(bound) }
            answer(accepted, accepted, if (accepted) null else "changed")
        } catch (
            _: Exception,
        ) {
            answer(false, false, "failed")
        } finally {
            activity.runOnUiThread { if (generation == epoch) bindingOwner = null }
        }
    }

    private fun disable(owner: String) {
        val old =
            synchronized(ShellNoticeStore.lock) {
                if (bindingOwner == owner) {
                    generation++
                    bindingOwner = null
                }
                store.read()?.takeIf { it.owner == owner }?.also {
                    store.clear()
                    ShellNotices.stop(activity)
                }
            }
        if (old != null) executor.execute { runCatching { ShellNoticeHttp().unregister(old) } }
    }

    fun background() {
        if (runCatching { store.read()?.enabled }.getOrNull() == true) ShellNotices.checkSoon(activity, 20)
    }

    fun close() {
        generation++
        permissionDone = null
        executor.shutdown()
    }
}
