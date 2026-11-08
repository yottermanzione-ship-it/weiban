package app.weiban.paymentmonitor

import android.content.Context
import android.util.AtomicFile
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
    private fun file(ctx: Context) = AtomicFile(File(ctx.filesDir, "receipts-v1.json"))
    @Synchronized fun read(ctx: Context): JSONArray {
        val f = file(ctx)
        if (!f.baseFile.exists()) return JSONArray()
        // Corruption throws: callers show an error and stop; never replace an unreadable queue with an empty one.
        return JSONArray(f.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
    }
    private fun write(ctx: Context, data: JSONArray) {
        val f = file(ctx); val out = f.startWrite()
        try { out.write(data.toString().toByteArray(Charsets.UTF_8)); f.finishWrite(out) }
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
        queue.put(event); write(ctx, queue)
    }
    @Synchronized fun accept(ctx: Context, id: String) {
        val queue = read(ctx)
        for (i in 0 until queue.length()) { val r = queue.getJSONObject(i); if (r.getString("eventId") == id) r.put("accepted", true) }
        write(ctx, queue)
    }
    @Synchronized fun pending(ctx: Context): List<JSONObject> {
        val queue = read(ctx)
        return (0 until queue.length()).map { queue.getJSONObject(it) }.filter { !it.getBoolean("accepted") }
    }
}
