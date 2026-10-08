package app.weiban.platform

import android.content.Context
import androidx.work.*
import app.weiban.data.OwnerRecord
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

interface NativePushHost {
    val push: NativePushRuntime

    suspend fun prepareNativePush()
}

object NotificationWork {
    private fun tag(owner: OwnerRecord) = "weiban-notifications:${owner.userId}:${owner.sessionId}"

    fun deliver(
        context: Context,
        owner: OwnerRecord,
        notificationId: String,
    ) = enqueue(context, owner, notificationId)

    fun register(
        context: Context,
        owner: OwnerRecord,
    ) = enqueue(context, owner, null)

    fun cancel(
        context: Context,
        owner: OwnerRecord,
    ) {
        WorkManager.getInstance(context).cancelAllWorkByTag(tag(owner))
    }

    private fun enqueue(
        context: Context,
        owner: OwnerRecord,
        id: String?,
    ) {
        val request =
            OneTimeWorkRequestBuilder<NotificationWorker>()
                .setInputData(workDataOf("userId" to owner.userId, "sessionId" to owner.sessionId, "notificationId" to id))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(tag(owner))
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork("${tag(owner)}:${id ?: "registration"}", ExistingWorkPolicy.KEEP, request)
    }
}

class NotificationWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
    @Suppress("TooGenericExceptionCaught") // Retry transient transport failures within TTL; ownership is rechecked on every attempt.
    override suspend fun doWork(): Result {
        val userId = inputData.getString("userId")
        val sessionId = inputData.getString("sessionId")
        val host = applicationContext as? NativePushHost
        if (userId == null || sessionId == null || host == null) return Result.failure()
        return try {
            host.prepareNativePush()
            val owner = OwnerRecord(userId = userId, sessionId = sessionId)
            val id = inputData.getString("notificationId")
            if (id == null) host.push.bind(owner) else host.push.deliver(owner, id)
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
