package app.weiban.shell

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker.Result
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import app.weiban.contracts.NotificationEnvelope
import java.time.OffsetDateTime
import java.util.concurrent.TimeUnit

internal object ShellNotices {
    const val PERIODIC = "weiban-shell-notices-periodic"
    const val ONCE = "weiban-shell-notices-once"
    const val TAG = "weiban-shell-notices"

    fun permitted(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            (
                Build.VERSION.SDK_INT < 33 ||
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            )

    fun schedule(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<ShellNoticeWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).addTag(TAG).build(),
        )
        checkSoon(context)
    }

    fun checkSoon(
        context: Context,
        delaySeconds: Long = 0,
    ) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            ONCE,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ShellNoticeWorker>()
                .setInitialDelay(
                    delaySeconds,
                    TimeUnit.SECONDS,
                ).setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                ).setBackoffCriteria(BackoffPolicy.LINEAR, 20, TimeUnit.SECONDS)
                .addTag(TAG)
                .build(),
        )
    }

    fun stop(context: Context) {
        WorkManager.getInstance(context).cancelAllWorkByTag(TAG)
        NotificationManagerCompat.from(context).cancelAll()
    }

    fun owned(
        item: NotificationEnvelope,
        state: ShellNoticeState,
        now: Long,
    ): Boolean =
        runCatching {
            val sent = OffsetDateTime.parse(item.sentAt).toInstant().toEpochMilli()
            state.enabled && item.recipientUserId == state.auth.user.userId && item.recipientSessionId == state.auth.session.sessionId &&
                OffsetDateTime.parse(state.auth.session.expiresAt).toInstant().toEpochMilli() > now && sent <= now + 60000 &&
                now - sent <= 600000 &&
                item.kind != "admin_alert" && route(item.deepLink, item.conversationId) != null
        }.getOrDefault(false)

    fun route(
        path: String,
        conversationId: String? = null,
    ): String? {
        val fixed = path in setOf("/chat", "/wallet", "/models", "/services", "/moments")
        val match = Regex("^/(chat|moments/posts|play/letters|imports|support/tickets|calls)/([0-9a-fA-F-]{36})$").matchEntire(path)
        return when {
            fixed -> path
            match != null -> {
                val id = match.groupValues[2]
                val valid =
                    runCatching {
                        java.util.UUID
                            .fromString(id)
                            .toString()
                            .equals(id, true)
                    }.getOrDefault(false)
                val matchingConversation = match.groupValues[1] != "chat" || conversationId == null || conversationId == id
                path.takeIf { valid && matchingConversation }
            }
            else -> null
        }
    }

    @Suppress("MissingPermission")
    fun show(
        context: Context,
        item: NotificationEnvelope,
        state: ShellNoticeState,
    ) {
        check(permitted(context))
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = if (item.sound) "weiban_messages" else "weiban_messages_quiet"
        if (Build.VERSION.SDK_INT >=
            26
        ) {
            manager.createNotificationChannel(
                NotificationChannel(
                    channel,
                    if (item.sound) "新消息通知" else "静音消息通知",
                    if (item.sound) NotificationManager.IMPORTANCE_DEFAULT else NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    if (!item.sound) {
                        setSound(null, null)
                        enableVibration(false)
                    }
                },
            )
        }
        val intent =
            Intent(
                context,
                ShellActivity::class.java,
            ).addFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP,
            ).putExtra("noticeOwner", state.owner)
                .putExtra("noticeRoute", item.deepLink)
        val pending =
            PendingIntent.getActivity(
                context,
                item.collapseKey.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notice =
            NotificationCompat
                .Builder(
                    context,
                    channel,
                ).setSmallIcon(
                    R.drawable.shell_notice,
                ).setContentTitle(
                    item.title,
                ).setContentText(
                    item.body,
                ).setStyle(
                    NotificationCompat.BigTextStyle().bigText(item.body),
                ).setContentIntent(
                    pending,
                ).setAutoCancel(
                    true,
                ).setOnlyAlertOnce(true)
                .setSilent(!item.sound)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setNumber(item.count.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                .build()
        manager.notify(item.collapseKey, 1, notice)
    }
}

/** The OS may postpone this work in battery saving or force-stop; no persistent foreground service. */
class ShellNoticeWorker(
    context: Context,
    parameters: WorkerParameters,
) : Worker(context, parameters) {
    override fun doWork(): Result =
        ShellNoticeDelivery(applicationContext, ShellNoticeStore(applicationContext), ShellNoticeHttp()).run(runAttemptCount) {
            isStopped
        }
}

private class NoticeOwnerChanged : Exception()

internal class ShellNoticeDelivery(
    private val applicationContext: Context,
    private val store: ShellNoticeStore,
    private val http: ShellNoticeHttp,
) {
    fun run(
        attempt: Int = 0,
        stopped: () -> Boolean = { false },
    ): Result {
        val state =
            runCatching { store.read() }.getOrNull()?.takeIf {
                it.enabled && ShellNotices.permitted(applicationContext)
            } ?: return Result.success()
        return try {
            val items = http.poll(state)
            val acknowledged = items.filter { publish(it, state, stopped) }.map { it.notificationId }
            if (acknowledged.isNotEmpty()) http.acknowledge(state, acknowledged)
            if (items.isEmpty() && attempt < 3) Result.retry() else Result.success()
        } catch (
            _: NoticeOwnerChanged,
        ) {
            Result.success()
        } catch (error: NoticeHttpFailure) {
            httpFailure(state, error.status)
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun publish(
        item: NotificationEnvelope,
        expected: ShellNoticeState,
        stopped: () -> Boolean,
    ): Boolean =
        synchronized(ShellNoticeStore.lock) {
            val current = store.read()?.takeIf { it.owner == expected.owner && it.enabled } ?: throw NoticeOwnerChanged()
            if (stopped() || !ShellNotices.permitted(applicationContext)) throw NoticeOwnerChanged()
            val allowed = ShellNotices.owned(item, current, System.currentTimeMillis())
            if (allowed && item.notificationId !in current.seen) {
                ShellNotices.show(applicationContext, item, current)
                store.write(current.copy(seen = (current.seen + item.notificationId).takeLast(128)))
            }
            allowed
        }

    private fun httpFailure(
        expected: ShellNoticeState,
        status: Int,
    ): Result =
        if (status in setOf(401, 403, 404)) {
            synchronized(ShellNoticeStore.lock) {
                if (store.read()?.owner == expected.owner) {
                    store.clear()
                    ShellNotices.stop(applicationContext)
                }
            }
            Result.success()
        } else {
            Result.retry()
        }
}
