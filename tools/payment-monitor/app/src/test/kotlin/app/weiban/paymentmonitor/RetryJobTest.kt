package app.weiban.paymentmonitor

import android.Manifest
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.Context
import android.content.pm.PackageManager
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowJobScheduler
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35], shadows = [RetryJobTest.TestScheduler::class])
class RetryJobTest {
    private lateinit var app: Context
    private lateinit var scheduler: TestScheduler
    private lateinit var ctx: Context

    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        QueueStore.prefs(app).edit().clear().commit()
        listOf("receipts-v1.json", "receipts-v1.json.bak", "receipts-v1.json.new").forEach { File(app.filesDir, it).delete() }
        scheduler = Shadow.extract(app.getSystemService(JobScheduler::class.java))
        ctx = app
    }

    @Test fun installedAppHasNetworkConstraintPermission() {
        // Robolectric does not auto-grant normal permissions like a real installation.
        // Read the merged manifest exposed by PackageManager, not its simulated grant state.
        val declared = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty().toList()
        assertTrue(declared.contains(Manifest.permission.ACCESS_NETWORK_STATE))
        assertTrue(declared.contains(Manifest.permission.RECEIVE_BOOT_COMPLETED))
    }

    @Test fun pairedMonitorSchedulesDurableNetworkRetry() {
        QueueStore.saveDevice(app, "synthetic-device")
        RetryJob.schedule(ctx)
        val job = scheduler.pending.single()
        assertEquals(JobInfo.NETWORK_TYPE_ANY, job.networkType)
        assertEquals(60_000L, job.minLatencyMillis)
        assertTrue(job.isPersisted)
        assertEquals(RetryJob::class.java.name, job.service.className)
    }

    @Test fun unpairedMonitorDoesNotSchedule() {
        RetryJob.schedule(ctx)
        assertTrue(scheduler.pending.isEmpty())
    }

    @Test fun systemPermissionRejectionDoesNotCrashOrAlterReceipts() {
        QueueStore.saveDevice(app, "synthetic-device")
        QueueStore.enqueue(app, ReceiptCandidate("wechat", 500), "synthetic-only", 1000)
        val before = File(app.filesDir, "receipts-v1.json").readText()
        scheduler.reject = true
        RetryJob.schedule(ctx)
        assertTrue(QueueStore.prefs(app).getBoolean("retryUnavailable", false))
        assertEquals(before, File(app.filesDir, "receipts-v1.json").readText())
        assertEquals("synthetic-device", QueueStore.deviceId(app))
    }

    @Test fun schedulingFailureIsVisibleAndNextSuccessClearsIt() {
        QueueStore.saveDevice(app, "synthetic-device")
        scheduler.result = JobScheduler.RESULT_FAILURE
        RetryJob.schedule(ctx)
        assertTrue(QueueStore.prefs(app).getBoolean("retryUnavailable", false))
        scheduler.result = JobScheduler.RESULT_SUCCESS
        RetryJob.schedule(ctx)
        assertFalse(QueueStore.prefs(app).getBoolean("retryUnavailable", false))
        assertEquals(1, scheduler.pending.size)
    }

    @Implements(className = "android.app.JobSchedulerImpl", isInAndroidSdk = false)
    class TestScheduler : ShadowJobScheduler.ShadowJobSchedulerImpl() {
        val pending: List<JobInfo> get() = allPendingJobs
        var reject = false
        var result = JobScheduler.RESULT_SUCCESS
        @Implementation override fun schedule(job: JobInfo): Int {
            if (reject) throw SecurityException("Synthetic system scheduling rejection")
            return if (result == JobScheduler.RESULT_SUCCESS) super.schedule(job) else result
        }
    }
}
