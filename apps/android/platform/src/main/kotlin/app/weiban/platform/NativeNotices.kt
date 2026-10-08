package app.weiban.platform

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.weiban.contracts.NotificationEnvelope
import app.weiban.data.OwnerRecord
import kotlinx.serialization.json.Json

internal class NativeNotices(
    private val context: Context,
    private val activity: Class<*>,
    private val json: Json,
) {
    private val manager get() = context.getSystemService(NotificationManager::class.java)

    fun permitted() =
        (
            Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun show(
        owner: OwnerRecord,
        envelope: NotificationEnvelope,
        icon: Bitmap,
    ) {
        val sound = envelope.sound
        val channelId = if (sound) "weiban.messages.sound" else "weiban.messages.silent"
        val channel = NotificationChannel(channelId, if (sound) "新消息" else "静默消息", NotificationManager.IMPORTANCE_DEFAULT)
        if (!sound) channel.setSound(null, null)
        manager.createNotificationChannel(channel)
        val tap = envelope.copy(title = "微伴", body = "", count = 1)
        val intent =
            Intent(context, activity).apply {
                action = ACTION
                data = Uri.parse("weiban-notice:${owner.sessionId}:${envelope.notificationId}")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA, json.encodeToString(NotificationEnvelope.serializer(), tap))
            }
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification =
            NotificationCompat
                .Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                // The Notification owns its pixels after the temporary avatar bitmap is recycled.
                .setLargeIcon(icon.copy(Bitmap.Config.ARGB_8888, false))
                .setContentTitle(envelope.title)
                .setContentText(envelope.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(envelope.body))
                .setNumber(envelope.count.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build()
        manager.notify(prefix(owner) + envelope.collapseKey, 1, notification)
    }

    fun cancel(owner: OwnerRecord) {
        for (notice in manager.activeNotifications) {
            if (notice.tag?.startsWith(prefix(owner)) == true) manager.cancel(notice.tag, notice.id)
        }
    }

    private fun prefix(owner: OwnerRecord) = "weiban.push:${owner.userId}:${owner.sessionId}:"

    companion object {
        const val ACTION = "app.weiban.OPEN_NOTIFICATION"
        const val EXTRA = "weibanNotificationTarget"
    }
}
