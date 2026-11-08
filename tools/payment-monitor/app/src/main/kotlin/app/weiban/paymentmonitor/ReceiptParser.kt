package app.weiban.paymentmonitor

import java.math.BigDecimal
import java.security.MessageDigest

data class ReceiptCandidate(val channel: String, val amountFen: Int)
/** Notification titles alone are not bank authentication. Reject messaging/aggregate/ambiguous shapes. */
object ReceiptParser {
    fun acceptsTitle(pkg: String, title: String): Boolean = when (pkg) {
        "com.tencent.mm" -> title.trim() in setOf("微信支付", "微信收款助手")
        "com.eg.android.AlipayGphone" -> title.trim() in setOf("支付宝", "收款到账通知", "支付宝收款", "收钱码")
        else -> false
    }
    private val amount = Regex("""(?:微信支付)?(?:收款到账|收款成功|收款|成功收款|成功收钱|到账)[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)\s*元(?:\(朋友到店\))?[。！!]?""")
    private val alipay = Regex("""(?:支付宝)?(?:成功收款|收款到账|收款成功|收款|成功收钱|到账)[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)\s*元[。！!]?""")
    fun parse(pkg: String, title: String, text: String, summary: Boolean, messaging: Boolean): ReceiptCandidate? {
        val channel = when (pkg) { "com.tencent.mm" -> "wechat"; "com.eg.android.AlipayGphone" -> "alipay"; else -> return null }
        if (summary || messaging || text.length > 200) return null
        if (!acceptsTitle(pkg, title)) return null
        if (Regex("退款|付款|扣款|转账|累计|汇总|合计|共计|条消息|\\[\\d+条\\]").containsMatchIn(text)) return null
        val match = (if (channel == "wechat") amount else alipay).matchEntire(text.trim()) ?: return null
        val fen = try { BigDecimal(match.groupValues[1]).movePointRight(2).intValueExact() } catch (_: Exception) { return null }
        return if (fen in 1..10_000_000) ReceiptCandidate(channel, fen) else null
    }
    fun eventId(channel: String, sourceKey: String, postedAt: Long, amountFen: Int): String =
        MessageDigest.getInstance("SHA-256").digest("wb-notice-v1|$channel|$sourceKey|$postedAt|$amountFen".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
}
