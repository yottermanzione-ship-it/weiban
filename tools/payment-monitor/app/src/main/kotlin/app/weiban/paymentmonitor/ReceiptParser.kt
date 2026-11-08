package app.weiban.paymentmonitor

import java.math.BigDecimal
import java.security.MessageDigest

data class ReceiptCandidate(val channel: String, val amountFen: Int)
/** Notification titles alone are not bank authentication. Reject messaging/aggregate/ambiguous shapes. */
object ReceiptParser {
    fun acceptsTitle(pkg: String, title: String): Boolean = when (pkg) {
        "com.tencent.mm" -> title.trim() in setOf("微信", "微信支付", "微信收款助手")
        "com.eg.android.AlipayGphone" -> title.trim() in setOf("支付宝", "收款到账通知", "支付宝收款", "收钱码")
        else -> false
    }
    private val amount = Regex("""(?:微信支付[：:\s]*)?(?:收款到账|收款成功|收款|成功收款|成功收钱|到账)[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)\s*元(?:[（(]朋友到店[）)])?[。！!]?""")
    private val alipay = Regex("""(?:支付宝[：:\s]*)?(?:你已|您已)?(?:成功收款|收款到账|收款成功|收款|成功收钱|收钱码到账|到账)[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)\s*元[。！!]?""")
    private val incomingAlipay = Regex("""(?:支付宝[：:\s]*)?(?:[\p{L}\p{N}*·]{1,30})?向你付款[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)\s*元[。！!]?""")
    private val rejected = Regex("退款|付款成功|已付款|扣款|转账|转出|支出|累计|汇总|合计|共计|条消息|\\[\\d+条\\]")
    fun parse(pkg: String, title: String, text: String, summary: Boolean, messaging: Boolean): ReceiptCandidate? {
        val channel = when (pkg) { "com.tencent.mm" -> "wechat"; "com.eg.android.AlipayGphone" -> "alipay"; else -> return null }
        if (summary || messaging || text.length > 200) return null
        if (!acceptsTitle(pkg, title)) return null
        if (rejected.containsMatchIn(text)) return null
        val clean = text.trim()
        // A generic WeChat title is only accepted with an explicit payment header.
        if (title.trim() == "微信" && !clean.startsWith("微信支付")) return null
        val match = if (channel == "wechat") amount.matchEntire(clean)
            else alipay.matchEntire(clean) ?: incomingAlipay.matchEntire(clean)
        if (match == null) return null
        val fen = try { BigDecimal(match.groupValues[1]).movePointRight(2).intValueExact() } catch (_: Exception) { return null }
        return if (fen in 1..10_000_000) ReceiptCandidate(channel, fen) else null
    }
    /** Expanded/ticker views are alternatives of one receipt, never independent payments. */
    fun parseViews(pkg: String, title: String, texts: List<String>): ReceiptCandidate? {
        val views = texts.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (views.isEmpty() || views.any { rejected.containsMatchIn(it) }) return null
        val results = views.map { parse(pkg, title, it, false, false) }
        // Ignore only harmless display hints. Unknown payment/amount text cannot override a valid view.
        if (views.indices.any { results[it] == null && Regex("[0-9]|元|收款|到账|付款").containsMatchIn(views[it]) }) return null
        return results.filterNotNull().distinct().singleOrNull()
    }
    fun eventId(channel: String, sourceKey: String, postedAt: Long, amountFen: Int): String =
        MessageDigest.getInstance("SHA-256").digest("wb-notice-v1|$channel|$sourceKey|$postedAt|$amountFen".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
}
