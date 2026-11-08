package app.weiban.paymentmonitor
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
class ReceiptParserTest {
    private fun parse(text: String, title: String = "微信支付") = ReceiptParser.parse("com.tencent.mm", title, text, false, false)
    @Test fun singleReceipts() {
        assertEquals(2999, parse("微信支付收款29.99元")?.amountFen)
        assertEquals(1, parse("微信支付收款0.01元(朋友到店)", "微信收款助手")?.amountFen)
        assertEquals(1000, ReceiptParser.parse("com.eg.android.AlipayGphone", "支付宝", "成功收款10.00元", false, false)?.amountFen)
    }
    @Test fun rejectChatAndOtherApps() {
        assertNull(parse("微信支付收款10.00元", "普通朋友"))
        assertEquals("notice_uncertain", ReceiptParser.parse("com.tencent.mm", "微信支付", "微信支付收款10.00元", false, true)?.reviewReason)
        assertNull(ReceiptParser.parse("evil.app", "微信支付", "微信支付收款10.00元", false, false))
        assertEquals("notice_uncertain", parse("朋友：微信支付收款10.00元")?.reviewReason)
    }
    @Test fun rejectsRefundsAggregationAndBadDecimals() {
        for (text in listOf("退款10元到账", "微信支付付款成功10元", "转账收款10元", "收款10元，累计100元", "[2条]微信支付收款10元", "收款10元\n收款20元")) assertNotNull(text, parse(text)?.reviewReason)
        for (text in listOf("收款10.001元", "收款0元", "收款999999999元")) assertNull(text, parse(text))
        assertEquals(ReceiptCandidate("wechat", 1000), ReceiptParser.parse("com.tencent.mm", "微信支付", "收款10元", true, false))
    }
    @Test fun groupFlagIsNotProofOfAggregationButActualRepeatedMoneyIs() {
        assertEquals(ReceiptCandidate("wechat", 499), ReceiptParser.parse("com.tencent.mm", "微信收款助手", "微信支付收款4.99元（老顾客第四次消费）", true, false))
        assertEquals("notice_summary", ReceiptParser.parse("com.tencent.mm", "微信支付", "收款4.99元，收款4.99元", true, false)?.reviewReason)
        assertEquals("notice_summary", ReceiptParser.parse("com.tencent.mm", "微信支付", "[2条]微信支付收款4.99元", true, false)?.reviewReason)
        assertEquals("notice_summary", ReceiptParser.parseViews("com.tencent.mm", "微信支付", listOf("微信支付收款4.99元"), multipleItems = true)?.reviewReason)
    }
    @Test fun legacyApk106FormatsAndAlternateViews() {
        assertEquals(1234, ReceiptParser.parse("com.eg.android.AlipayGphone", "支付宝", "用户***向你付款12.34元", false, false)?.amountFen)
        assertEquals(1234, ReceiptParser.parse("com.eg.android.AlipayGphone", "收钱码", "你已成功收款12.34元", false, false)?.amountFen)
        assertEquals(1234, ReceiptParser.parse("com.tencent.mm", "微信", "微信支付：收款12.34元（朋友到店）", false, false)?.amountFen)
        assertEquals("notice_uncertain", ReceiptParser.parse("com.tencent.mm", "微信", "收款12.34元", false, false)?.reviewReason)
        assertEquals("notice_uncertain", parse("向你付款12.34元")?.reviewReason)
        assertEquals(1234, ReceiptParser.parseViews("com.tencent.mm", "微信支付", listOf("", "收款12.34元", "微信支付：收款12.34元"))?.amountFen)
        assertEquals(1234, ReceiptParser.parseViews("com.eg.android.AlipayGphone", "支付宝", listOf("查看详情", "向你付款12.34元"))?.amountFen)
    }
    @Test fun conflictingAlternateViewsAndOutgoingNeverBecomeReceipts() {
        assertEquals("notice_multiple_amounts", ReceiptParser.parseViews("com.tencent.mm", "微信支付", listOf("收款12元", "收款13元"))?.reviewReason)
        assertEquals("notice_uncertain", ReceiptParser.parseViews("com.tencent.mm", "微信支付", listOf("收款12元", "退款12元"))?.reviewReason)
        assertEquals("notice_summary", ReceiptParser.parseViews("com.tencent.mm", "微信支付", listOf("收款12元", "累计12元"))?.reviewReason)
        for (text in listOf("付款成功12元", "已付款12元", "支出12元", "转出12元", "退款到账12元", "收到12元，又收到13元", "朋友：向你付款12元"))
            assertNotNull(text, ReceiptParser.parse("com.eg.android.AlipayGphone", "支付宝", text, false, false)?.reviewReason)
        assertNull(ReceiptParser.parse("com.eg.android.AlipayGphone", "支付宝", "向你付款12.345元", false, false))
    }
    @Test fun customerNotesAndAmountInTitleDoNotLoseRealReceipts() {
        val wechat = ReceiptParser.parse("com.tencent.mm", "微信收款助手", "微信支付收款12.34元（老顾客第四次消费）", false, false)
        assertEquals(ReceiptCandidate("wechat", 1234), wechat)
        val alipay = ReceiptParser.parse("com.eg.android.AlipayGphone", "你已成功收款23.45元（老顾客消费）", "已转入余额提升复购增长收益", false, false)
        assertEquals(ReceiptCandidate("alipay", 2345), alipay)
        assertEquals(ReceiptCandidate("wechat", 100001), parse("微信支付收款1,000.01元（第10次消费）"))
    }
    @Test fun promotionalMoneyIsReportedForReviewInsteadOfDroppedOrMarkedAsReceipt() {
        assertEquals(ReceiptCandidate("alipay", 2000, "notice_uncertain"), ReceiptParser.parse("com.eg.android.AlipayGphone", "周末优惠活动", "20元优惠券待领取", false, false))
        assertEquals("notice_uncertain", parse("微信支付首次收款20元获得奖励")?.reviewReason)
        assertNull(ReceiptParser.parse("com.eg.android.AlipayGphone", "普通朋友", "给你20元", false, true))
    }
    @Test fun deterministicEventIdentity() {
        assertEquals(ReceiptParser.eventId("wechat", "key", 100, 1), ReceiptParser.eventId("wechat", "key", 100, 1))
        assertNotEquals(ReceiptParser.eventId("wechat", "key", 100, 1), ReceiptParser.eventId("alipay", "key", 100, 1))
        assertNotEquals(ReceiptParser.eventId("wechat", "key", 100, 1), ReceiptParser.eventId("wechat", "key", 101, 1))
    }
    @Test fun onlyExplicitAckRemovesFromQueue() {
        assertTrue(MonitorApi.accepted(201, "{\"ok\":true}"))
        assertFalse(MonitorApi.accepted(200, "<html>error</html>"))
        assertFalse(MonitorApi.accepted(200, "{\"ok\":false}"))
        assertFalse(MonitorApi.accepted(503, "{\"ok\":true}"))
    }
    @Test fun signatureFormatMatchesServer() {
        val beat = JSONObject().put("type","heartbeat").put("listenerConnected",true).put("queued",2)
        assertEquals("wb-pay-v1|device|time|heartbeat|1|2", MonitorApi.signingText("device","time",beat))
        val event = JSONObject().put("type","receipt").put("eventId","eid").put("channel","wechat").put("amountFen",1234).put("observedAt","observed").put("postedAt","posted")
        assertEquals("wb-pay-v1|device|time|receipt|eid|wechat|1234|observed|posted", MonitorApi.signingText("device","time",event))
        event.put("reviewReason", "notice_uncertain")
        assertEquals("wb-pay-v2|device|time|receipt|eid|wechat|1234|observed|posted|notice_uncertain", MonitorApi.signingText("device","time",event))
    }
}
