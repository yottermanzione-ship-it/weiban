package app.weiban.paymentmonitor

import android.Manifest
import android.app.*
import android.content.*
import android.graphics.Color
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var pairing: EditText
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { renderStatus(); handler.postDelayed(this, 2000) } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) // Pairing code stays out of screenshots/recent tasks.
        val outer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(245,245,245)); setPadding(24,24,24,24) }
        outer.setOnApplyWindowInsetsListener { v, insets ->
            val top = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars()).top else insets.systemWindowInsetTop
            val bottom = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars()).bottom else insets.systemWindowInsetBottom
            v.setPadding(24, top + 24,24,bottom + 24); insets
        }
        val scroll = ScrollView(this).apply { addView(outer) }; setContentView(scroll)
        fun text(value: String, size: Float = 16f): TextView = TextView(this).apply { text = value; textSize = size; setTextColor(Color.rgb(30,30,30)); setPadding(0,14,0,14); outer.addView(this) }
        text("微伴收款监控", 26f)
        text("只在收款手机使用。处理微信、支付宝收款通知并签名报账；不保存通知原文，不读取短信、联系人及其他应用通知。")
        status = text("正在读取状态…")
        pairing = EditText(this).apply { hint = "粘贴后台配对信息"; maxLines = 4; isSaveEnabled = false; importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO; outer.addView(this) }
        fun button(title: String, click: () -> Unit) { outer.addView(Button(this).apply { text = title; setOnClickListener { click() } }) }
        button("配对这台手机") {
            val code = pairing.text.toString()
            Delivery.pair(this, code) { error ->
                if (isFinishing || isDestroyed) return@pair
                if (error == null) { pairing.text.clear(); alert("配对成功，请回后台将这台手机设为唯一监控，再开启下方监听。") }
                else alert(error)
                renderStatus()
            }
        }
        button("开启通知使用权") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        button("开始监控与补报") {
            if (QueueStore.deviceId(this).isEmpty()) { alert("请先配对，再到后台启用这台手机"); return@button }
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 51)
            try { startForegroundService(Intent(this, MonitorService::class.java)); Delivery.start(this) }
            catch (_: Exception) { alert("系统未允许后台监控，请检查应用电池和通知设置") }
        }
        button("立即检查连接并补报") { Delivery.start(this); renderStatus() }
        button("手机后台运行设置") { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        text("请保持收款应用已登录、收款通知已开启、手机联网。系统限制后台运行时，服务端会暂停新订单；重启后检查这里的状态。两种支付通知都要分别进行小额实际验收。")
        text("后台位置：用户 → 扫码收款\n同一时间只启用一台监控手机。更换设备前先处理待补报记录，勿清除应用数据。", 14f)
    }
    private fun renderStatus() {
        val count = try { QueueStore.pending(this).size.toString() } catch (_: Exception) { "无法读取（已保留）" }
        status.text = "配对：${if (QueueStore.deviceId(this).isEmpty()) "未配对" else "已配对"}\n通知监听：${if (ReceiptListener.connected) "已连接" else "未连接"}\n待补报：$count\n未能识别的支付应用通知：${QueueStore.prefs(this).getInt("unrecognized",0)}（请核对账单）\n${QueueStore.lastStatus(this)}"
    }
    private fun alert(message: String) { AlertDialog.Builder(this).setTitle("提示").setMessage(message).setPositiveButton("知道了", null).show() }
    override fun onResume() { super.onResume(); handler.post(refresh) }
    override fun onPause() { handler.removeCallbacks(refresh); super.onPause() }
}
