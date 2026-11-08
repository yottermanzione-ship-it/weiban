package app.weiban.paymentmonitor

import android.Manifest
import android.app.*
import android.content.*
import android.graphics.Color
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var history: TextView
    private lateinit var setupPanel: LinearLayout
    private var startAfterPermission = false
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { renderStatus(); handler.postDelayed(this, 2000) } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val outer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(245,245,245)); setPadding(24,24,24,24) }
        outer.setOnApplyWindowInsetsListener { v, insets ->
            val top = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars()).top else insets.systemWindowInsetTop
            val bottom = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars()).bottom else insets.systemWindowInsetBottom
            v.setPadding(24, top + 24,24,bottom + 24); insets
        }
        setContentView(ScrollView(this).apply { addView(outer) })
        fun text(value: String, size: Float = 16f, parent: LinearLayout = outer): TextView = TextView(this).apply {
            text = value; textSize = size; setTextColor(Color.rgb(30,30,30)); setPadding(0,14,0,14); parent.addView(this)
        }
        fun button(title: String, parent: LinearLayout = outer, click: () -> Unit): Button = Button(this).apply {
            text = title; setOnClickListener { click() }; parent.addView(this)
        }
        text("微伴收款监控", 26f)
        text("版本 ${packageManager.getPackageInfo(packageName, 0).versionName}", 14f)
        status = text("正在读取状态…")
        setupPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; outer.addView(this) }
        text("首次使用：粘贴后台的连接码，保存一次即可。已经设置过的手机覆盖安装会保留设置。", parent = setupPanel)
        val pairing = EditText(this).apply {
            hint = "连接码（不是网址）"; maxLines = 4; isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO; setupPanel.addView(this)
        }
        val save = button("保存设置", setupPanel) {}
        save.setOnClickListener {
            save.isEnabled = false
            Delivery.pair(this, pairing.text.toString()) { error ->
                if (isFinishing || isDestroyed) return@pair
                save.isEnabled = true
                if (error == null) { pairing.text.clear(); alert(QueueStore.lastStatus(this)) } else alert(error)
                renderStatus()
            }
        }
        button("开始监控") { startMonitoring() }
        button("检查连接并补报") {
            if (QueueStore.deviceId(this).isEmpty()) alert("请先保存连接设置")
            else { ReceiptListener.scan(this); Delivery.start(this); renderStatus() }
        }
        text("最近到账", 20f)
        history = text("尚无到账记录")
        text("到账后自动对应订单，区分积分充值和会员购买。未匹配的记录显示“待核对”，请到后台对照账单。", 14f)
        button("通知权限") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        button("后台运行设置") { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        text("保持微信、支付宝已登录且收款通知开启。仅处理这两个应用的到账通知，不保存通知原文；软件或系统断开监听时，会暂停新订单。", 14f)
    }
    private fun listenerAllowed(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners").orEmpty()
        val component = ComponentName(this, ReceiptListener::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == component }
    }
    private fun startMonitoring() {
        if (QueueStore.deviceId(this).isEmpty()) { alert("请先保存连接设置"); return }
        if (!listenerAllowed()) {
            AlertDialog.Builder(this).setTitle("开启通知使用权").setMessage("允许微伴收款监控读取到账通知，设置完成返回后会开始监控。")
                .setNegativeButton("暂不开启", null).setPositiveButton("去开启") { _, _ ->
                    startAfterPermission = true; startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }.show()
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 51)
        try {
            startForegroundService(Intent(this, MonitorService::class.java))
            ReceiptListener.scan(this); Delivery.start(this)
        } catch (_: Exception) { alert("系统未允许后台监控，请检查应用电池和通知设置") }
    }
    private fun time(iso: String): String = try {
        DateTimeFormatter.ofPattern("MM-dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(iso))
    } catch (_: Exception) { "时间待核对" }
    private fun renderStatus() {
        setupPanel.visibility = if (QueueStore.deviceId(this).isEmpty()) View.VISIBLE else View.GONE
        val prefs = QueueStore.prefs(this)
        val count = try { QueueStore.pending(this).size.toString() } catch (_: Exception) { "无法读取（已保留）" }
        val connectedAt = prefs.getLong("connectedAt", 0)
        val connection = if (connectedAt == 0L) "尚未连接服务器" else "最近连接：${time(Instant.ofEpochMilli(connectedAt).toString())}"
        val retryWarning = if (prefs.getBoolean("retryUnavailable", false)) "\n后台补报未能安排，到账记录仍保留；请保持应用打开，点“检查连接并补报”重试。" else ""
        status.text = "设置：${if (QueueStore.deviceId(this).isEmpty()) "未设置" else "已保存，无需重复设置"}\n通知监听：${if (ReceiptListener.connected) "已连接" else "未连接"}\n$connection\n待补报：$count\n${QueueStore.lastStatus(this)}$retryWarning"
        val unknown = prefs.getInt("unrecognized",0)
        if (unknown > 0) status.append("\n未能识别的支付通知：$unknown（请核对账单）")
        history.text = try {
            val data = QueueStore.read(this)
            if (data.length() == 0) "尚无到账记录" else (maxOf(0, data.length() - 10) until data.length()).reversed().joinToString("\n\n") { i ->
                val event = data.getJSONObject(i)
                val kind = when(event.optString("purchaseKind")) { "recharge" -> "积分充值"; "membership" -> "会员购买"; else -> "待核对" }
                val result = if (!event.getBoolean("accepted")) "待补报" else when(event.optString("status")) { "matched" -> kind; "ignored" -> "已忽略"; else -> "待核对" }
                "${time(event.getString("postedAt"))}  ${if (event.getString("channel") == "wechat") "微信" else "支付宝"}  ¥${String.format(Locale.CHINA, "%.2f", event.getInt("amountFen") / 100.0)}\n$result"
            }
        } catch (_: Exception) { "到账记录暂时无法读取，原记录已保留，请核对后台" }
    }
    private fun alert(message: String) { AlertDialog.Builder(this).setTitle("提示").setMessage(message).setPositiveButton("知道了", null).show() }
    override fun onResume() {
        super.onResume(); handler.post(refresh)
        if (startAfterPermission) { startAfterPermission = false; if (listenerAllowed()) startMonitoring() }
    }
    override fun onPause() { handler.removeCallbacks(refresh); super.onPause() }
}
