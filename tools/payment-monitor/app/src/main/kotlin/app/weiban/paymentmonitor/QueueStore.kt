package app.weiban.paymentmonitor

import android.content.Context
import android.util.AtomicFile
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

object QueueStore {
    fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("monitor", Context.MODE_PRIVATE)
    fun deviceId(ctx: Context) = prefs(ctx).getString("deviceId", "").orEmpty()
    fun lastStatus(ctx: Context) = prefs(ctx).getString("status", "尚未连接服务器").orEmpty()
    fun status(ctx: Context, message: String) { prefs(ctx).edit().putString("status", message).putLong("statusAt", System.currentTimeMillis()).commit() }
    fun saveDevice(ctx: Context, id: String) = prefs(ctx).edit().putString("deviceId", id).commit()
    fun retireLegacyDisplay(ctx: Context) {
        // These old UI-only counters are not receipts. Keep binding, timestamps and the entire journal.
        val settings = prefs(ctx)
        val edit = settings.edit().remove("unrecognized").remove("reviewPending")
        if (settings.getString("status", "") in setOf(
            "监控已连接；有到账需要到后台核对",
            "有通知未提取到有效金额；已识别金额的通知会报到后台，通知原文不保存"
        )) edit.putString("status", "到账处理结果请到后台查看")
        edit.commit()
    }
    private fun file(ctx: Context) = AtomicFile(File(ctx.filesDir, "receipts-v1.json"))
    @Synchronized fun read(ctx: Context): JSONArray {
        val f = file(ctx)
        if (!f.baseFile.exists() && !File(f.baseFile.path + ".bak").exists() && !File(f.baseFile.path + ".new").exists()) return JSONArray()
        // Corruption throws: callers show an error and stop; never replace an unreadable queue with an empty one.
        return JSONArray(f.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
    }
    private fun write(ctx: Context, data: JSONArray) {
        val f = file(ctx); val out = f.startWrite()
        try {
            val expected = data.toString().toByteArray(Charsets.UTF_8)
            out.write(expected); f.finishWrite(out)
            // AtomicFile logs some rename failures without throwing. Never treat an uncommitted write as persisted.
            if (!f.baseFile.readBytes().contentEquals(expected)) throw java.io.IOException("Receipt journal commit failed")
        }
        catch (e: Exception) { f.failWrite(out); throw e }
    }
    @Synchronized fun enqueue(ctx: Context, candidate: ReceiptCandidate, sourceKey: String, postedAt: Long) {
        val id = ReceiptParser.eventId(candidate.channel, sourceKey, postedAt, candidate.amountFen)
        // The journal retains accepted events as dedup tombstones. No notification body, sender, or source key is stored.
        val queue = read(ctx)
        for (i in 0 until queue.length()) if (queue.getJSONObject(i).getString("eventId") == id) return
        val event = JSONObject().put("type", "receipt").put("eventId", id).put("channel", candidate.channel)
            .put("amountFen", candidate.amountFen).put("postedAt", Instant.ofEpochMilli(postedAt).toString())
            .put("observedAt", Instant.now().toString()).put("accepted", false)
            .put("clockPending", true).put("capturedElapsed", SystemClock.elapsedRealtime())
        candidate.reviewReason?.let { event.put("reviewReason", it) }
        queue.put(event); write(ctx, queue)
    }
    @Synchronized fun prepare(ctx: Context, id: String, offset: Long, wall: Long = System.currentTimeMillis(), elapsed: Long = SystemClock.elapsedRealtime()): JSONObject {
        val data = read(ctx)
        for (i in 0 until data.length()) {
            val event = data.getJSONObject(i)
            if (event.getString("eventId") != id) continue
            if (!event.optBoolean("clockPending", false) || event.getBoolean("accepted")) return event
            val observed = Instant.parse(event.getString("observedAt")).toEpochMilli()
            val posted = Instant.parse(event.getString("postedAt")).toEpochMilli()
            val age = elapsed - event.getLong("capturedElapsed")
            if (age < 0 || kotlin.math.abs((wall - observed) - age) > 3000) {
                // A reboot or manual clock jump cannot safely reconstruct an old payment time.
                event.put("reviewReason", "notice_uncertain")
            } else {
                event.put("deviceObservedAt", event.getString("observedAt"))
                event.put("devicePostedAt", event.getString("postedAt"))
                event.put("observedAt", Instant.ofEpochMilli(observed + offset).toString())
                event.put("postedAt", Instant.ofEpochMilli(posted + offset).toString())
            }
            // Persist once before sending: a lost response must retry byte-identical signed event times.
            event.put("clockPending", false)
            write(ctx, data)
            return event
        }
        throw IllegalStateException("到账记录不存在，原记录已保留")
    }
    @Synchronized fun accept(ctx: Context, id: String, result: JSONObject? = null) {
        val queue = read(ctx)
        for (i in 0 until queue.length()) { val r = queue.getJSONObject(i); if (r.getString("eventId") == id) {
            r.put("accepted", true)
            if (result != null) {
                r.put("status", result.optString("status").takeIf { it in setOf("matched", "review", "ignored") } ?: "review")
                r.put("purchaseKind", result.optString("purchaseKind").takeIf { it in setOf("recharge", "membership") } ?: JSONObject.NULL)
            }
        } }
        write(ctx, queue)
    }
    @Synchronized fun pending(ctx: Context): List<JSONObject> {
        val queue = read(ctx)
        return (0 until queue.length()).map { queue.getJSONObject(it) }.filter { !it.getBoolean("accepted") }
    }
}
