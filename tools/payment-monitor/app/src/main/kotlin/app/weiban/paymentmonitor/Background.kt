package app.weiban.paymentmonitor

import android.app.*
import android.app.job.*
import android.content.*
import android.os.*
import android.service.notification.NotificationListenerService
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object Delivery {
    private val executor = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)
    fun start(ctx: Context, done: (() -> Unit)? = null) {
        val app = ctx.applicationContext
        if (!running.compareAndSet(false, true)) { done?.invoke(); return }
        executor.execute {
            val lock = (app.getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "weiban:receipts")
            try {
                lock.acquire(60_000)
                if (QueueStore.deviceId(app).isEmpty()) return@execute
                val queue = QueueStore.pending(app)
                MonitorApi.report(app, JSONObject().put("type", "heartbeat").put("listenerConnected", ReceiptListener.connected).put("queued", queue.size))
                // Bound one upload burst; queued work remains persisted for the next pass.
                for (event in queue.take(10)) {
                    val payload = JSONObject().apply { for (key in listOf("type", "eventId", "channel", "amountFen", "observedAt", "postedAt")) put(key, event.get(key)) }
                    if (event.has("reviewReason")) payload.put("reviewReason", event.getString("reviewReason"))
                    val result = MonitorApi.report(app, payload)
                    QueueStore.accept(app, event.getString("eventId"), result)
                    if (result.optString("status") == "review") QueueStore.prefs(app).edit().putBoolean("reviewPending", true).commit()
                }
                QueueStore.prefs(app).edit().putLong("connectedAt", System.currentTimeMillis()).commit()
                QueueStore.status(app, if (!ReceiptListener.connected) "服务器连接正常；通知监听未连接，尚不能监控到账"
                    else if (QueueStore.prefs(app).getBoolean("reviewPending", false)) "监控已连接；有到账需要到后台核对"
                    else "通知监听与服务器均已连接")
            } catch (_: java.io.IOException) { QueueStore.status(app, "网络未连通，到账记录保留待补报") }
            catch (e: IllegalStateException) { QueueStore.status(app, e.message?.takeIf { it.startsWith("后台") || it.startsWith("到账标识") || it.startsWith("服务器") } ?: "本地记录或签名暂不可用，已保留数据，请核对") }
            catch (_: Exception) { QueueStore.status(app, "本地记录或签名暂不可用，已保留数据，请核对") }
            finally { if (lock.isHeld) lock.release(); running.set(false); RetryJob.schedule(app); done?.invoke() }
        }
    }
    fun pair(ctx: Context, code: String, callback: (String?) -> Unit) {
        executor.execute {
            val error = try { MonitorApi.pair(ctx.applicationContext, code); null }
            catch (_: java.io.IOException) { "连接失败，请检查网络后重试，配对信息不会保存" }
            catch (e: IllegalArgumentException) { e.message }
            catch (e: IllegalStateException) { e.message }
            catch (_: Exception) { "配对未完成，请检查手机系统密钥存储是否可用" }
            Handler(Looper.getMainLooper()).post { callback(error) }
        }
    }
}

class MonitorService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val beat = object : Runnable { override fun run() { Delivery.start(this@MonitorService); handler.postDelayed(this, 45_000) } }
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("receipts", "收款监控运行状态", NotificationManager.IMPORTANCE_LOW))
        val intent = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, "receipts").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("微伴收款监控运行中").setContentText("点开查看监听、连接与待补报状态").setContentIntent(intent).setOngoing(true).build()
        startForeground(41, notification)
        handler.post(beat)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onDestroy() { handler.removeCallbacks(beat); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
class RetryJob : JobService() {
    companion object {
        fun schedule(ctx: Context) {
            if (QueueStore.deviceId(ctx).isEmpty()) return
            // This also runs in Delivery's finally block and in the boot receiver.
            // A rejected job must not escape those callbacks and kill the monitor process.
            val scheduled = try {
                val scheduler = ctx.getSystemService(JobScheduler::class.java)
                scheduler.schedule(JobInfo.Builder(82, ComponentName(ctx, RetryJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(60_000).setPersisted(true).build()) == JobScheduler.RESULT_SUCCESS
            } catch (_: RuntimeException) { false }
            // Keep this separate from the connection/receipt status; never discard queued receipts.
            QueueStore.prefs(ctx).edit().putBoolean("retryUnavailable", !scheduled).commit()
        }
    }
    override fun onStartJob(params: JobParameters): Boolean { Delivery.start(this) { jobFinished(params, false) }; return true }
    override fun onStopJob(params: JobParameters): Boolean = true
}
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        RetryJob.schedule(ctx)
        NotificationListenerService.requestRebind(ComponentName(ctx, ReceiptListener::class.java))
        // No background FGS start: device restrictions differ. User can resume from the visible app.
    }
}
