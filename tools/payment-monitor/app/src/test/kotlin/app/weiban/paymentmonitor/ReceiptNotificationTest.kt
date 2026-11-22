package app.weiban.paymentmonitor

import android.app.Notification
import android.os.Bundle
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35])
class ReceiptNotificationTest {
    private fun notification(title: String, body: String) = Notification().apply {
        extras = Bundle().apply { putCharSequence(Notification.EXTRA_TITLE, title); putCharSequence(Notification.EXTRA_TEXT, body) }
    }
    private fun candidate(pkg: String, notification: Notification) = ReceiptNotification.read(pkg, notification)?.candidate
    @Test fun wechatCustomerVisitAndAlipayReceiptTitleUseActualNotificationFields() {
        assertEquals(ReceiptCandidate("wechat", 1234), candidate("com.tencent.mm", notification("微信收款助手", "微信支付收款12.34元（老顾客第四次消费）")))
        assertEquals(ReceiptCandidate("alipay", 2345), candidate("com.eg.android.AlipayGphone", notification("你已成功收款23.45元（老顾客消费）", "已转入余额提升复购增长收益")))
    }
    @Test fun legacyExtraFieldsAndMultiLineDetailsAreReadWithoutBeingMistakenForMultiplePayments() {
        for (key in listOf(Notification.EXTRA_BIG_TEXT, Notification.EXTRA_SUMMARY_TEXT, Notification.EXTRA_SUB_TEXT, Notification.EXTRA_INFO_TEXT, Notification.EXTRA_TITLE_BIG, "android.conversationTitle")) {
            val n = notification("支付宝", "查看详情").apply { extras.putCharSequence(key, "你已成功收款23.45元（老顾客消费）") }
            assertEquals(key, ReceiptCandidate("alipay", 2345), candidate("com.eg.android.AlipayGphone", n))
        }
        val n = notification("微信支付", "查看详情").apply { extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, arrayOf("微信支付收款12.34元", "老顾客第四次消费")); tickerText = "微信支付：收款12.34元" }
        assertEquals(ReceiptCandidate("wechat", 1234), candidate("com.tencent.mm", n))
    }
    @Test fun ambiguousAndPromotionalNotificationsRemainReportableButNotAutomaticallyCreditable() {
        val summary = notification("微信支付", "微信支付收款12.34元").apply { flags = flags or Notification.FLAG_GROUP_SUMMARY }
        assertEquals(ReceiptCandidate("wechat", 1234), candidate("com.tencent.mm", summary))
        val conflict = notification("支付宝", "收款23.45元").apply { extras.putCharSequence(Notification.EXTRA_BIG_TEXT, "收款34.56元") }
        assertEquals("notice_multiple_amounts", candidate("com.eg.android.AlipayGphone", conflict)?.reviewReason)
        assertEquals(ReceiptCandidate("alipay", 2000, "notice_uncertain"), candidate("com.eg.android.AlipayGphone", notification("优惠活动", "20元优惠券")))
    }
    @Test fun actualInboxPaymentsRemainReviewEvenWhenTheirAmountsAreEqual() {
        for (second in listOf("微信支付收款12.34元", "微信支付收款23.45元")) {
            val n = notification("微信支付", "查看详情").apply {
                flags = flags or Notification.FLAG_GROUP_SUMMARY
                extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, arrayOf("微信支付收款12.34元", second))
            }
            assertEquals("notice_summary", candidate("com.tencent.mm", n)?.reviewReason)
        }
    }
    @Test fun wechatUnreadCountIsNotAMoneyTotalInCollapsedOrExpandedViews() {
        val latest = "微信支付收款5.00元(老顾客第6次消费)"
        for (body in listOf("[3条]微信收款助手: $latest", "[3条]微信收款助手：$latest", "[3条]$latest")) {
            val n = notification("微信收款助手", body).apply { flags = flags or Notification.FLAG_GROUP_SUMMARY }
            assertEquals(body, ReceiptCandidate("wechat", 500), candidate("com.tencent.mm", n))
            n.extras.putCharSequence(Notification.EXTRA_BIG_TEXT, body)
            n.extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, arrayOf(body))
            n.tickerText = latest
            assertEquals("expanded: $body", ReceiptCandidate("wechat", 500), candidate("com.tencent.mm", n))
        }
    }
    @Test fun unreadCountDoesNotMakeActualTotalsOrMultipleReceiptsSingle() {
        for (body in listOf(
            "[3条]微信收款助手: 微信支付收款5.00元，累计收款10.00元",
            "[3条]微信收款助手: 微信支付收款5.00元，合计5.00元",
            "[3条]微信收款助手: 微信支付收款5.00元\n微信支付收款5.00元"
        )) assertEquals("notice_summary", candidate("com.tencent.mm", notification("微信收款助手", body))?.reviewReason)
        val inbox = notification("微信收款助手", "[3条]微信收款助手: 微信支付收款5.00元").apply {
            extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, arrayOf("微信支付收款5.00元", "微信支付收款5.00元"))
        }
        assertEquals("notice_summary", candidate("com.tencent.mm", inbox)?.reviewReason)
        val conflict = notification("微信收款助手", "[3条]微信收款助手: 微信支付收款5.00元").apply {
            extras.putCharSequence(Notification.EXTRA_BIG_TEXT, "微信支付收款4.99元")
        }
        assertEquals("notice_multiple_amounts", candidate("com.tencent.mm", conflict)?.reviewReason)
    }
    @Test fun otherAppsAndOrdinaryPrivateMessagesAreNotPaymentReports() {
        assertNull(candidate("other.app", notification("支付宝", "收款23.45元")))
        assertNull(candidate("com.tencent.mm", notification("普通朋友", "微信支付收款12.34元")))
        val chat = notification("普通朋友", "给你20元").apply { extras.putBoolean("android.isGroupConversation", true) }
        assertNull(candidate("com.eg.android.AlipayGphone", chat))
    }
    @Test fun reviewEvidenceRetainsVisibleFieldsAndRepeatedPaymentLines() {
        val n = notification("微信收款助手", "汇总收款10元").apply {
            extras.putCharSequence(Notification.EXTRA_BIG_TEXT, "今日收款汇总")
            extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, arrayOf("微信支付收款5元", "微信支付收款5元"))
        }
        val captured = ReceiptNotification.read("com.tencent.mm", n)!!
        assertEquals("notice_summary", captured.candidate.reviewReason)
        assertEquals("微信收款助手\n汇总收款10元\n今日收款汇总\n微信支付收款5元\n微信支付收款5元", captured.noticeText)
        val alipay = ReceiptNotification.read("com.eg.android.AlipayGphone", notification("支付宝商家服务", "累计收款25.50元"))!!
        assertTrue(alipay.noticeText!!.contains("累计收款25.50元"))
    }
    @Test fun moneyInPromotionOrMessagingDoesNotExposeNotificationText() {
        val promotion = ReceiptNotification.read("com.eg.android.AlipayGphone", notification("优惠活动", "20元优惠券"))!!
        assertEquals("notice_uncertain", promotion.candidate.reviewReason)
        assertNull(promotion.noticeText)
        val conversation = notification("微信支付", "微信支付收款5.00元").apply { extras.putBoolean("android.isGroupConversation", true) }
        assertNull(ReceiptNotification.read("com.tencent.mm", conversation)?.noticeText)
    }
}
