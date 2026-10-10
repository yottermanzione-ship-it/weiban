package app.weiban.platform

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.work.*
import app.weiban.contracts.CallSession
import app.weiban.contracts.Endpoints
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/** 宿主（app）处理通知栏上的通话操作。 */
interface CallHost {
    fun onCallAction(
        action: String,
        sessionId: String,
        callId: String,
    )
}

/**
 * 通话相关的系统通知（MED-07 第 4 条、media-l5.md 7.2～7.3）：
 * - 来电：高优先级 + 全屏 Intent（锁屏 / 熄屏时直接显示来电页；用别的 App 时为顶部横幅带「拒绝」「接听」），30 秒后自动消失；
 * - 未接来电：「杨幂 · 未接来电」，点开进私聊；
 * - 通话中：前台服务常驻通知「与 杨幂 通话中 03:12」+「挂断」。
 * 所有 Intent 只带 callId / conversationId / sessionId，打开时由 MainActivity 核对当前账号。
 */
object CallNotices {
    const val ACTION_INCOMING = "app.weiban.CALL_INCOMING"
    const val ACTION_ANSWER = "app.weiban.CALL_ANSWER"
    const val ACTION_OPEN = "app.weiban.CALL_OPEN"
    const val ACTION_CHAT = "app.weiban.CALL_CHAT"
    const val EXTRA_CALL = "weibanCallId"
    const val EXTRA_SESSION = "weibanSessionId"
    const val EXTRA_CONVERSATION = "weibanConversationId"
    internal const val ACTION_DECLINE = "app.weiban.CALL_DECLINE"
    internal const val ACTION_HANGUP = "app.weiban.CALL_HANGUP"
    private const val CHANNEL_INCOMING = "weiban.calls.incoming"
    private const val CHANNEL_MISSED = "weiban.calls.missed"
    private const val CHANNEL_ONGOING = "weiban.calls.ongoing"
    private const val TAG_INCOMING = "weiban.call.incoming:"
    private const val TAG_MISSED = "weiban.call.missed:"
    internal const val ONGOING_ID = 7_301
    private const val RING_TIMEOUT_MS = 30_000L

    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

    private fun channels(context: Context) {
        val manager = manager(context)
        val incoming = NotificationChannel(CHANNEL_INCOMING, "来电", NotificationManager.IMPORTANCE_HIGH)
        incoming.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            AudioAttributes
                .Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        incoming.enableVibration(true)
        incoming.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        manager.createNotificationChannel(incoming)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_MISSED, "未接来电", NotificationManager.IMPORTANCE_DEFAULT))
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ONGOING, "通话中", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) },
        )
    }

    private fun activity(
        context: Context,
        activity: Class<*>,
        action: String,
        sessionId: String,
        callId: String?,
        conversationId: String? = null,
    ): PendingIntent {
        val intent =
            Intent(context, activity).apply {
                this.action = action
                data = Uri.parse("weiban-call:$action:${callId ?: conversationId.orEmpty()}")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
                putExtra(EXTRA_SESSION, sessionId)
                callId?.let { putExtra(EXTRA_CALL, it) }
                conversationId?.let { putExtra(EXTRA_CONVERSATION, it) }
            }
        return PendingIntent.getActivity(context, action.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun broadcast(
        context: Context,
        action: String,
        sessionId: String,
        callId: String,
    ): PendingIntent {
        val intent =
            Intent(context, CallActionReceiver::class.java).apply {
                this.action = action
                data = Uri.parse("weiban-call:$action:$callId")
                putExtra(EXTRA_SESSION, sessionId)
                putExtra(EXTRA_CALL, callId)
            }
        return PendingIntent.getBroadcast(context, action.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** 来电通知（系统通话样式）：全屏 Intent 打开来电页；「接听」直接打开应用接听，「拒绝」在后台回传服务器。 */
    internal fun showIncoming(
        context: Context,
        activity: Class<*>,
        owner: OwnerRecord,
        call: CallSession,
        name: String,
        icon: Bitmap,
    ) {
        channels(context)
        val person =
            Person
                .Builder()
                .setName(name)
                .setIcon(IconCompat.createWithBitmap(icon.copy(Bitmap.Config.ARGB_8888, false)))
                .setImportant(true)
                .build()
        val full = activity(context, activity, ACTION_INCOMING, owner.sessionId, call.callId)
        val notification =
            NotificationCompat
                .Builder(context, CHANNEL_INCOMING)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle(name)
                .setContentText("邀请你语音通话")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(RING_TIMEOUT_MS)
                .setContentIntent(full)
                .setFullScreenIntent(full, true)
                .setStyle(
                    NotificationCompat.CallStyle.forIncomingCall(
                        person,
                        broadcast(context, ACTION_DECLINE, owner.sessionId, call.callId),
                        activity(context, activity, ACTION_ANSWER, owner.sessionId, call.callId),
                    ),
                ).build()
        // 铃声在 30 秒内持续响（系统横幅也持续显示）。
        notification.flags = notification.flags or Notification.FLAG_INSISTENT
        manager(context).notify(TAG_INCOMING + call.callId, 1, notification)
        MissedCallWork.schedule(context, owner, call.callId, call.conversationId, name)
    }

    fun dismissIncoming(
        context: Context,
        callId: String,
    ) {
        manager(context).cancel(TAG_INCOMING + callId, 1)
    }

    internal fun showMissed(
        context: Context,
        activity: Class<*>,
        owner: OwnerRecord,
        callId: String,
        conversationId: String,
        name: String,
    ) {
        channels(context)
        val notification =
            NotificationCompat
                .Builder(context, CHANNEL_MISSED)
                .setSmallIcon(android.R.drawable.sym_call_missed)
                .setContentTitle(name)
                .setContentText("未接来电")
                .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(activity(context, activity, ACTION_CHAT, owner.sessionId, null, conversationId))
                .build()
        manager(context).notify(TAG_MISSED + callId, 1, notification)
    }

    /** 通话中常驻通知（前台服务保活，离开微伴通话继续）。connectedAtMs 为空时显示「正在呼叫」。 */
    internal fun ongoing(
        context: Context,
        activity: Class<*>,
        sessionId: String,
        callId: String?,
        name: String,
        connectedAtMs: Long?,
    ): Notification {
        channels(context)
        val builder =
            NotificationCompat
                .Builder(context, CHANNEL_ONGOING)
                .setSmallIcon(android.R.drawable.sym_action_call)
                .setContentTitle(if (connectedAtMs != null) "与 $name 通话中" else "正在呼叫 $name")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(activity(context, activity, ACTION_OPEN, sessionId, callId))
        if (connectedAtMs != null) {
            builder.setWhen(connectedAtMs).setUsesChronometer(true).setShowWhen(true)
        }
        if (callId != null) {
            builder.addAction(0, "挂断", broadcast(context, ACTION_HANGUP, sessionId, callId))
        }
        return builder.build()
    }

    /** 启动 / 更新前台服务（通话开始时由宿主调用，此时应用在前台）。 */
    fun startOngoing(
        context: Context,
        activity: Class<*>,
        sessionId: String,
        callId: String?,
        name: String,
        connectedAtMs: Long?,
    ) {
        val intent =
            Intent(context, CallForegroundService::class.java).apply {
                putExtra(CallForegroundService.EXTRA_ACTIVITY, activity.name)
                putExtra(EXTRA_SESSION, sessionId)
                putExtra(EXTRA_CALL, callId)
                putExtra(CallForegroundService.EXTRA_NAME, name)
                putExtra(CallForegroundService.EXTRA_CONNECTED, connectedAtMs ?: 0L)
            }
        ContextCompat.startForegroundService(context, intent)
    }

    fun stopOngoing(context: Context) {
        context.stopService(Intent(context, CallForegroundService::class.java))
    }

    /** 安卓 14 起全屏通知需要单独授权；没有时来电只以横幅出现。 */
    fun canUseFullScreen(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE || manager(context).canUseFullScreenIntent()
}

/** 通话前台服务：类型 microphone，保证切到后台、锁屏后录音与播放不被系统停掉。 */
class CallForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    @Suppress("TooGenericExceptionCaught") // A refused foreground start must not crash the call; audio continues while visible.
    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val data = intent ?: return stop()
        val activity = data.getStringExtra(EXTRA_ACTIVITY)?.let { name -> runCatching { Class.forName(name) }.getOrNull() } ?: return stop()
        val sessionId = data.getStringExtra(CallNotices.EXTRA_SESSION) ?: return stop()
        val notification =
            CallNotices.ongoing(
                this,
                activity,
                sessionId,
                data.getStringExtra(CallNotices.EXTRA_CALL),
                data.getStringExtra(EXTRA_NAME).orEmpty(),
                data.getLongExtra(EXTRA_CONNECTED, 0L).takeIf { it > 0L },
            )
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            ServiceCompat.startForeground(this, CallNotices.ONGOING_ID, notification, type)
        } catch (_: RuntimeException) {
            return stop()
        }
        return START_NOT_STICKY
    }

    private fun stop(): Int {
        stopSelf()
        return START_NOT_STICKY
    }

    companion object {
        internal const val EXTRA_ACTIVITY = "weibanActivity"
        internal const val EXTRA_NAME = "weibanCallName"
        internal const val EXTRA_CONNECTED = "weibanCallConnectedAt"
    }
}

/** 通知栏「拒绝」「挂断」：交给宿主（不打开界面）。 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val callId = intent.getStringExtra(CallNotices.EXTRA_CALL) ?: return
        val sessionId = intent.getStringExtra(CallNotices.EXTRA_SESSION) ?: return
        val host = context.applicationContext as? CallHost ?: return
        when (intent.action) {
            CallNotices.ACTION_DECLINE -> {
                CallNotices.dismissIncoming(context, callId)
                host.onCallAction("decline", sessionId, callId)
            }
            CallNotices.ACTION_HANGUP -> host.onCallAction("hangup", sessionId, callId)
        }
    }
}

/** 来电通知发出 31 秒后核对：仍是未接（missed）就留一条「未接来电」通知。 */
internal object MissedCallWork {
    fun schedule(
        context: Context,
        owner: OwnerRecord,
        callId: String,
        conversationId: String,
        name: String,
    ) {
        val request =
            OneTimeWorkRequestBuilder<MissedCallWorker>()
                .setInitialDelay(RING_CHECK_SEC, TimeUnit.SECONDS)
                .setInputData(
                    workDataOf(
                        "userId" to owner.userId,
                        "sessionId" to owner.sessionId,
                        "callId" to callId,
                        "conversationId" to conversationId,
                        "name" to name,
                    ),
                ).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork("weiban-missed-call:$callId", ExistingWorkPolicy.KEEP, request)
    }

    private const val RING_CHECK_SEC = 31L
}

class MissedCallWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
    @Suppress("TooGenericExceptionCaught") // Best-effort reminder; never retries beyond the call's lifetime.
    override suspend fun doWork(): Result {
        val host = applicationContext as? NativePushHost ?: return Result.failure()
        val userId = inputData.getString("userId") ?: return Result.failure()
        val sessionId = inputData.getString("sessionId") ?: return Result.failure()
        val owner = OwnerRecord(userId = userId, sessionId = sessionId)
        val callId = inputData.getString("callId") ?: return Result.failure()
        val conversationId = inputData.getString("conversationId") ?: return Result.failure()
        return try {
            host.prepareNativePush()
            host.push.missedCall(owner, callId, conversationId, inputData.getString("name").orEmpty())
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Result.success()
        }
    }
}

internal suspend fun fetchCall(
    repository: app.weiban.data.SessionRepository,
    owner: OwnerRecord,
    callId: String,
): CallSession =
    repository.call(
        Endpoints.callEndpointsGetCall,
        params = mapOf("callId" to callId),
        options = SessionCallOptions(owner = owner, networkOnly = true),
    )
