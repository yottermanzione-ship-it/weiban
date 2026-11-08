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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
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
    @Test fun corruptQueueIsPreservedAndNewWriteStops() {
        val file = File(ctx.filesDir, "receipts-v1.json"); file.writeText("synthetic-corrupt-record")
        assertThrows(Exception::class.java) { QueueStore.pending(ctx) }
        assertThrows(Exception::class.java) { QueueStore.enqueue(ctx, ReceiptCandidate("wechat", 500), "synthetic", 4000) }
        assertEquals("synthetic-corrupt-record", file.readText())
    }
}
