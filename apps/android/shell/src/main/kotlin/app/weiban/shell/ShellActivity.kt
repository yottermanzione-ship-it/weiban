package app.weiban.shell

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.graphics.Insets
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class ShellActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var errorPanel: LinearLayout
    private lateinit var progress: ProgressBar
    private val microphone = ShellPermissions(this) { currentUrl() }
    private val files = ShellFilePicker(this) { currentUrl() }
    private val downloads = ShellDownloads(this) { currentUrl() }
    private lateinit var root: FrameLayout
    private val device by lazy { ShellDeviceBridge(this, { currentUrl() }, { dark, surface -> applySystemTheme(dark, surface) }) }
    private var lastPage = ShellPolicy.START_URL

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        webView = WebView(this)
        root = createLayout()
        setContentView(root)
        applySystemTheme(false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            // Native padding already protects the WebView; forward zeroes so CSS/IME do not add it again.
            WindowInsetsCompat
                .Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
                    Insets.NONE,
                ).setInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                .build()
        }
        configureWebView()
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
                }
            },
        )
        val restored = savedInstanceState?.let { webView.restoreState(it) }
        if (restored == null || !ShellPolicy.trusted(webView.url)) webView.loadUrl(ShellPolicy.START_URL)
    }

    private fun createLayout(): FrameLayout {
        val root = FrameLayout(this)
        root.setBackgroundColor(0xffededed.toInt())
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        root.addView(progress, FrameLayout.LayoutParams(-1, (3 * resources.displayMetrics.density).toInt(), Gravity.TOP))
        errorPanel = LinearLayout(this)
        errorPanel.orientation = LinearLayout.VERTICAL
        errorPanel.gravity = Gravity.CENTER
        errorPanel.setPadding(32, 32, 32, 32)
        errorPanel.setBackgroundColor(0xffededed.toInt())
        val explanation = TextView(this)
        explanation.setText(R.string.shell_connection_error)
        explanation.gravity = Gravity.CENTER
        explanation.textSize = 17f
        errorPanel.addView(explanation)
        val retry = Button(this)
        retry.text = "重新连接"
        retry.setOnClickListener { webView.loadUrl(lastPage) }
        errorPanel.addView(retry)
        errorPanel.visibility = View.GONE
        root.addView(errorPanel, FrameLayout.LayoutParams(-1, -1))
        return root
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            mediaPlaybackRequiresUserGesture = true
            userAgentString += " WeibanShell/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        downloads.attach(webView)
        device.attach(webView)
        webView.webViewClient = navigationClient()
        webView.webChromeClient = chromeClient()
        webView.setDownloadListener { _, _, _, _, _ ->
            Toast.makeText(this, "请使用页面里的保存图片按钮，暂不支持此类下载。", Toast.LENGTH_LONG).show()
        }
    }

    private fun navigationClient(): WebViewClient =
        object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (ShellPolicy.trusted(request.url.toString())) return false
                if (request.isForMainFrame && request.hasGesture()) openExternal(request.url.toString())
                return true
            }

            override fun onPageStarted(
                view: WebView,
                url: String?,
                favicon: Bitmap?,
            ) {
                microphone.cancel()
                files.cancel()
                downloads.cancel()
                device.reset()
                if (!ShellPolicy.trusted(url)) {
                    view.stopLoading()
                    return
                }
                lastPage = checkNotNull(url)
                errorPanel.visibility = View.GONE
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(
                view: WebView,
                url: String?,
            ) {
                progress.visibility = View.GONE
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) errorPanel.visibility = View.VISIBLE
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse,
            ) {
                if (request.isForMainFrame && response.statusCode >= 400) errorPanel.visibility = View.VISIBLE
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: SslError,
            ) {
                handler.cancel()
                errorPanel.visibility = View.VISIBLE
            }
        }

    private fun chromeClient(): WebChromeClient =
        object : WebChromeClient() {
            override fun onProgressChanged(
                view: WebView,
                newProgress: Int,
            ) {
                progress.progress = newProgress
            }

            override fun onPermissionRequest(request: PermissionRequest) = microphone.request(request)

            override fun onPermissionRequestCanceled(request: PermissionRequest) = microphone.canceled(request)

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean = files.open(callback, params)

            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message,
            ): Boolean {
                if (!isUserGesture) return false
                // A one-use view discovers the target without exposing the authenticated view or any bridge.
                val target = WebView(this@ShellActivity)
                target.settings.allowFileAccess = false
                target.settings.allowContentAccess = false
                target.webViewClient =
                    object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean {
                            val url = request.url.toString()
                            if (ShellPolicy.trusted(url)) webView.loadUrl(url) else openExternal(url)
                            target.destroy()
                            return true
                        }
                    }
                (resultMsg.obj as WebView.WebViewTransport).webView = target
                resultMsg.sendToTarget()
                return true
            }
        }

    private fun openExternal(url: String) {
        if (!ShellPolicy.external(url)) return
        AlertDialog
            .Builder(this)
            .setTitle("打开外部网页")
            .setMessage("将用浏览器打开 ${url.toUri().host}，可用返回键回到微伴。")
            .setNegativeButton("取消", null)
            .setPositiveButton("打开") { _, _ ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (_: ActivityNotFoundException) {
                    Toast.makeText(this, "请先安装可用的浏览器", Toast.LENGTH_LONG).show()
                }
            }.show()
    }

    private fun currentUrl(): String? = if (::webView.isInitialized) webView.url else null

    @Suppress("DEPRECATION") // Before enforced edge-to-edge, clear the default system scrim too.
    private fun applySystemTheme(dark: Boolean, surface: String = "page") {
        if (!::root.isInitialized) return
        root.setBackgroundColor(
            when (surface) {
                "call" -> 0xff252a30.toInt()
                "white" -> if (dark) 0xff191919.toInt() else Color.WHITE
                else -> if (dark) 0xff202020.toInt() else 0xffededed.toInt()
            },
        )
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onPause() {
        webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onDestroy() {
        microphone.cancel()
        files.cancel()
        downloads.close()
        device.reset()
        (webView.parent as? FrameLayout)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
