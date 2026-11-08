package app.weiban.paymentmonitor
import android.content.Context
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35])
class QueueStoreTest {
    private lateinit var ctx: Context
    @Before fun setup() {
        ctx = RuntimeEnvironment.getApplication()
        listOf("receipts-v1.json", "receipts-v1.json.bak", "receipts-v1.json.new").forEach { File(ctx.filesDir, it).delete() }
    }
    @Test fun persistsBeforeDeliveryAndRestores() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 1290), "synthetic-key", 1000)
        val saved = File(ctx.filesDir, "receipts-v1.json").readText()
        assertTrue(saved.contains("1290")); assertFalse(saved.contains("synthetic-key"))
        assertEquals(1, QueueStore.pending(RuntimeEnvironment.getApplication()).size)
        assertEquals("1970-01-01T00:00:01Z", QueueStore.pending(ctx).first().getString("postedAt"))
    }
    @Test fun uncertainNoticeRetainsReviewFlagAndOriginalTimeAcrossRetry() {
        QueueStore.enqueue(ctx, ReceiptCandidate("alipay", 2000, "notice_uncertain"), "synthetic-promo-key", 1000)
        val first = QueueStore.pending(ctx).single()
        assertEquals("notice_uncertain", first.getString("reviewReason"))
        assertEquals("1970-01-01T00:00:01Z", first.getString("postedAt"))
        QueueStore.enqueue(ctx, ReceiptCandidate("alipay", 2000), "synthetic-promo-key", 1000)
        assertEquals(first.toString(), QueueStore.pending(ctx).single().toString())
        val saved = File(ctx.filesDir, "receipts-v1.json").readText()
        assertFalse(saved.contains("synthetic-promo-key"))
        assertFalse(saved.contains("notificationText"))
    }
    @Test fun sameNotificationKeepsOriginalObservationAndNoDoubleQueue() {
        QueueStore.enqueue(ctx, ReceiptCandidate("alipay", 980), "synthetic", 2000)
        val first = QueueStore.pending(ctx).first().toString()
        QueueStore.enqueue(ctx, ReceiptCandidate("alipay", 980), "synthetic", 2000)
        assertEquals(1, QueueStore.pending(ctx).size); assertEquals(first, QueueStore.pending(ctx).first().toString())
    }
    @Test fun acknowledgedEventRetainsDedupTombstone() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "synthetic", 3000)
        val id = QueueStore.pending(ctx).first().getString("eventId")
        QueueStore.accept(ctx, id)
        assertTrue(QueueStore.pending(ctx).isEmpty())
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "synthetic", 3000)
        assertTrue(QueueStore.pending(ctx).isEmpty()); assertEquals(1, QueueStore.read(ctx).length())
    }
    @Test fun receiptKindComesOnlyFromAcceptedServerResult() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 999), "synthetic", 4000)
        val pending = QueueStore.pending(ctx).single()
        assertFalse(pending.has("purchaseKind"))
        QueueStore.accept(ctx, pending.getString("eventId"), org.json.JSONObject().put("status", "matched").put("purchaseKind", "recharge"))
        val saved = QueueStore.read(ctx).getJSONObject(0)
        assertEquals("recharge", saved.getString("purchaseKind"))
        assertEquals("matched", saved.getString("status"))
        assertEquals(pending.getString("postedAt"), saved.getString("postedAt"))
        assertTrue(QueueStore.pending(ctx).isEmpty())
    }
    @Test fun legacyInterruptedWriteRestoresBackupInsteadOfReturningEmpty() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 1200), "synthetic-backup", 5000)
        val base = File(ctx.filesDir, "receipts-v1.json")
        assertTrue(base.renameTo(File(ctx.filesDir, "receipts-v1.json.bak")))
        val restored = QueueStore.pending(ctx).single()
        assertEquals(1200, restored.getInt("amountFen"))
        assertEquals("1970-01-01T00:00:05Z", restored.getString("postedAt"))
    }
    @Test fun corruptQueueIsPreservedAndNewWriteStops() {
        val file = File(ctx.filesDir, "receipts-v1.json"); file.writeText("synthetic-corrupt-record")
        assertThrows(Exception::class.java) { QueueStore.pending(ctx) }
        assertThrows(Exception::class.java) { QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "synthetic", 4000) }
        assertEquals("synthetic-corrupt-record", file.readText())
    }
    @Test fun serverTimeCorrectionIsPersistedOnceAndKeepsOriginalTimes() {
        val posted = System.currentTimeMillis() - 1000
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 499), "clock-synthetic", posted)
        val raw = QueueStore.pending(ctx).single()
        val observed = Instant.parse(raw.getString("observedAt")).toEpochMilli()
        val elapsed = raw.getLong("capturedElapsed")
        val fixed = QueueStore.prepare(ctx, raw.getString("eventId"), -60_000, observed + 200, elapsed + 200)
        assertEquals(raw.getString("observedAt"), fixed.getString("deviceObservedAt"))
        assertEquals(raw.getString("postedAt"), fixed.getString("devicePostedAt"))
        assertEquals(observed - 60_000, Instant.parse(fixed.getString("observedAt")).toEpochMilli())
        assertEquals(posted - 60_000, Instant.parse(fixed.getString("postedAt")).toEpochMilli())
        assertEquals(fixed.toString(), QueueStore.prepare(ctx, raw.getString("eventId"), 20_000, observed + 400, elapsed + 400).toString())
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 499), "clock-synthetic", posted)
        assertEquals(1, QueueStore.pending(ctx).size)
    }
    @Test fun delayedUploadIsNotMadeFreshByCalibration() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "old-synthetic", System.currentTimeMillis())
        val raw = QueueStore.pending(ctx).single()
        val observed = Instant.parse(raw.getString("observedAt")).toEpochMilli()
        val elapsed = raw.getLong("capturedElapsed")
        val delay = 600_000L
        val fixed = QueueStore.prepare(ctx, raw.getString("eventId"), -60_000, observed + delay, elapsed + delay)
        assertEquals(delay, observed + delay - 60_000 - Instant.parse(fixed.getString("observedAt")).toEpochMilli())
    }
    @Test fun deviceClockJumpRequiresReviewAndPreservesRawTime() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "jump-synthetic", System.currentTimeMillis())
        val raw = QueueStore.pending(ctx).single()
        val observed = Instant.parse(raw.getString("observedAt")).toEpochMilli()
        val fixed = QueueStore.prepare(ctx, raw.getString("eventId"), -60_000, observed + 10_000, raw.getLong("capturedElapsed") + 100)
        assertEquals("notice_uncertain", fixed.getString("reviewReason"))
        assertEquals(raw.getString("observedAt"), fixed.getString("observedAt"))
    }
    @Test fun acceptedAndLegacyEventsNeverHaveTheirSignedTimesChanged() {
        QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "accepted-synthetic", System.currentTimeMillis())
        val id = QueueStore.pending(ctx).single().getString("eventId")
        QueueStore.accept(ctx, id)
        val accepted = QueueStore.read(ctx).getJSONObject(0)
        assertEquals(accepted.toString(), QueueStore.prepare(ctx, id, -60_000).toString())
        accepted.put("accepted", false).remove("clockPending")
        File(ctx.filesDir, "receipts-v1.json").writeText(org.json.JSONArray().put(accepted).toString())
        assertEquals(accepted.toString(), QueueStore.prepare(ctx, id, -60_000).toString())
    }
}
