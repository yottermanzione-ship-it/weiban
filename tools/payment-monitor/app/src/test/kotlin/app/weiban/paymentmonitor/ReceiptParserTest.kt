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
        assertNull(ReceiptParser.parse("com.tencent.mm", "微信支付", "微信支付收款10.00元", false, true))
        assertNull(ReceiptParser.parse("evil.app", "微信支付", "微信支付收款10.00元", false, false))
        assertNull(parse("朋友：微信支付收款10.00元"))
    }
    @Test fun rejectsRefundsAggregationAndBadDecimals() {
        for (text in listOf("退款10元到账", "微信支付付款成功10元", "转账收款10元", "收款10元，累计100元", "[2条]微信支付收款10元", "收款10.001元", "收款0元", "收款999999999元", "收款10元\n收款20元")) assertNull(text, parse(text))
        assertNull(ReceiptParser.parse("com.tencent.mm", "微信支付", "收款10元", true, false))
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
    }
}
