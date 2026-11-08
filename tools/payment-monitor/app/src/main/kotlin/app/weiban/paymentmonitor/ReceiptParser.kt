package app.weiban.paymentmonitor

import java.math.BigDecimal
import java.security.MessageDigest

data class ReceiptCandidate(val channel: String, val amountFen: Int, val reviewReason: String? = null)

/** Collect monetary notices like the legacy listener; uncertainty is reported, not silently lost. */
object ReceiptParser {
    fun acceptsTitle(pkg: String, title: String): Boolean = when (pkg) {
        "com.tencent.mm" -> title.trim() in setOf("微信", "微信支付", "微信收款助手", "收款助手")
        // Alipay puts the complete receipt, including the amount, in its title on some devices.
        "com.eg.android.AlipayGphone" -> true
        else -> false
    }
    private val money = Regex("""(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]{1,2}))?\s*元""")
    private val incoming = Regex("""^(?:(?:微信支付|微信收款助手|支付宝)[：:\s]*)?(?:(?:你已|您已)?(?:成功收款|收款到账|收款成功|收款|成功收钱|收钱码到账|到账)[：:\s]*|(?:[\p{L}\p{N}*·]{1,30})?向[你您]付款[：:\s]*)[0-9]""")
    private val nonReceipt = Regex("退款|付款成功|已付款|扣款|转账|转出|支出|优惠|红包|活动|奖励|返现|领券")
    private val aggregate = Regex("""累计|汇总|合计|共计|条消息|\[\d+条\]""")
    fun acceptsMessagingTitle(pkg: String, title: String): Boolean = pkg != "com.eg.android.AlipayGphone" || incoming.containsMatchIn(title.trim())

    fun parse(pkg: String, title: String, text: String, summary: Boolean, messaging: Boolean): ReceiptCandidate? =
        parseViews(pkg, title, listOf(text), summary, messaging)

    @Suppress("UNUSED_PARAMETER") // The Android group-summary flag alone does not describe payment count.
    fun parseViews(pkg: String, title: String, texts: List<String>, summary: Boolean = false, messaging: Boolean = false, multipleItems: Boolean = false): ReceiptCandidate? {
        val channel = when (pkg) { "com.tencent.mm" -> "wechat"; "com.eg.android.AlipayGphone" -> "alipay"; else -> return null }
        if (!acceptsTitle(pkg, title)) return null
        // Do not inspect or forward an ordinary private-message notification in Alipay.
        if (messaging && !acceptsMessagingTitle(pkg, title)) return null
        val views = (listOf(title) + texts).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        val amounts = views.flatMap { view -> money.findAll(view).mapNotNull { match ->
            try {
                val decimal = match.groupValues[2].takeIf { it.isNotEmpty() }?.let { ".$it" }.orEmpty()
                BigDecimal(match.groupValues[1].replace(",", "") + decimal).movePointRight(2).intValueExact().takeIf { it in 1..10_000_000 }
            } catch (_: Exception) { null }
        }.toList() }.distinct()
        val amount = amounts.firstOrNull() ?: return null
        val text = views.joinToString(" ")
        val brandPresent = channel == "alipay" || title.trim() in setOf("微信支付", "微信收款助手", "收款助手") || views.any { it.startsWith("微信支付") }
        val reason = when {
            aggregate.containsMatchIn(text) || multipleItems -> "notice_summary"
            amounts.size > 1 -> "notice_multiple_amounts"
            views.any { money.findAll(it).count() > 1 } -> "notice_summary"
            messaging || nonReceipt.containsMatchIn(text) || views.any { it.length > 4096 } -> "notice_uncertain"
            !brandPresent || views.none { incoming.containsMatchIn(it) && (channel != "wechat" || Regex("收款|到账|收钱").containsMatchIn(it)) } -> "notice_uncertain"
            else -> null
        }
        return ReceiptCandidate(channel, amount, reason)
    }
    // Two monetary inbox lines can be distinct payments even when their amounts are equal.
    fun hasMultipleMoneyLines(lines: List<String>): Boolean = lines.count { money.containsMatchIn(it) } > 1
    fun eventId(channel: String, sourceKey: String, postedAt: Long, amountFen: Int): String =
        MessageDigest.getInstance("SHA-256").digest("wb-notice-v1|$channel|$sourceKey|$postedAt|$amountFen".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
}
