package app.weiban

import android.content.Context
import androidx.work.*
import app.weiban.data.*
import java.util.concurrent.TimeUnit

object ChatWork {
    private fun tag(owner: OwnerRecord) = "weiban-outbox:${owner.userId}:${owner.sessionId}"

    fun enqueue(
        context: Context,
        owner: OwnerRecord,
    ) {
        val request =
            OneTimeWorkRequestBuilder<ChatOutboxWorker>()
                .setInputData(workDataOf("userId" to owner.userId, "sessionId" to owner.sessionId))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(tag(owner))
                .build()
        // Appending guarantees a send committed while another worker exits is not lost to KEEP.
        WorkManager.getInstance(context).enqueueUniqueWork(tag(owner), ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun cancel(
        context: Context,
        owner: OwnerRecord,
    ) {
        WorkManager.getInstance(context).cancelAllWorkByTag(tag(owner))
    }
}

class ChatOutboxWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val owner = readOwner() ?: return Result.failure()
        val app = applicationContext as WeibanApplication
        app.initialize()
        val result = BackgroundChatDrain(app.repository, app.chat).drain(owner)
        return if (result == ChatDrainResult.RETRY) Result.retry() else Result.success()
    }

    private fun readOwner(): OwnerRecord? {
        val userId = inputData.getString("userId")
        val sessionId = inputData.getString("sessionId")
        return if (userId == null || sessionId == null) null else OwnerRecord(userId = userId, sessionId = sessionId)
    }
}
