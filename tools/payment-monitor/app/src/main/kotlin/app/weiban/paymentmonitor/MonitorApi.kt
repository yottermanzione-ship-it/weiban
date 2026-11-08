package app.weiban.paymentmonitor

import android.content.Context
import org.json.JSONObject
import java.net.URL
import java.time.Instant
import javax.net.ssl.HttpsURLConnection

object MonitorApi {
    // Only the production origin. No arbitrary forwarding destination for payment metadata or signatures.
    private const val root = "https://app.weiban.online/api/v1/billing/scan/monitor/"
    fun signingText(deviceId: String, requestTime: String, event: JSONObject): String {
        val prefix = "wb-pay-v1|$deviceId|$requestTime|${event.getString("type")}"
        return if (event.getString("type") == "heartbeat") "$prefix|${if (event.getBoolean("listenerConnected")) 1 else 0}|${event.getInt("queued")}"
        else "$prefix|${event.getString("eventId")}|${event.getString("channel")}|${event.getInt("amountFen")}|${event.getString("observedAt")}|${event.getString("postedAt")}"
    }
    fun accepted(code: Int, body: String): Boolean = code in 200..299 && try { JSONObject(body).opt("ok") == true } catch (_: Exception) { false }
    private fun post(path: String, payload: JSONObject): JSONObject {
        val conn = URL(root + path).openConnection() as HttpsURLConnection
        conn.requestMethod = "POST"; conn.connectTimeout = 10_000; conn.readTimeout = 15_000
        conn.instanceFollowRedirects = false; conn.doOutput = true; conn.setRequestProperty("Content-Type", "application/json")
        try {
            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) throw IllegalStateException(if (code == 401) "后台尚未启用监控，或手机时间不正确" else if (code == 409) "到账标识冲突，请在后台核对；本机记录已保留" else "服务器暂未确认，记录保留待补报")
            val body = conn.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(2048)
                while (true) { val n = input.read(buffer); if (n < 0) break; if (out.size() + n > 16_384) throw IllegalStateException("服务器响应过长，记录保留待补报"); out.write(buffer, 0, n) }
                out.toByteArray().toString(Charsets.UTF_8)
            }
            if (!accepted(code, body)) throw IllegalStateException("服务器未明确确认，记录保留待补报")
            return JSONObject(body)
        } finally { conn.disconnect() }
    }
    fun pair(ctx: Context, pairing: String) {
        val match = Regex("^wbpair1:([0-9a-f-]{36}):([a-f0-9]{32})$").matchEntire(pairing.trim()) ?: throw IllegalArgumentException("请粘贴后台提供的完整配对信息")
        val id = match.groupValues[1]; val code = match.groupValues[2]
        val current = QueueStore.deviceId(ctx)
        if (current.isNotEmpty() && current != id) throw IllegalStateException("此手机已经配对，请在后台启用原设备；更换前先核对待补报记录")
        val key = DeviceKey.publicKey()
        val proof = DeviceKey.sign("wb-pay-pair-v1|$id|$code|$key")
        post("pair", JSONObject().put("deviceId", id).put("pairCode", code).put("publicKey", key).put("signature", proof))
        if (!QueueStore.saveDevice(ctx, id)) throw IllegalStateException("设备信息未保存，请重试配对")
        QueueStore.status(ctx, "配对成功，请在后台设为唯一监控")
    }
    fun report(ctx: Context, event: JSONObject): JSONObject {
        val id = QueueStore.deviceId(ctx); check(id.isNotEmpty()) { "请先配对" }
        val requestTime = Instant.now().toString()
        return post("report", JSONObject().put("deviceId", id).put("requestTime", requestTime).put("event", event).put("signature", DeviceKey.sign(signingText(id, requestTime, event))))
    }
}
