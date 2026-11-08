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
    @Test fun wechatCustomerVisitAndAlipayReceiptTitleUseActualNotificationFields() {
        assertEquals(ReceiptCandidate("wechat", 1234), ReceiptNotification.read("com.tencent.mm", notification("微信收款助手", "微信支付收款12.34元（老顾客第四次消费）")))
        assertEquals(ReceiptCandidate("alipay", 2345), ReceiptNotification.read("com.eg.android.AlipayGphone", notification("你已成功收款23.45元（老顾客消费）", "已转入余额提升复购增长收益")))
    }
    @Test fun legacyExtraFieldsAndMultiLineDetailsAreReadWithoutBeingMistakenForMultiplePayments() {
        for (key in listOf(Notification.EXTRA_BIG_TEXT, Notification.EXTRA_SUMMARY_TEXT, Notification.EXTRA_SUB_TEXT, Notification.EXTRA_INFO_TEXT, Notification.EXTRA_TITLE_BIG, "android.conversationTitle")) {
            val n = notification("支付宝", "查看详情").apply { extras.putCharSequence(key, "你已成功收款23.45元（老顾客消费）") }
            assertEquals(key, ReceiptCandidate("alipay", 2345), ReceiptNotification.read("com.eg.android.AlipayGphone", n))
        }
        val n = notification("微信支付", "查看详情").apply { extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, arrayOf("微信支付收款12.34元", "老顾客第四次消费")); tickerText = "微信支付：收款12.34元" }
        assertEquals(ReceiptCandidate("wechat", 1234), ReceiptNotification.read("com.tencent.mm", n))
    }
    @Test fun ambiguousAndPromotionalNotificationsRemainReportableButNotAutomaticallyCreditable() {
        val summary = notification("微信支付", "微信支付收款12.34元").apply { flags = flags or Notification.FLAG_GROUP_SUMMARY }
        assertEquals("notice_summary", ReceiptNotification.read("com.tencent.mm", summary)?.reviewReason)
        val conflict = notification("支付宝", "收款23.45元").apply { extras.putCharSequence(Notification.EXTRA_BIG_TEXT, "收款34.56元") }
        assertEquals("notice_multiple_amounts", ReceiptNotification.read("com.eg.android.AlipayGphone", conflict)?.reviewReason)
        assertEquals(ReceiptCandidate("alipay", 2000, "notice_uncertain"), ReceiptNotification.read("com.eg.android.AlipayGphone", notification("优惠活动", "20元优惠券")))
    }
    @Test fun otherAppsAndOrdinaryPrivateMessagesAreNotPaymentReports() {
        assertNull(ReceiptNotification.read("other.app", notification("支付宝", "收款23.45元")))
        assertNull(ReceiptNotification.read("com.tencent.mm", notification("普通朋友", "微信支付收款12.34元")))
        val chat = notification("普通朋友", "给你20元").apply { extras.putBoolean("android.isGroupConversation", true) }
        assertNull(ReceiptNotification.read("com.eg.android.AlipayGphone", chat))
    }
}
